import dns from "node:dns/promises";
import net from "node:net";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { DatabaseContext } from "../db/index.js";

interface MonitorProject {
  id: string;
  health_url: string;
  health_method: "GET" | "HEAD";
  health_timeout_ms: number;
  expected_status_min: number;
  expected_status_max: number;
}

export class MonitorService {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly db: DatabaseContext, private readonly config: AppConfig, private readonly logger: { info: Function; warn: Function }) {}

  start() {
    const schedule = () => {
      this.timer = setTimeout(async () => {
        await this.runAll();
        schedule();
      }, this.config.MONITOR_INTERVAL_MS + Math.round(Math.random() * 5_000));
      this.timer.unref();
    };
    void this.runAll();
    schedule();
  }

  stop() { if (this.timer) clearTimeout(this.timer); }

  async runAll() {
    if (this.running) return;
    this.running = true;
    try {
      const projects = this.db.sqlite.prepare(`SELECT id,health_url,health_method,health_timeout_ms,expected_status_min,expected_status_max FROM projects WHERE published=1 AND monitoring_enabled=1 AND health_url IS NOT NULL`).all() as MonitorProject[];
      for (let index = 0; index < projects.length; index += 5) await Promise.all(projects.slice(index, index + 5).map((project) => this.check(project)));
      this.db.sqlite.prepare(`DELETE FROM health_checks WHERE checked_at < ?`).run(new Date(Date.now() - 30 * 86_400_000).toISOString());
    } catch (error) { this.logger.warn({ error }, "monitor cycle failed"); }
    finally { this.running = false; }
  }

  async check(project: MonitorProject) {
    const checkedAt = new Date().toISOString();
    const started = performance.now();
    let success = false;
    let statusCode: number | null = null;
    let errorCode: string | null = null;
    try {
      await assertSafeTarget(project.health_url, this.config.ALLOW_PRIVATE_MONITOR_TARGETS);
      const response = await fetch(project.health_url, { method: project.health_method, redirect: "manual", signal: AbortSignal.timeout(project.health_timeout_ms), headers: { "User-Agent": "Izbri-Projects-Monitor/1.0", Accept: "*/*" } });
      statusCode = response.status;
      success = statusCode >= project.expected_status_min && statusCode <= project.expected_status_max;
      await response.body?.cancel();
    } catch (error) {
      errorCode = error instanceof Error ? error.name.slice(0, 80) : "MONITOR_ERROR";
    }
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    this.record(project.id, { checkedAt, success, statusCode, latencyMs, errorCode });
  }

  record(projectId: string, result: { checkedAt: string; success: boolean; statusCode: number | null; latencyMs: number; errorCode: string | null }) {
    this.db.sqlite.transaction(() => {
      const state = this.db.sqlite.prepare(`SELECT * FROM health_state WHERE project_id=?`).get(projectId) as Record<string, unknown> | undefined;
      const previousStatus = String(state?.status ?? "collecting");
      const previousFailures = Number(state?.consecutive_failures ?? 0);
      const failures = result.success ? 0 : previousFailures + 1;
      const status = result.success ? "online" : failures >= 3 ? "offline" : "degraded";
      let streak = state?.streak_started_at ? String(state.streak_started_at) : null;
      if (result.success && (!streak || previousStatus === "offline")) streak = result.checkedAt;
      if (!result.success && status === "offline") streak = null;
      this.db.sqlite.prepare(`INSERT INTO health_checks(id,project_id,checked_at,success,status_code,latency_ms,error_code) VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), projectId, result.checkedAt, Number(result.success), result.statusCode, result.latencyMs, result.errorCode);
      this.db.sqlite.prepare(`
        INSERT INTO health_state(project_id,status,consecutive_failures,last_checked_at,last_success_at,streak_started_at,latency_ms)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET status=excluded.status,
          consecutive_failures=excluded.consecutive_failures,last_checked_at=excluded.last_checked_at,
          last_success_at=COALESCE(excluded.last_success_at,health_state.last_success_at),
          streak_started_at=excluded.streak_started_at,latency_ms=excluded.latency_ms
      `).run(projectId, status, failures, result.checkedAt, result.success ? result.checkedAt : null, streak, result.latencyMs);
      if (status === "offline" && previousStatus !== "offline") this.db.sqlite.prepare(`INSERT INTO incidents(id,project_id,started_at,trigger_error_code,trigger_status_code) VALUES(?,?,?,?,?)`).run(randomUUID(), projectId, result.checkedAt, result.errorCode ?? (result.statusCode == null ? "MONITOR_ERROR" : "HTTP_STATUS"), result.statusCode);
      if (result.success && previousStatus === "offline") this.db.sqlite.prepare(`UPDATE incidents SET ended_at=?,recovered_status_code=? WHERE project_id=? AND ended_at IS NULL`).run(result.checkedAt, result.statusCode, projectId);
      const day = result.checkedAt.slice(0, 10);
      this.db.sqlite.prepare(`
        INSERT INTO daily_metrics(project_id,day,check_count,success_count,latency_sum_ms,latency_count)
        VALUES(?,?,?,?,?,1) ON CONFLICT(project_id,day) DO UPDATE SET
          check_count=check_count+1,success_count=success_count+excluded.success_count,
          latency_sum_ms=latency_sum_ms+excluded.latency_sum_ms,latency_count=latency_count+1
      `).run(projectId, day, 1, Number(result.success), result.latencyMs);
    })();
  }
}

async function assertSafeTarget(rawUrl: string, allowPrivate: boolean) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("UNSUPPORTED_PROTOCOL");
  if (url.username || url.password) throw new Error("URL_CREDENTIALS_FORBIDDEN");
  if (allowPrivate) return;
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("PRIVATE_TARGET_FORBIDDEN");
}

function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:") || normalized.startsWith("::ffff:127.");
}
