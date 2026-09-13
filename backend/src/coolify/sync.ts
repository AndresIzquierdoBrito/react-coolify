import type { AppConfig } from "../config.js";
import type { DatabaseContext } from "../db/index.js";
import { CoolifyClient, CoolifySyncError, persistCoolifyResources, persistSentinelServers } from "./client.js";
import { CoolifyTeamRepository, type CoolifyTeamSummary, type TeamSyncOutcome, type TeamSyncStatus, summarizeWarnings } from "./teams.js";

export class CoolifySyncOrchestrator {
  private active?: Promise<TeamSyncOutcome[]>;

  constructor(private readonly db: DatabaseContext, private readonly config: AppConfig, private readonly teams: CoolifyTeamRepository, private readonly client: CoolifyClient) {}

  syncAll() {
    if (this.active) return this.active;
    this.active = Promise.all(this.teams.list().filter((team) => team.enabled && (team.id !== "legacy-default" || team.tokenConfigured)).map((team) => this.runTeam(team.id))).finally(() => { this.active = undefined; });
    return this.active;
  }

  async syncTeam(id: string): Promise<TeamSyncOutcome> {
    const current = this.teams.get(id);
    if (current && !current.enabled) return { team: current, status: "disabled", resources: current.syncedResourceCount, warnings: [] };
    if (this.active) {
      const outcomes = await this.active;
      const outcome = outcomes.find((item) => item.team.id === id);
      if (outcome) return outcome;
    }
    const run = this.runTeam(id);
    this.active = run.then((outcome) => [outcome]).finally(() => { this.active = undefined; });
    return run;
  }

  private async runTeam(id: string): Promise<TeamSyncOutcome> {
    const summary = this.teams.get(id);
    if (!summary) throw new Error("COOLIFY_TEAM_NOT_FOUND");
    if (!summary.enabled) return { team: summary, status: "disabled", resources: summary.syncedResourceCount, warnings: [] };
    const attemptAt = new Date().toISOString();
    let connection;
    try {
      connection = this.teams.connection(id);
    } catch (error) {
      const detail = { code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "COOLIFY_TEAM_CREDENTIALS_UNAVAILABLE", message: error instanceof Error ? error.message : "Coolify team credentials are unavailable." };
      this.teams.markSync(id, { status: "error", attemptAt, error: detail, resourceCount: summary.syncedResourceCount });
      return { team: this.teams.get(id)!, status: "error", resources: summary.syncedResourceCount, warnings: [{ source: "applications", code: detail.code, message: detail.message }] };
    }
    try {
      const teamClient = this.client.forTeam(connection);
      const result = await teamClient.listResources();
      persistCoolifyResources(this.db, result.resources.map((item) => ({ ...item, teamId: id, id: `${id}:${item.resourceType}:${item.resourceUuid}` })));
      const sentinel = await teamClient.listSentinelStatus();
      persistSentinelServers(this.db, sentinel.servers.map((server) => ({ ...server, teamId: id })));
      const warnings = [...result.warnings, ...sentinel.warnings];
      const status: TeamSyncStatus = result.applicationsSucceeded && result.servicesSucceeded ? "success" : "partial";
      const error = status === "partial" ? summarizeWarnings(warnings) : null;
      this.teams.markSync(id, { status, attemptAt, successfulAt: status === "success" ? attemptAt : undefined, error, resourceCount: result.resources.length });
      return { team: this.teams.get(id)!, status, resources: result.resources.length, warnings };
    } catch (error) {
      const warnings = error instanceof CoolifySyncError ? error.warnings : [{ source: "applications" as const, code: "COOLIFY_SYNC_FAILED", message: error instanceof Error ? error.message : "Coolify synchronization failed." }];
      const detail = summarizeWarnings(warnings) ?? { code: "COOLIFY_SYNC_FAILED", message: "Coolify synchronization failed." };
      this.teams.markSync(id, { status: "error", attemptAt, error: detail, resourceCount: summary.syncedResourceCount });
      return { team: this.teams.get(id)!, status: "error", resources: summary.syncedResourceCount, warnings };
    }
  }
}

export function aggregateWarnings(outcomes: TeamSyncOutcome[]) {
  return outcomes.flatMap((outcome) => outcome.warnings.map((warning) => ({ ...warning, teamId: outcome.team.id, teamName: outcome.team.name })));
}
