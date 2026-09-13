import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { DatabaseContext } from "../db/index.js";
import { decryptToken, encryptToken, CredentialsKeyError } from "./credentials.js";
import type { CoolifySyncWarning, NormalizedSentinelServer } from "./client.js";

export type TeamSyncStatus = "never" | "success" | "partial" | "error";
export type TeamCredentialSource = "environment" | "database";

export interface CoolifyTeamSummary {
  id: string;
  name: string;
  apiUrl: string | null;
  credentialSource: TeamCredentialSource;
  tokenConfigured: boolean;
  enabled: boolean;
  syncStatus: TeamSyncStatus | "disabled";
  lastAttemptAt: string | null;
  lastSuccessfulAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  syncedResourceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamConnection {
  id: string;
  name: string;
  apiUrl: string;
  token: string;
  credentialSource: TeamCredentialSource;
}

export interface TeamInput {
  name: string;
  apiUrl: string;
  token?: string;
  enabled: boolean;
}

export class TeamValidationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export class CoolifyTeamRepository {
  constructor(private readonly db: DatabaseContext, private readonly config: AppConfig) {
    this.reconcileLegacyTeam();
  }

  list(): CoolifyTeamSummary[] {
    return (this.db.sqlite.prepare(`SELECT * FROM coolify_teams ORDER BY name COLLATE NOCASE`).all() as Record<string, unknown>[]).map((row) => this.toSummary(row));
  }

