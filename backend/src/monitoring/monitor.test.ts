import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { MonitorService } from "./monitor.js";

describe("MonitorService incident state", () => {
  let db: DatabaseContext;
  let monitor: MonitorService;
  const projectId = "project-1";

  beforeEach(() => {
    db = createDatabase(":memory:");
    db.sqlite.prepare(`INSERT INTO coolify_resources(id,resource_type,resource_uuid,name,synced_at) VALUES('resource-1','application','app-1','Example',?)`).run(new Date().toISOString());
    db.sqlite.prepare(`INSERT INTO projects(id,coolify_resource_id,slug,live_url,health_url,published,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`).run(projectId, "resource-1", "example", "https://example.com", "https://example.com/health", new Date().toISOString(), new Date().toISOString());
    db.sqlite.prepare(`INSERT INTO health_state(project_id,status) VALUES(?, 'collecting')`).run(projectId);
    db.sqlite.prepare(`INSERT INTO project_resources(id,project_id,coolify_resource_id,label_en,label_es,display_order,uptime_enabled,health_url,uptime_start_date) VALUES(?,?,?,?,?,?,?,?,?)`).run("project-resource-1", projectId, "resource-1", "Frontend", "Frontend", 0, 1, "https://example.com/health", "2026-01-01");
    db.sqlite.prepare(`INSERT INTO resource_health_state(project_resource_id,status) VALUES(?, 'collecting')`).run("project-resource-1");
    monitor = new MonitorService(db, loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:" }), { info() {}, warn() {} });
  });

  afterEach(() => db.sqlite.close());

  it("degrades on transient failures, confirms the third, and recovers on success", () => {
    const failure = (offset: number) => monitor.record(projectId, { checkedAt: new Date(Date.UTC(2026, 0, 1, 0, offset)).toISOString(), success: false, statusCode: 503, latencyMs: 50, errorCode: null });
    failure(0);
    expect(state().status).toBe("degraded");
    expect(state().consecutive_failures).toBe(1);
    failure(1);
    expect(state().status).toBe("degraded");
    failure(2);
    expect(state().status).toBe("offline");
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM incidents WHERE project_id=? AND ended_at IS NULL`).get(projectId)).toEqual({ count: 1 });

    monitor.record(projectId, { checkedAt: new Date(Date.UTC(2026, 0, 1, 0, 3)).toISOString(), success: true, statusCode: 204, latencyMs: 22, errorCode: null });
    expect(state().status).toBe("online");
    expect(state().consecutive_failures).toBe(0);
    expect(state().streak_started_at).toBeTruthy();
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM incidents WHERE project_id=? AND ended_at IS NULL`).get(projectId)).toEqual({ count: 0 });
  });

  it("updates durable daily uptime aggregates", () => {
    monitor.record(projectId, { checkedAt: "2026-01-02T00:00:00.000Z", success: true, statusCode: 200, latencyMs: 20, errorCode: null });
    monitor.record(projectId, { checkedAt: "2026-01-02T00:01:00.000Z", success: false, statusCode: 500, latencyMs: 30, errorCode: null });
    expect(db.sqlite.prepare(`SELECT check_count,success_count,latency_sum_ms,latency_count FROM daily_metrics WHERE project_id=? AND day='2026-01-02'`).get(projectId)).toEqual({ check_count: 2, success_count: 1, latency_sum_ms: 50, latency_count: 2 });
  });

  it("tracks component health independently from the project rollup", () => {
    for (const offset of [0, 1, 2]) monitor.recordResource("project-resource-1", { checkedAt: new Date(Date.UTC(2026, 0, 1, 0, offset)).toISOString(), success: false, statusCode: 503, latencyMs: 40 + offset, errorCode: null });
    expect(db.sqlite.prepare(`SELECT status,consecutive_failures FROM resource_health_state WHERE project_resource_id=?`).get("project-resource-1")).toEqual({ status: "offline", consecutive_failures: 3 });
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM resource_incidents WHERE project_resource_id=? AND ended_at IS NULL`).get("project-resource-1")).toEqual({ count: 1 });
    monitor.recordResource("project-resource-1", { checkedAt: "2026-01-01T00:03:00.000Z", success: true, statusCode: 200, latencyMs: 25, errorCode: null });
    expect(db.sqlite.prepare(`SELECT status FROM resource_health_state WHERE project_resource_id=?`).get("project-resource-1")).toEqual({ status: "online" });
  });

  function state() { return db.sqlite.prepare(`SELECT * FROM health_state WHERE project_id=?`).get(projectId) as Record<string, unknown>; }
});
