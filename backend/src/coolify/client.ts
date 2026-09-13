import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { DatabaseContext } from "../db/index.js";
import type { TeamConnection } from "./teams.js";

export interface NormalizedCoolifyResource {
  id: string;
  teamId?: string;
  resourceType: "application" | "service";
  resourceUuid: string;
  name: string;
  description: string;
  status: string | null;
  sourceType: string | null;
  branch: string | null;
  commitSha: string | null;
  serverUuid?: string | null;
  deploymentInProgress?: boolean;
  lastSuccessfulDeploymentAt?: string | null;
  suggestedUrls: string[];
  createdAtSource: string | null;
  updatedAtSource: string | null;
  syncedAt: string;
}

export interface CoolifySyncWarning {
  source: "applications" | "services" | "sentinel" | "deployments";
  code: string;
  message: string;
  status?: number;
}

export interface NormalizedSentinelServer {
  teamId?: string;
  serverUuid: string;
  name: string;
  enabled: boolean;
  metricsEnabled: boolean;
  refreshRateSeconds: number | null;
  historyDays: number | null;
  pushIntervalSeconds: number | null;
  lastReportedAt: string | null;
  syncedAt: string;
}

export interface CoolifySyncResult {
  resources: NormalizedCoolifyResource[];
  warnings: CoolifySyncWarning[];
  applicationsSucceeded?: boolean;
  servicesSucceeded?: boolean;
}

export class CoolifySyncError extends Error {
  readonly code = "COOLIFY_SYNC_FAILED";
  readonly status = 502;

  constructor(readonly warnings: CoolifySyncWarning[]) {
    super([...new Set(warnings.map((warning) => warning.message.replace(/ while requesting \/(?:applications|services)/, "")))].join(" ") || "Coolify synchronization failed.");
  }
}

class CoolifyRequestError extends Error {
  constructor(readonly path: string, readonly status: number, message: string) {
    super(message);
  }
}

export class CoolifyClient {
  constructor(private readonly config: AppConfig, private readonly connection?: TeamConnection) {}

  forTeam(connection: TeamConnection) { return new CoolifyClient(this.config, connection); }

  private get apiUrl() { return this.connection?.apiUrl ?? this.config.coolifyApiUrl; }
  private get apiKey() { return this.connection?.token ?? this.config.COOLIFY_API_KEY; }
  private get teamId() { return this.connection?.id ?? "legacy-default"; }

  get configured() {
    return Boolean(this.apiUrl && this.apiKey);
  }

  async listResources(): Promise<CoolifySyncResult> {
    if (!this.apiUrl || !this.apiKey) {
      throw new CoolifySyncError([{ source: "applications", code: "COOLIFY_NOT_CONFIGURED", message: "Add COOLIFY_API_URL and COOLIFY_API_KEY before synchronizing." }]);
    }
    const [applicationResult, serviceResult] = await Promise.allSettled([
      this.getArray("/applications"),
      this.getArray("/services"),
    ]);
    const now = new Date().toISOString();
    const warnings: CoolifySyncWarning[] = [];
    const applications = settledValue(applicationResult, "applications", warnings);
    const services = settledValue(serviceResult, "services", warnings);
    if (!applications && !services) throw new CoolifySyncError(warnings);
    const normalizedApplications = (applications ?? []).map((item) => normalizeApplication(item, now, this.teamId));
    const deploymentResults = await Promise.allSettled(normalizedApplications.map((application) => this.deploymentMetadata(application.resourceUuid)));
    deploymentResults.forEach((result, index) => {
      if (result.status === "fulfilled") Object.assign(normalizedApplications[index]!, result.value);
      else warnings.push(warningFor(result.reason, "deployments"));
    });
    return { resources: [...normalizedApplications, ...(services ?? []).map((item) => normalizeService(item, now, this.teamId))], warnings, applicationsSucceeded: Boolean(applications), servicesSucceeded: Boolean(services) };
  }