  get(id: string) {
    const row = this.db.sqlite.prepare(`SELECT * FROM coolify_teams WHERE id=?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.toSummary(row) : null;
  }

  connection(id: string): TeamConnection {
    const row = this.db.sqlite.prepare(`SELECT * FROM coolify_teams WHERE id=?`).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new TeamValidationError("COOLIFY_TEAM_NOT_FOUND");
    const source = String(row.credential_source) as TeamCredentialSource;
    if (source === "environment") {
      if (id !== "legacy-default" || !this.config.coolifyApiUrl || !this.config.COOLIFY_API_KEY) throw new TeamValidationError("COOLIFY_TEAM_CREDENTIALS_UNAVAILABLE");
      return { id, name: String(row.name), apiUrl: this.config.coolifyApiUrl, token: this.config.COOLIFY_API_KEY, credentialSource: source };
    }
    if (!row.token_ciphertext || !row.token_iv || !row.token_auth_tag) throw new TeamValidationError("COOLIFY_TEAM_CREDENTIALS_UNAVAILABLE");
    const token = decryptToken({ ciphertext: String(row.token_ciphertext), iv: String(row.token_iv), authTag: String(row.token_auth_tag) }, this.config);
    const apiUrl = typeof row.api_url === "string" ? row.api_url : "";
    if (!apiUrl) throw new TeamValidationError("COOLIFY_TEAM_URL_REQUIRED");
    return { id, name: String(row.name), apiUrl, token, credentialSource: source };
  }

  create(input: TeamInput) {
    const validated = validateTeamInput(input);
    if (this.db.sqlite.prepare(`SELECT id FROM coolify_teams WHERE name=? COLLATE NOCASE`).get(validated.name)) throw new TeamValidationError("COOLIFY_TEAM_NAME_TAKEN");
    if (!validated.token) throw new TeamValidationError("COOLIFY_TEAM_TOKEN_REQUIRED");
    const encrypted = encryptToken(validated.token, this.config);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.sqlite.prepare(`INSERT INTO coolify_teams(id,name,api_url,credential_source,token_ciphertext,token_iv,token_auth_tag,enabled,sync_status,synced_resource_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'never',0,?,?)`).run(id, validated.name, validated.apiUrl, "database", encrypted.ciphertext, encrypted.iv, encrypted.authTag, Number(validated.enabled), now, now);
    return this.get(id)!;
  }

  update(id: string, input: Partial<TeamInput>) {
    const current = this.db.sqlite.prepare(`SELECT * FROM coolify_teams WHERE id=?`).get(id) as Record<string, unknown> | undefined;
    if (!current) throw new TeamValidationError("COOLIFY_TEAM_NOT_FOUND");
    if (String(current.credential_source) === "environment") {
      const name = input.name == null ? String(current.name) : validateTeamName(input.name);
      if (this.db.sqlite.prepare(`SELECT id FROM coolify_teams WHERE name=? COLLATE NOCASE AND id<>?`).get(name, id)) throw new TeamValidationError("COOLIFY_TEAM_NAME_TAKEN");
      this.db.sqlite.prepare(`UPDATE coolify_teams SET name=?,enabled=?,updated_at=? WHERE id=?`).run(name, Number(input.enabled ?? Boolean(current.enabled)), new Date().toISOString(), id);
      return this.get(id)!;
    }
    const name = input.name == null ? String(current.name) : validateTeamName(input.name);
    const apiUrl = input.apiUrl == null ? String(current.api_url ?? "") : normalizeApiUrl(input.apiUrl);
    if (this.db.sqlite.prepare(`SELECT id FROM coolify_teams WHERE name=? COLLATE NOCASE AND id<>?`).get(name, id)) throw new TeamValidationError("COOLIFY_TEAM_NAME_TAKEN");
    const encrypted = input.token?.trim() ? encryptToken(input.token.trim(), this.config) : null;
    const now = new Date().toISOString();
    this.db.sqlite.prepare(`UPDATE coolify_teams SET name=?,api_url=?,token_ciphertext=COALESCE(?,token_ciphertext),token_iv=COALESCE(?,token_iv),token_auth_tag=COALESCE(?,token_auth_tag),enabled=?,updated_at=? WHERE id=?`).run(name, apiUrl, encrypted?.ciphertext ?? null, encrypted?.iv ?? null, encrypted?.authTag ?? null, Number(input.enabled ?? Boolean(current.enabled)), now, id);
    return this.get(id)!;
  }

  markSync(id: string, result: { status: TeamSyncStatus; attemptAt: string; successfulAt?: string; error?: { code: string; message: string } | null; resourceCount: number }) {
    this.db.sqlite.prepare(`UPDATE coolify_teams SET sync_status=?,last_attempt_at=?,last_successful_at=COALESCE(?,last_successful_at),last_error_code=?,last_error_message=?,synced_resource_count=?,updated_at=? WHERE id=?`).run(result.status, result.attemptAt, result.successfulAt ?? null, result.error?.code ?? null, result.error?.message ?? null, result.resourceCount, new Date().toISOString(), id);
  }

  setEnabled(id: string, enabled: boolean) {
    if (!this.db.sqlite.prepare(`SELECT id FROM coolify_teams WHERE id=?`).get(id)) throw new TeamValidationError("COOLIFY_TEAM_NOT_FOUND");
    this.db.sqlite.prepare(`UPDATE coolify_teams SET enabled=?,updated_at=? WHERE id=?`).run(Number(enabled), new Date().toISOString(), id);
    return this.get(id)!;
  }

  private reconcileLegacyTeam() {
    if (!this.config.coolifyApiUrl) return;
    this.db.sqlite.prepare(`UPDATE coolify_teams SET api_url=?,name=CASE WHEN name='Default team' THEN ? ELSE name END,updated_at=? WHERE id='legacy-default' AND credential_source='environment' AND (name=? COLLATE NOCASE OR NOT EXISTS (SELECT 1 FROM coolify_teams other WHERE other.name=? COLLATE NOCASE AND other.id<>'legacy-default'))`).run(this.config.coolifyApiUrl, this.config.COOLIFY_TEAM_NAME, new Date().toISOString(), this.config.COOLIFY_TEAM_NAME, this.config.COOLIFY_TEAM_NAME);
  }

  private toSummary(row: Record<string, unknown>): CoolifyTeamSummary {
    const source = String(row.credential_source) as TeamCredentialSource;
    return {
      id: String(row.id), name: String(row.name), apiUrl: row.api_url ? String(row.api_url) : null, credentialSource: source,
      tokenConfigured: source === "environment" ? Boolean(this.config.COOLIFY_API_KEY) : Boolean(row.token_ciphertext),
      enabled: Boolean(Number(row.enabled)), syncStatus: !Number(row.enabled) ? "disabled" : String(row.sync_status) as TeamSyncStatus,
      lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null, lastSuccessfulAt: row.last_successful_at ? String(row.last_successful_at) : null,
      lastErrorCode: row.last_error_code ? String(row.last_error_code) : null, lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
      syncedResourceCount: Number(row.synced_resource_count ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }
}

export interface TeamSyncOutcome {
  team: CoolifyTeamSummary;
  status: TeamSyncStatus | "disabled";
  resources: number;
  warnings: CoolifySyncWarning[];
}

export type TeamSyncFetcher = (connection: TeamConnection) => Promise<{ resources: import("./client.js").NormalizedCoolifyResource[]; warnings: CoolifySyncWarning[]; sentinel: { servers: NormalizedSentinelServer[]; warnings: CoolifySyncWarning[] } }>;

function validateTeamInput(input: TeamInput): Required<TeamInput> {
  return { name: validateTeamName(input.name), apiUrl: normalizeApiUrl(input.apiUrl), token: input.token?.trim() ?? "", enabled: Boolean(input.enabled) };
}

function validateTeamName(value: string) {
  const name = value.trim();
  if (!name || name.length > 120) throw new TeamValidationError("COOLIFY_TEAM_NAME_INVALID");
  return name;
}

export function normalizeApiUrl(value: string) {
  const raw = value.trim().replace(/\/$/, "");
  let url: URL;
  try { url = new URL(raw); } catch { throw new TeamValidationError("COOLIFY_TEAM_URL_INVALID"); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TeamValidationError("COOLIFY_TEAM_URL_INVALID");
  const origin = `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  return origin.endsWith("/api/v1") ? origin : `${origin}/api/v1`;
}

export function summarizeWarnings(warnings: CoolifySyncWarning[]) {
  const first = warnings[0];
  return first ? { code: first.code, message: first.message.replaceAll(/Bearer\s+\S+/gi, "Bearer [redacted]") } : null;
}

export { CredentialsKeyError };