  async listSentinelStatus(): Promise<{ servers: NormalizedSentinelServer[]; warnings: CoolifySyncWarning[] }> {
    if (!this.apiUrl || !this.apiKey) return { servers: [], warnings: [] };
    let servers: Record<string, unknown>[];
    try { servers = await this.getArray("/servers"); }
    catch (error) { return { servers: [], warnings: [warningFor(error, "sentinel")] }; }
    const candidates = servers.map((server) => ({ uuid: nullableText(server.uuid), name: safeText(server.name, "Coolify server"), embedded: embeddedSentinelSettings(server) })).filter((server): server is { uuid: string; name: string; embedded: Record<string, unknown> | null } => Boolean(server.uuid));
    const results = await Promise.allSettled(candidates.map(async (server) => {
      try { return { server, settings: await this.getObject(`/servers/${encodeURIComponent(server.uuid)}/sentinel`) }; }
      catch (error) { if (server.embedded) return { server, settings: server.embedded }; throw error; }
    }));
    const warnings: CoolifySyncWarning[] = [];
    const syncedAt = new Date().toISOString();
    const normalized: NormalizedSentinelServer[] = [];
    for (const result of results) {
      if (result.status === "rejected") { warnings.push(warningFor(result.reason, "sentinel")); continue; }
      const { server, settings } = result.value;
      normalized.push({
        serverUuid: server.uuid,
        name: server.name,
        enabled: Boolean(settings.is_sentinel_enabled),
        metricsEnabled: Boolean(settings.is_metrics_enabled),
        refreshRateSeconds: nullableNumber(settings.sentinel_metrics_refresh_rate_seconds),
        historyDays: nullableNumber(settings.sentinel_metrics_history_days),
        pushIntervalSeconds: nullableNumber(settings.sentinel_push_interval_seconds),
        lastReportedAt: nullableText(settings.sentinel_updated_at),
        syncedAt,
      });
    }
    return { servers: normalized, warnings };
  }

  private async getArray(path: string): Promise<Record<string, unknown>[]> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw requestFailure(path, error);
    }
    if (!response.ok) throw new CoolifyRequestError(path, response.status, statusMessage(path, response.status));
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new CoolifyRequestError(path, 502, `Coolify ${path} returned an unexpected response.`);
    return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  }

  private async getObject(path: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    } catch (error) { throw requestFailure(path, error); }
    if (!response.ok) throw new CoolifyRequestError(path, response.status, statusMessage(path, response.status));
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CoolifyRequestError(path, 502, `Coolify ${path} returned an unexpected response.`);
    return payload as Record<string, unknown>;
  }

  private async deploymentMetadata(applicationUuid: string) {
    const path = `/deployments/applications/${encodeURIComponent(applicationUuid)}?take=20`;
    let response: Response;
    try { response = await fetch(`${this.apiUrl}${path}`, { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }); }
    catch (error) { throw requestFailure(path, error); }
    if (!response.ok) throw new CoolifyRequestError(path, response.status, statusMessage(path, response.status));
    const payload: unknown = await response.json();
    const raw = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).deployments) ? (payload as { deployments: unknown[] }).deployments : [];
    const deployments = raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    const deploymentInProgress = deployments.some((item) => ["queued", "in_progress"].includes(String(item.status)));
    const successful = deployments.filter((item) => String(item.status) === "finished").sort((a, b) => deploymentTimestamp(b).localeCompare(deploymentTimestamp(a)))[0];
    return { deploymentInProgress, lastSuccessfulDeploymentAt: successful ? deploymentTimestamp(successful) || null : null };
  }
}

function settledValue(result: PromiseSettledResult<Record<string, unknown>[]>, source: CoolifySyncWarning["source"], warnings: CoolifySyncWarning[]) {
  if (result.status === "fulfilled") return result.value;
  const error = result.reason;
  warnings.push({
    source,
    code: error instanceof CoolifyRequestError ? error.status === 401 ? "COOLIFY_UNAUTHORIZED" : error.status === 403 ? "COOLIFY_FORBIDDEN" : "COOLIFY_REQUEST_FAILED" : error instanceof Error && error.message.includes("certificate") ? "COOLIFY_TLS_UNTRUSTED" : "COOLIFY_UNREACHABLE",
    message: error instanceof Error ? error.message : `Could not fetch Coolify ${source}.`,
    status: error instanceof CoolifyRequestError ? error.status : undefined,
  });
  return null;
}

function warningFor(error: unknown, source: CoolifySyncWarning["source"]): CoolifySyncWarning {
  return {
    source,
    code: error instanceof CoolifyRequestError ? error.status === 401 ? "COOLIFY_UNAUTHORIZED" : error.status === 403 ? "COOLIFY_FORBIDDEN" : "COOLIFY_REQUEST_FAILED" : error instanceof Error && error.message.includes("certificate") ? "COOLIFY_TLS_UNTRUSTED" : "COOLIFY_UNREACHABLE",
    message: error instanceof Error ? error.message : `Could not fetch Coolify ${source}.`,
    status: error instanceof CoolifyRequestError ? error.status : undefined,
  };
}

function requestFailure(path: string, error: unknown) {
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code: unknown }).code) : "";
  if (["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code)) {
    return new Error(`Coolify TLS certificate is not trusted while requesting ${path}. Install a publicly trusted certificate or add its CA with NODE_EXTRA_CA_CERTS.`);
  }
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return new Error(`Coolify timed out while requesting ${path}. Check the API URL and network access.`);
  if (error instanceof Error && error.name === "TimeoutError") return new Error(`Coolify timed out while requesting ${path}.`);
  return new Error(`Coolify could not be reached while requesting ${path}. Check the API URL, DNS, and TLS certificate.`);
}

function statusMessage(path: string, status: number) {
  if (status === 401) return "Coolify rejected the API token (401). Create a new token and copy its complete ID|secret value.";
  if (status === 403) return "Coolify denied access (403). Give the token read permission and check the API IP allowlist.";
  if (status === 404 || status === 405) return `This Coolify version does not expose ${path} (${status}). Other resource types can still synchronize.`;
  if (status === 429) return "Coolify rate-limited the catalog request. Wait a moment and try again.";
  return `Coolify ${path} returned HTTP ${status}.`;
}

export function persistCoolifyResources(db: DatabaseContext, resources: NormalizedCoolifyResource[]) {
  const statement = db.sqlite.prepare(`
    INSERT INTO coolify_resources
      (id, team_id, resource_type, resource_uuid, name, description, status, source_type, source_branch, commit_sha, suggested_urls_json, created_at_source, updated_at_source, server_uuid, deployment_in_progress, last_successful_deployment_at, synced_at)
    VALUES (@id, @teamId, @resourceType, @resourceUuid, @name, @description, @status, @sourceType, @branch, @commitSha, @suggestedUrlsJson, @createdAtSource, @updatedAtSource, @serverUuid, @deploymentInProgress, @lastSuccessfulDeploymentAt, @syncedAt)
    ON CONFLICT(team_id, resource_type, resource_uuid) DO UPDATE SET
      name=excluded.name, description=excluded.description, status=excluded.status,
      source_type=excluded.source_type, source_branch=excluded.source_branch, commit_sha=excluded.commit_sha,
      suggested_urls_json=excluded.suggested_urls_json, created_at_source=excluded.created_at_source,
      updated_at_source=excluded.updated_at_source, server_uuid=excluded.server_uuid,
      deployment_in_progress=CASE WHEN @hasDeploymentMetadata=1 THEN excluded.deployment_in_progress ELSE coolify_resources.deployment_in_progress END,
      last_successful_deployment_at=CASE WHEN @hasDeploymentMetadata=1 THEN excluded.last_successful_deployment_at ELSE coolify_resources.last_successful_deployment_at END,
      synced_at=excluded.synced_at
  `);
  db.sqlite.transaction((items: NormalizedCoolifyResource[]) => {
    for (const item of items) {
      const teamId = item.teamId ?? "legacy-default";
      const id = item.id.includes(`${teamId}:`) ? item.id : `${teamId}:${item.resourceType}:${item.resourceUuid}`;
      statement.run({ ...item, id, teamId, serverUuid: item.serverUuid ?? null, deploymentInProgress: Number(item.deploymentInProgress ?? false), lastSuccessfulDeploymentAt: item.lastSuccessfulDeploymentAt ?? null, hasDeploymentMetadata: Number(item.deploymentInProgress !== undefined), suggestedUrlsJson: JSON.stringify(item.suggestedUrls) });
    }
  })(resources);
}

export function persistSentinelServers(db: DatabaseContext, servers: NormalizedSentinelServer[]) {
  const statement = db.sqlite.prepare(`INSERT INTO sentinel_servers(team_id,server_uuid,name,enabled,metrics_enabled,refresh_rate_seconds,history_days,push_interval_seconds,last_reported_at,synced_at) VALUES(@teamId,@serverUuid,@name,@enabled,@metricsEnabled,@refreshRateSeconds,@historyDays,@pushIntervalSeconds,@lastReportedAt,@syncedAt) ON CONFLICT(team_id,server_uuid) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,metrics_enabled=excluded.metrics_enabled,refresh_rate_seconds=excluded.refresh_rate_seconds,history_days=excluded.history_days,push_interval_seconds=excluded.push_interval_seconds,last_reported_at=excluded.last_reported_at,synced_at=excluded.synced_at`);
  db.sqlite.transaction((items: NormalizedSentinelServer[]) => items.forEach((item) => statement.run({ ...item, teamId: item.teamId ?? "legacy-default", enabled: Number(item.enabled), metricsEnabled: Number(item.metricsEnabled) })))(servers);
}

function normalizeApplication(item: Record<string, unknown>, syncedAt: string, teamId: string): NormalizedCoolifyResource {
  const fqdn = typeof item.fqdn === "string" ? item.fqdn : "";
  return {
    id: `${teamId}:application:${String(item.uuid)}`,
    teamId,
    resourceType: "application",
    resourceUuid: String(item.uuid),
    name: safeText(item.name, "Untitled application"),
    description: safeText(item.description),
    status: nullableText(item.status),
    sourceType: nullableText(item.build_pack ?? item.source_type),
    branch: nullableText(item.git_branch),
    commitSha: nullableText(item.git_commit_sha)?.slice(0, 12) ?? null,
    serverUuid: resourceServerUuid(item),
    suggestedUrls: uniqueUrls(fqdn.split(",")),
    createdAtSource: nullableText(item.created_at),
    updatedAtSource: nullableText(item.updated_at),
    syncedAt,
  };
}

function normalizeService(item: Record<string, unknown>, syncedAt: string, teamId: string): NormalizedCoolifyResource {
  const candidates: unknown[] = [];
  for (const key of ["fqdn", "url", "urls", "domains", "applications"]) candidates.push(item[key]);
  return {
    id: `${teamId}:service:${String(item.uuid)}`,
    teamId,
    resourceType: "service",
    resourceUuid: String(item.uuid),
    name: safeText(item.name, "Untitled service"),
    description: safeText(item.description),
    status: nullableText(item.status),
    sourceType: nullableText(item.service_type ?? item.type),
    branch: null,
    commitSha: null,
    serverUuid: resourceServerUuid(item),
    deploymentInProgress: false,
    lastSuccessfulDeploymentAt: null,
    suggestedUrls: uniqueUrls(flattenUrlCandidates(candidates)),
    createdAtSource: nullableText(item.created_at),
    updatedAtSource: nullableText(item.updated_at),
    syncedAt,
  };
}

function flattenUrlCandidates(values: unknown[]): string[] {
  const output: string[] = [];
  for (const value of values) {
    if (typeof value === "string") output.push(...value.split(","));
    else if (Array.isArray(value)) output.push(...flattenUrlCandidates(value));
    else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      output.push(...flattenUrlCandidates([record.fqdn, record.url, record.domain, record.urls]));
    }
  }
  return output;
}

function uniqueUrls(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean).map((value) => {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try { return new URL(normalized).toString().replace(/\/$/, ""); } catch { return ""; }
  }).filter(Boolean))];
}

function safeText(value: unknown, fallback = "") { return typeof value === "string" ? value.slice(0, 500) : fallback; }
function nullableText(value: unknown) { return typeof value === "string" ? value.slice(0, 255) : null; }
function nullableNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function deploymentTimestamp(item: Record<string, unknown>) { return nullableText(item.finished_at ?? item.updated_at ?? item.created_at) ?? ""; }
function resourceServerUuid(item: Record<string, unknown>) {
  const destination = item.destination && typeof item.destination === "object" ? item.destination as Record<string, unknown> : null;
  const server = destination?.server && typeof destination.server === "object" ? destination.server as Record<string, unknown> : item.server && typeof item.server === "object" ? item.server as Record<string, unknown> : null;
  return nullableText(item.server_uuid ?? destination?.server_uuid ?? server?.uuid);
}
function embeddedSentinelSettings(server: Record<string, unknown>) {
  const settings = server.settings && typeof server.settings === "object" && !Array.isArray(server.settings) ? server.settings as Record<string, unknown> : server;
  return ["is_sentinel_enabled", "is_metrics_enabled", "sentinel_metrics_refresh_rate_seconds", "sentinel_updated_at"].some((key) => key in settings) ? settings : null;
}

export function createUnlinkedResourceId() { return randomUUID(); }
