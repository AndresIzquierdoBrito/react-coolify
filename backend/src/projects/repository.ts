import { randomUUID } from "node:crypto";
import type { Locale, ProjectInput, ProjectSummary } from "@izbri/contracts";
import type { DatabaseContext } from "../db/index.js";

type Row = Record<string, unknown>;

export class ProjectValidationError extends Error {
  constructor(code: string, readonly fields: (keyof ProjectInput)[]) { super(code); }
}

export class ProjectRepository {
  constructor(private readonly db: DatabaseContext, private readonly monitorIntervalMs = 60_000, private readonly now = () => Date.now()) {}

  listPublic(locale: Locale, filters: { status?: string; technology?: string; resourceType?: string; sort?: string }) {
    const rows = this.db.sqlite.prepare(`
      SELECT p.*, cr.resource_type, cr.created_at_source, cr.updated_at_source, cr.status AS coolify_status,
        cr.source_type, cr.source_branch, cr.commit_sha, cr.deployment_in_progress,cr.last_successful_deployment_at,cr.synced_at, hs.status, hs.streak_started_at, hs.first_checked_at, hs.monitor_interval_ms_at_start,
        ss.enabled AS sentinel_enabled, ss.metrics_enabled AS sentinel_metrics_enabled,
        ss.refresh_rate_seconds AS sentinel_refresh_rate_seconds, ss.history_days AS sentinel_history_days,
        ss.push_interval_seconds AS sentinel_push_interval_seconds, ss.last_reported_at AS sentinel_last_reported_at,
        hs.latency_ms, hs.last_checked_at, m.large_path, m.small_path, m.alt_en, m.alt_es
      FROM projects p
      JOIN coolify_resources cr ON cr.id=p.coolify_resource_id
      JOIN coolify_teams ct ON ct.id=cr.team_id AND ct.enabled=1
      LEFT JOIN health_state hs ON hs.project_id=p.id
      LEFT JOIN media m ON m.project_id=p.id
      LEFT JOIN sentinel_servers ss ON ss.team_id=cr.team_id AND ss.server_uuid=cr.server_uuid
      WHERE p.published=1
    `).all() as Row[];
    let projects = rows.map((row) => this.toSummary(row, locale));
    if (filters.status) projects = projects.filter((project) => project.health.status === filters.status);
    if (filters.resourceType) projects = projects.filter((project) => project.resourceTypes.includes(filters.resourceType as "application" | "service"));
    if (filters.technology) projects = projects.filter((project) => project.technologies.some((tech) => tech.slug === filters.technology));
    const sort = filters.sort ?? "curated";
    projects.sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title, locale);
      if (sort === "uptime") return (b.health.uptime30d ?? -1) - (a.health.uptime30d ?? -1);
      if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
      return Number(b.featured) - Number(a.featured) || a.displayOrder - b.displayOrder;
    });
    return projects;
  }

  getPublicBySlug(slug: string, locale: Locale) {
    const row = this.db.sqlite.prepare(`
      SELECT p.*, cr.resource_type, cr.created_at_source, cr.updated_at_source, cr.status AS coolify_status,
        cr.source_type, cr.source_branch, cr.commit_sha, cr.deployment_in_progress,cr.last_successful_deployment_at,cr.synced_at, hs.status, hs.streak_started_at, hs.first_checked_at, hs.monitor_interval_ms_at_start,
        ss.enabled AS sentinel_enabled, ss.metrics_enabled AS sentinel_metrics_enabled,
        ss.refresh_rate_seconds AS sentinel_refresh_rate_seconds, ss.history_days AS sentinel_history_days,
        ss.push_interval_seconds AS sentinel_push_interval_seconds, ss.last_reported_at AS sentinel_last_reported_at,
        hs.latency_ms, hs.last_checked_at, m.large_path, m.small_path, m.alt_en, m.alt_es
      FROM projects p JOIN coolify_resources cr ON cr.id=p.coolify_resource_id JOIN coolify_teams ct ON ct.id=cr.team_id AND ct.enabled=1
      LEFT JOIN health_state hs ON hs.project_id=p.id LEFT JOIN media m ON m.project_id=p.id
      LEFT JOIN sentinel_servers ss ON ss.team_id=cr.team_id AND ss.server_uuid=cr.server_uuid
      WHERE p.slug=? AND p.published=1
    `).get(slug) as Row | undefined;
    return row ? this.toDetail(row, locale) : null;
  }

  getAdminPreview(id: string, locale: Locale) {
    const row = this.db.sqlite.prepare(`
      SELECT p.*, cr.resource_type,cr.created_at_source,cr.updated_at_source,cr.status AS coolify_status,
        cr.source_type,cr.source_branch,cr.commit_sha,cr.deployment_in_progress,cr.last_successful_deployment_at,cr.synced_at,
        hs.status,hs.streak_started_at,hs.latency_ms,hs.last_checked_at,hs.first_checked_at,hs.monitor_interval_ms_at_start,
        ss.enabled AS sentinel_enabled,ss.metrics_enabled AS sentinel_metrics_enabled,
        ss.refresh_rate_seconds AS sentinel_refresh_rate_seconds,ss.history_days AS sentinel_history_days,
        ss.push_interval_seconds AS sentinel_push_interval_seconds,ss.last_reported_at AS sentinel_last_reported_at,
        m.large_path,m.small_path,m.alt_en,m.alt_es
      FROM projects p JOIN coolify_resources cr ON cr.id=p.coolify_resource_id JOIN coolify_teams ct ON ct.id=cr.team_id
      LEFT JOIN health_state hs ON hs.project_id=p.id LEFT JOIN media m ON m.project_id=p.id
      LEFT JOIN sentinel_servers ss ON ss.team_id=cr.team_id AND ss.server_uuid=cr.server_uuid WHERE p.id=?
    `).get(id) as Row | undefined;
    return row ? this.toDetail(row, locale) : null;
  }

  getAdminProjects() {
    return this.db.sqlite.prepare(`
      SELECT p.*, cr.name AS coolify_name, cr.resource_type, cr.resource_uuid, cr.team_id,
        m.large_path, m.small_path, m.alt_en, m.alt_es
      FROM projects p JOIN coolify_resources cr ON cr.id=p.coolify_resource_id JOIN coolify_teams ct ON ct.id=cr.team_id
      LEFT JOIN media m ON m.project_id=p.id ORDER BY p.display_order, p.created_at
    `).all().map((value) => { const row = value as Row; return { ...row, technologies: this.technologiesFor(String(row.id)), gallery: this.galleryForAdmin(String(row.id)), resources: this.adminResourcesFor(String(row.id)) }; });
  }

  import(resourceType: string, resourceUuid: string, liveUrl: string, teamId = "legacy-default") {
    const resource = this.db.sqlite.prepare(`SELECT * FROM coolify_resources WHERE team_id=? AND resource_type=? AND resource_uuid=?`).get(teamId, resourceType, resourceUuid) as Row | undefined;
    return this.importResource(resource, liveUrl);
  }

  importById(resourceId: string, liveUrl: string) {
    const resource = this.db.sqlite.prepare(`SELECT * FROM coolify_resources WHERE id=?`).get(resourceId) as Row | undefined;
    return this.importResource(resource, liveUrl);
  }

  private importResource(resource: Row | undefined, liveUrl: string) {
    if (!resource) throw new Error("RESOURCE_NOT_FOUND");
    const existing = this.db.sqlite.prepare(`SELECT id FROM projects WHERE coolify_resource_id=?`).get(resource.id);
    if (existing) throw new Error("RESOURCE_ALREADY_IMPORTED");
    const id = randomUUID();
    const now = new Date().toISOString();
    const uptimeStartDate = calendarDateFromIso(resource.created_at_source) ?? now.slice(0, 10);
    const slug = this.uniqueSlug(slugify(String(resource.name)) || `project-${id.slice(0, 8)}`);
    const max = this.db.sqlite.prepare(`SELECT COALESCE(MAX(display_order), -1) AS value FROM projects`).get() as { value: number };
    this.db.sqlite.prepare(`
      INSERT INTO projects(id,coolify_resource_id,slug,title_en,title_es,live_url,health_url,uptime_start_date,display_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, resource.id, slug, resource.name, resource.name, liveUrl, liveUrl, uptimeStartDate, max.value + 1, now, now);
    this.db.sqlite.prepare(`INSERT INTO health_state(project_id,status) VALUES(?, 'collecting')`).run(id);
    this.db.sqlite.prepare(`
      INSERT INTO project_resources(id,project_id,coolify_resource_id,label_en,label_es,display_order,uptime_enabled,health_url,health_method,health_timeout_ms,expected_status_min,expected_status_max,uptime_start_date)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(`${id}:primary`, id, resource.id, resource.name, resource.name, 0, 1, liveUrl, "GET", 10_000, 200, 399, uptimeStartDate);
    this.db.sqlite.prepare(`INSERT INTO resource_health_state(project_resource_id,status) VALUES(?, 'collecting')`).run(`${id}:primary`);
    return id;
  }

  update(id: string, input: ProjectInput) {
    const resources = this.normalizedResourceInputs(id, input);
    const currentProjectDate = String((this.db.sqlite.prepare(`SELECT uptime_start_date FROM projects WHERE id=?`).get(id) as Row | undefined)?.uptime_start_date ?? "");
    const uptimeStartDate = resources[0]!.uptimeStartDate !== currentProjectDate ? resources[0]!.uptimeStartDate : input.uptimeStartDate ?? resources[0]!.uptimeStartDate;
    this.assertUptimeStartDate(id, uptimeStartDate);
    if (resources.some((resource) => resource.expectedStatusMin > resource.expectedStatusMax)) throw new Error("INVALID_STATUS_RANGE");
    for (const resource of resources) if (resource.uptimeEnabled) this.assertResourceUptimeStartDate(resource.resourceId, resource.uptimeStartDate);
    const primary = resources[0]!;
    const normalizedInput = { ...input, monitoringEnabled: input.monitoringEnabled ?? resources.some((resource) => resource.uptimeEnabled), uptimeStartDate, healthUrl: input.healthUrl ?? primary.healthUrl, healthMethod: input.healthMethod ?? primary.healthMethod, healthTimeoutMs: input.healthTimeoutMs ?? primary.healthTimeoutMs, expectedStatusMin: input.expectedStatusMin ?? primary.expectedStatusMin, expectedStatusMax: input.expectedStatusMax ?? primary.expectedStatusMax };
    if (normalizedInput.published) this.assertPublishable(id, normalizedInput);
    const urlOrNull = (value?: string) => value?.trim() || null;
    this.db.sqlite.transaction(() => {
      this.db.sqlite.prepare(`
        UPDATE projects SET slug=@slug,title_en=@titleEn,title_es=@titleEs,summary_en=@summaryEn,summary_es=@summaryEs,
          description_en=@descriptionEn,description_es=@descriptionEs,maintenance_message_en=@maintenanceMessageEn,
          maintenance_message_es=@maintenanceMessageEs,operational_notice_type=@operationalNoticeType,live_url=@liveUrl,repository_url=@repositoryUrl,
          case_study_url=@caseStudyUrl,featured=@featured,published=@published,display_order=@displayOrder,
          accent_color=@accentColor,
          monitoring_enabled=@monitoringEnabled,health_url=@healthUrl,health_method=@healthMethod,
          health_timeout_ms=@healthTimeoutMs,expected_status_min=@expectedStatusMin,expected_status_max=@expectedStatusMax,
          uptime_start_date=@uptimeStartDate,
          updated_at=@updatedAt WHERE id=@id
      `).run({ ...normalizedInput, id, repositoryUrl: urlOrNull(normalizedInput.repositoryUrl), caseStudyUrl: urlOrNull(normalizedInput.caseStudyUrl), healthUrl: urlOrNull(normalizedInput.healthUrl) ?? normalizedInput.liveUrl, featured: Number(normalizedInput.featured), published: Number(normalizedInput.published), monitoringEnabled: Number(normalizedInput.monitoringEnabled), updatedAt: new Date().toISOString() });
      this.db.sqlite.prepare(`UPDATE projects SET monitoring_enabled=?,health_url=?,health_method=?,health_timeout_ms=?,expected_status_min=?,expected_status_max=?,uptime_start_date=? WHERE id=?`).run(Number(resources.some((resource) => resource.uptimeEnabled)), urlOrNull(primary.healthUrl) ?? input.liveUrl, primary.healthMethod, primary.healthTimeoutMs, primary.expectedStatusMin, primary.expectedStatusMax, uptimeStartDate, id);
      const keep = new Set(resources.map((resource) => resource.resourceId));
      this.db.sqlite.prepare(`DELETE FROM project_resources WHERE project_id=? AND coolify_resource_id NOT IN (${[...keep].map(() => "?").join(",")})`).run(id, ...keep);
      this.db.sqlite.prepare(`UPDATE project_resources SET display_order=display_order+1000 WHERE project_id=?`).run(id);
      for (const resource of resources) {
        const existing = this.db.sqlite.prepare(`SELECT id FROM project_resources WHERE project_id=? AND coolify_resource_id=?`).get(id, resource.resourceId) as Row | undefined;
        const associationId = String(existing?.id ?? `${id}:${resource.resourceId}`);
        this.db.sqlite.prepare(`
          INSERT INTO project_resources(id,project_id,coolify_resource_id,label_en,label_es,display_order,uptime_enabled,health_url,health_method,health_timeout_ms,expected_status_min,expected_status_max,uptime_start_date)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(coolify_resource_id) DO UPDATE SET
            label_en=excluded.label_en,label_es=excluded.label_es,display_order=excluded.display_order,uptime_enabled=excluded.uptime_enabled,
            health_url=excluded.health_url,health_method=excluded.health_method,health_timeout_ms=excluded.health_timeout_ms,
            expected_status_min=excluded.expected_status_min,expected_status_max=excluded.expected_status_max,uptime_start_date=excluded.uptime_start_date
        `).run(associationId, id, resource.resourceId, resource.labelEn, resource.labelEs, resource.displayOrder, Number(resource.uptimeEnabled), urlOrNull(resource.healthUrl), resource.healthMethod, resource.healthTimeoutMs, resource.expectedStatusMin, resource.expectedStatusMax, resource.uptimeStartDate);
        this.db.sqlite.prepare(`INSERT OR IGNORE INTO resource_health_state(project_resource_id,status) VALUES(?, 'collecting')`).run(associationId);
      }
      this.db.sqlite.prepare(`DELETE FROM project_technologies WHERE project_id=?`).run(id);
      for (const rawName of [...new Set(input.technologyNames.map((name) => name.trim()).filter(Boolean))]) {
        const techSlug = slugify(rawName);
        let tech = this.db.sqlite.prepare(`SELECT id FROM technologies WHERE slug=?`).get(techSlug) as { id: string } | undefined;
        if (!tech) {
          tech = { id: randomUUID() };
          this.db.sqlite.prepare(`INSERT INTO technologies(id,name,slug) VALUES(?,?,?)`).run(tech.id, rawName, techSlug);
        }
        this.db.sqlite.prepare(`INSERT INTO project_technologies(project_id,technology_id) VALUES(?,?)`).run(id, tech.id);
      }
      const media = this.db.sqlite.prepare(`SELECT id FROM media WHERE project_id=?`).get(id);
      if (media) this.db.sqlite.prepare(`UPDATE media SET alt_en=?,alt_es=? WHERE project_id=?`).run(input.coverAltEn, input.coverAltEs, id);
    })();
  }

  private normalizedResourceInputs(id: string, input: ProjectInput) {
    const project = this.db.sqlite.prepare(`SELECT coolify_resource_id,live_url,health_url,health_method,health_timeout_ms,expected_status_min,expected_status_max,uptime_start_date,monitoring_enabled FROM projects WHERE id=?`).get(id) as Row | undefined;
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const primaryId = String(project.coolify_resource_id);
    const existing = this.db.sqlite.prepare(`SELECT pr.*,cr.name,cr.team_id,cr.suggested_urls_json FROM project_resources pr JOIN coolify_resources cr ON cr.id=pr.coolify_resource_id WHERE pr.project_id=? ORDER BY pr.display_order`).all(id) as Row[];
    const legacy = {
      resourceId: primaryId,
      labelEn: String(existing[0]?.label_en ?? ""),
      labelEs: String(existing[0]?.label_es ?? ""),
      displayOrder: 0,
      uptimeEnabled: Boolean(Number(input.monitoringEnabled ?? project.monitoring_enabled)),
      uptimeStartDate: String(input.uptimeStartDate ?? project.uptime_start_date ?? new Date(this.now()).toISOString().slice(0, 10)),
      healthUrl: input.healthUrl ?? String(project.health_url ?? project.live_url),
      healthMethod: input.healthMethod ?? (String(project.health_method) === "HEAD" ? "HEAD" : "GET") as "GET" | "HEAD",
      healthTimeoutMs: input.healthTimeoutMs ?? Number(project.health_timeout_ms ?? 10_000),
      expectedStatusMin: input.expectedStatusMin ?? Number(project.expected_status_min ?? 200),
      expectedStatusMax: input.expectedStatusMax ?? Number(project.expected_status_max ?? 399),
    };
    const usingLegacy = !input.resources?.length;
    const raw = usingLegacy ? [legacy] : input.resources;
    const seen = new Set<string>();
    const rows = raw.map((resource, index) => {
      if (seen.has(resource.resourceId)) throw new Error("DUPLICATE_PROJECT_RESOURCE");
      seen.add(resource.resourceId);
      const source = this.db.sqlite.prepare(`SELECT id,team_id,name,suggested_urls_json,created_at_source FROM coolify_resources WHERE id=?`).get(resource.resourceId) as Row | undefined;
      if (!source) throw new Error("RESOURCE_NOT_FOUND");
      const current = existing.find((item) => String(item.coolify_resource_id) === resource.resourceId);
      const suggested = (() => { try { return JSON.parse(String(source.suggested_urls_json ?? "[]")) as string[]; } catch { return []; } })();
      return {
        resourceId: resource.resourceId,
        labelEn: usingLegacy ? resource.labelEn || String(current?.label_en ?? source.name ?? "") : resource.labelEn,
        labelEs: usingLegacy ? resource.labelEs || String(current?.label_es ?? source.name ?? "") : resource.labelEs,
        displayOrder: resource.displayOrder ?? index,
        inputOrder: index,
        uptimeEnabled: Boolean(resource.uptimeEnabled),
        uptimeStartDate: resource.uptimeStartDate || calendarDateFromIso(source.created_at_source) || legacy.uptimeStartDate,
        healthUrl: usingLegacy ? resource.healthUrl || String(current?.health_url ?? (resource.resourceId === primaryId ? legacy.healthUrl : suggested[0] ?? "")) : resource.healthUrl,
        healthMethod: resource.healthMethod === "HEAD" ? "HEAD" as const : "GET" as const,
        healthTimeoutMs: Number(resource.healthTimeoutMs ?? 10_000),
        expectedStatusMin: Number(resource.expectedStatusMin ?? 200),
        expectedStatusMax: Number(resource.expectedStatusMax ?? 399),
        teamId: String(source.team_id),
        name: String(source.name),
      };
    });
    if (!rows.some((resource) => resource.resourceId === primaryId)) throw new Error("PRIMARY_RESOURCE_REQUIRED");
    const primary = rows.find((resource) => resource.resourceId === primaryId)!;
    const ordered = [primary, ...rows.filter((resource) => resource.resourceId !== primaryId).sort((left, right) => left.displayOrder - right.displayOrder || left.inputOrder - right.inputOrder)];
    const teamId = String((this.db.sqlite.prepare(`SELECT team_id FROM coolify_resources WHERE id=?`).get(primaryId) as Row).team_id);
    if (ordered.some((resource) => resource.teamId !== teamId)) throw new Error("PROJECT_RESOURCE_TEAM_MISMATCH");
    const assignedElsewhere = this.db.sqlite.prepare(`SELECT pr.coolify_resource_id,p.slug FROM project_resources pr JOIN projects p ON p.id=pr.project_id WHERE pr.coolify_resource_id IN (${ordered.map(() => "?").join(",")}) AND pr.project_id<>?`).all(...ordered.map((resource) => resource.resourceId), id) as Row[];
    if (assignedElsewhere.length) throw new Error("RESOURCE_ALREADY_ASSIGNED");
    return ordered.map((resource, index) => ({ ...resource, displayOrder: index }));
  }

  reorder(ids: string[]) {
    this.db.sqlite.transaction(() => ids.forEach((id, index) => this.db.sqlite.prepare(`UPDATE projects SET display_order=?,updated_at=? WHERE id=?`).run(index, new Date().toISOString(), id)))();
  }

  site(locale: Locale) {
    const settings = this.db.sqlite.prepare(`SELECT * FROM site_settings WHERE id=1`).get() as Row;
    const technologies = this.db.sqlite.prepare(`SELECT DISTINCT t.id,t.name,t.slug FROM technologies t JOIN project_technologies pt ON pt.technology_id=t.id JOIN projects p ON p.id=pt.project_id JOIN coolify_resources cr ON cr.id=p.coolify_resource_id JOIN coolify_teams ct ON ct.id=cr.team_id WHERE p.published=1 AND ct.enabled=1 ORDER BY t.name`).all();
    return { title: settings.title, githubUrl: settings.github_url ?? null, contactUrl: settings.contact_url ?? null, locale, technologies, resourceTypes: ["application", "service"], statuses: ["online", "degraded", "offline", "collecting", "unknown"] };
  }

  private toSummary(row: Row, locale: Locale): ProjectSummary {
    const projectId = String(row.id);
    const monitoringEnabled = Boolean(Number(row.monitoring_enabled));
    const status = !monitoringEnabled ? "unknown" : row.status ? String(row.status) : "collecting";
    const activeIncident = monitoringEnabled ? this.db.sqlite.prepare(`SELECT started_at,trigger_error_code,trigger_status_code FROM incidents WHERE project_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(projectId) as Row | undefined : undefined;
    const uptimeStartDate = calendarDateFromIso(row.uptime_start_date) ?? calendarDateFromIso(row.created_at_source) ?? new Date(this.now()).toISOString().slice(0, 10);
    const uptime30d = this.uptimeMetric(projectId, 30);
    const uptimeAll = this.uptimeMetric(projectId, null);
    const streakStartedAt = this.currentStreakStart(projectId, row, status, activeIncident, uptimeStartDate);
    const resources = this.resourceSummaries(projectId, locale, false);
    return {
      id: projectId,
      slug: String(row.slug),
      title: String(row[locale === "es" ? "title_es" : "title_en"]),
      summary: String(row[locale === "es" ? "summary_es" : "summary_en"]),
      maintenanceMessage: String(row.operational_notice_type) === "none" ? null : String(row[locale === "es" ? "maintenance_message_es" : "maintenance_message_en"] ?? "").trim() || null,
      operationalNoticeType: (["maintenance", "restart", "update"].includes(String(row.operational_notice_type)) ? String(row.operational_notice_type) : "none") as ProjectSummary["operationalNoticeType"],
      resourceType: String(row.resource_type) as "application" | "service",
      resourceTypes: [...new Set(resources.map((resource) => resource.resourceType))],
      resources,
      technologies: this.technologiesFor(projectId),
      liveUrl: String(row.live_url),
      repositoryUrl: row.repository_url ? String(row.repository_url) : null,
      caseStudyUrl: row.case_study_url ? String(row.case_study_url) : null,
      cover: row.large_path ? { src: `/media/${row.large_path}`, srcSmall: `/media/${row.small_path}`, alt: String(row[locale === "es" ? "alt_es" : "alt_en"] ?? "") } : null,
      health: {
        status: status as ProjectSummary["health"]["status"],
        uptime30d: uptime30d.value,
        uptimeStartDate,
        measurementStartedAt: row.first_checked_at ? String(row.first_checked_at) : null,
        assumedUptime: uptimeAll.assumed,
        streakStartedAt,
        streakDays: streakStartedAt ? Math.max(0, (this.now() - Date.parse(streakStartedAt)) / 86_400_000) : null,
        latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
        lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
        daily: this.dailySeries(projectId, 30),
        activeIncident: activeIncident ? { startedAt: String(activeIncident.started_at), trigger: activeIncident.trigger_error_code ? String(activeIncident.trigger_error_code) : null, statusCode: activeIncident.trigger_status_code == null ? null : Number(activeIncident.trigger_status_code) } : null,
      },
      createdAt: String(row.created_at_source ?? row.created_at),
      featured: Boolean(row.featured),
      displayOrder: Number(row.display_order),
      accentColor: (["lime", "chartreuse", "mint", "aqua", "cyan", "turquoise", "sky", "periwinkle", "yellow", "amber", "tangerine", "coral", "raspberry", "pink"].includes(String(row.accent_color)) ? String(row.accent_color) : "lime") as ProjectSummary["accentColor"],
      coolify: {
        runtimeStatus: row.coolify_status ? String(row.coolify_status) : null,
        sourceType: row.source_type ? String(row.source_type) : null,
        branch: row.source_branch ? String(row.source_branch) : null,
        commitSha: row.commit_sha ? String(row.commit_sha) : null,
        resourceUpdatedAt: row.updated_at_source ? String(row.updated_at_source) : null,
        deploymentInProgress: Boolean(row.deployment_in_progress),
        lastSuccessfulDeploymentAt: row.last_successful_deployment_at ? String(row.last_successful_deployment_at) : null,
        syncedAt: String(row.synced_at),
        sentinel: row.sentinel_enabled == null ? null : {
          enabled: Boolean(row.sentinel_enabled),
          metricsEnabled: Boolean(row.sentinel_metrics_enabled),
          refreshRateSeconds: row.sentinel_refresh_rate_seconds == null ? null : Number(row.sentinel_refresh_rate_seconds),
          historyDays: row.sentinel_history_days == null ? null : Number(row.sentinel_history_days),
          pushIntervalSeconds: row.sentinel_push_interval_seconds == null ? null : Number(row.sentinel_push_interval_seconds),
          lastReportedAt: row.sentinel_last_reported_at ? String(row.sentinel_last_reported_at) : null,
        },
      },
    };
  }

  private toDetail(row: Row, locale: Locale) {
    const projectId = String(row.id);
    const uptime = {
      h24: this.uptimeForDays(projectId, 1),
      d7: this.uptimeForDays(projectId, 7),
      d30: this.uptimeForDays(projectId, 30),
      all: this.uptimeForDays(projectId, null),
    };
    return {
      ...this.toSummary(row, locale),
      description: String(row[locale === "es" ? "description_es" : "description_en"] ?? ""),
      gallery: this.galleryFor(projectId, locale),
      uptime,
      latencySeries: (this.db.sqlite.prepare(`SELECT checked_at,latency_ms FROM health_checks WHERE project_id=? AND success=1 AND latency_ms IS NOT NULL ORDER BY checked_at DESC LIMIT 30`).all(projectId) as Row[]).reverse().map((point) => ({ at: String(point.checked_at), value: Number(point.latency_ms) })),
      incidents: (this.db.sqlite.prepare(`SELECT started_at,ended_at,trigger_error_code,trigger_status_code,recovered_status_code FROM incidents WHERE project_id=? ORDER BY started_at DESC LIMIT 10`).all(projectId) as Row[]).map((incident) => ({ startedAt: String(incident.started_at), endedAt: incident.ended_at ? String(incident.ended_at) : null, trigger: incident.trigger_error_code ? String(incident.trigger_error_code) : null, statusCode: incident.trigger_status_code == null ? null : Number(incident.trigger_status_code), recoveredStatusCode: incident.recovered_status_code == null ? null : Number(incident.recovered_status_code) })),
      resources: this.resourceSummaries(projectId, locale, true),
    };
  }

  private resourceSummaries(projectId: string, locale: Locale, detail: boolean) {
    const rows = this.db.sqlite.prepare(`
      SELECT pr.*,cr.name AS resource_name,cr.resource_type,cr.status AS coolify_status,cr.source_type,cr.source_branch,
        cr.commit_sha,cr.updated_at_source,cr.deployment_in_progress,cr.last_successful_deployment_at,cr.synced_at,cr.server_uuid,
        cr.team_id,rs.status AS resource_status,rs.streak_started_at,rs.first_checked_at,rs.monitor_interval_ms_at_start,
        rs.latency_ms,rs.last_checked_at,ss.enabled AS sentinel_enabled,ss.metrics_enabled AS sentinel_metrics_enabled,
        ss.refresh_rate_seconds AS sentinel_refresh_rate_seconds,ss.history_days AS sentinel_history_days,
        ss.push_interval_seconds AS sentinel_push_interval_seconds,ss.last_reported_at AS sentinel_last_reported_at
      FROM project_resources pr JOIN coolify_resources cr ON cr.id=pr.coolify_resource_id
      LEFT JOIN resource_health_state rs ON rs.project_resource_id=pr.id
      LEFT JOIN sentinel_servers ss ON ss.team_id=cr.team_id AND ss.server_uuid=cr.server_uuid
      WHERE pr.project_id=? ORDER BY pr.display_order,pr.id
    `).all(projectId) as Row[];
    return rows.map((row) => {
      const resourceId = String(row.id);
      const uptimeEnabled = Boolean(Number(row.uptime_enabled));
      const health = uptimeEnabled ? this.resourceHealthSummary(row, resourceId) : null;
      const base = {
        id: resourceId,
        resourceId: String(row.coolify_resource_id),
        label: String(row[locale === "es" ? "label_es" : "label_en"] || row.resource_name),
        resourceName: String(row.resource_name),
        resourceType: String(row.resource_type) as "application" | "service",
        uptimeEnabled,
        coolify: this.coolifySummary(row),
        health,
      };
      if (!detail) return base;
      return {
        ...base,
        uptime: uptimeEnabled ? { h24: this.resourceUptimeForDays(resourceId, 1), d7: this.resourceUptimeForDays(resourceId, 7), d30: this.resourceUptimeForDays(resourceId, 30), all: this.resourceUptimeForDays(resourceId, null) } : null,
        latencySeries: uptimeEnabled ? (this.db.sqlite.prepare(`SELECT checked_at,latency_ms FROM resource_health_checks WHERE project_resource_id=? AND success=1 AND latency_ms IS NOT NULL ORDER BY checked_at DESC LIMIT 30`).all(resourceId) as Row[]).reverse().map((point) => ({ at: String(point.checked_at), value: Number(point.latency_ms) })) : [],
        incidents: uptimeEnabled ? (this.db.sqlite.prepare(`SELECT started_at,ended_at,trigger_error_code,trigger_status_code,recovered_status_code FROM resource_incidents WHERE project_resource_id=? ORDER BY started_at DESC LIMIT 10`).all(resourceId) as Row[]).map((incident) => ({ startedAt: String(incident.started_at), endedAt: incident.ended_at ? String(incident.ended_at) : null, trigger: incident.trigger_error_code ? String(incident.trigger_error_code) : null, statusCode: incident.trigger_status_code == null ? null : Number(incident.trigger_status_code), recoveredStatusCode: incident.recovered_status_code == null ? null : Number(incident.recovered_status_code) })) : [],
      };
    });
  }

  private coolifySummary(row: Row) {
    return {
      runtimeStatus: row.coolify_status ? String(row.coolify_status) : null,
      sourceType: row.source_type ? String(row.source_type) : null,
      branch: row.source_branch ? String(row.source_branch) : null,
      commitSha: row.commit_sha ? String(row.commit_sha) : null,
      resourceUpdatedAt: row.updated_at_source ? String(row.updated_at_source) : null,
      deploymentInProgress: Boolean(row.deployment_in_progress),
      lastSuccessfulDeploymentAt: row.last_successful_deployment_at ? String(row.last_successful_deployment_at) : null,
      syncedAt: String(row.synced_at),
      sentinel: row.sentinel_enabled == null ? null : {
        enabled: Boolean(row.sentinel_enabled), metricsEnabled: Boolean(row.sentinel_metrics_enabled),
        refreshRateSeconds: row.sentinel_refresh_rate_seconds == null ? null : Number(row.sentinel_refresh_rate_seconds),
        historyDays: row.sentinel_history_days == null ? null : Number(row.sentinel_history_days),
        pushIntervalSeconds: row.sentinel_push_interval_seconds == null ? null : Number(row.sentinel_push_interval_seconds),
        lastReportedAt: row.sentinel_last_reported_at ? String(row.sentinel_last_reported_at) : null,
      },
    };
  }

  private resourceHealthSummary(row: Row, resourceId: string) {
    const status = row.resource_status ? String(row.resource_status) : "collecting";
    const start = calendarDateFromIso(row.uptime_start_date) ?? calendarDateFromIso(row.created_at_source) ?? new Date(this.now()).toISOString().slice(0, 10);
    const active = this.db.sqlite.prepare(`SELECT started_at,trigger_error_code,trigger_status_code FROM resource_incidents WHERE project_resource_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(resourceId) as Row | undefined;
    const all = this.resourceUptimeMetric(resourceId, null);
    const streak = !["offline"].includes(status) && !active && status !== "unknown" ? (row.streak_started_at ? String(row.streak_started_at) : `${start}T00:00:00.000Z`) : null;
    return {
      status: status as ProjectSummary["health"]["status"],
      uptime30d: this.resourceUptimeMetric(resourceId, 30).value,
      uptimeStartDate: start,
      measurementStartedAt: row.first_checked_at ? String(row.first_checked_at) : null,
      assumedUptime: all.assumed,
      streakStartedAt: streak,
      streakDays: streak ? Math.max(0, (this.now() - Date.parse(streak)) / 86_400_000) : null,
      latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
      lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
      daily: this.resourceDailySeries(resourceId, 30),
      activeIncident: active ? { startedAt: String(active.started_at), trigger: active.trigger_error_code ? String(active.trigger_error_code) : null, statusCode: active.trigger_status_code == null ? null : Number(active.trigger_status_code) } : null,
    };
  }

  private technologiesFor(projectId: string) {
    return this.db.sqlite.prepare(`SELECT t.id,t.name,t.slug FROM technologies t JOIN project_technologies pt ON pt.technology_id=t.id WHERE pt.project_id=? ORDER BY t.name`).all(projectId) as { id: string; name: string; slug: string }[];
  }

  private galleryFor(projectId: string, locale: Locale) {
    return (this.db.sqlite.prepare(`SELECT id,file_path,mime_type,alt_en,alt_es FROM project_gallery WHERE project_id=? ORDER BY display_order,created_at`).all(projectId) as Row[]).map((item) => ({
      id: String(item.id),
      src: `/media/${String(item.file_path)}`,
      alt: String(item[locale === "es" ? "alt_es" : "alt_en"] ?? ""),
      mimeType: String(item.mime_type),
    }));
  }

  private galleryForAdmin(projectId: string) {
    return this.db.sqlite.prepare(`SELECT id,file_path,mime_type,alt_en,alt_es,display_order FROM project_gallery WHERE project_id=? ORDER BY display_order,created_at`).all(projectId);
  }

  private adminResourcesFor(projectId: string) {
    return this.db.sqlite.prepare(`
      SELECT pr.id,pr.coolify_resource_id AS resource_id,pr.label_en,pr.label_es,pr.display_order,pr.uptime_enabled,
        pr.health_url,pr.health_method,pr.health_timeout_ms,pr.expected_status_min,pr.expected_status_max,pr.uptime_start_date,
        cr.name AS resource_name,cr.resource_type,cr.team_id,cr.status,cr.suggested_urls_json
      FROM project_resources pr JOIN coolify_resources cr ON cr.id=pr.coolify_resource_id
      WHERE pr.project_id=? ORDER BY pr.display_order,pr.id
    `).all(projectId).map((value) => { const row = value as Row; let suggestedUrls: string[] = []; try { suggestedUrls = JSON.parse(String(row.suggested_urls_json ?? "[]")); } catch { /* ignore malformed catalog data */ } return { ...row, suggested_urls_json: undefined, suggestedUrls }; });
  }

  private uptimeForDays(projectId: string, days: number | null) { return this.uptimeMetric(projectId, days).value; }

  private resourceUptimeForDays(resourceId: string, days: number | null) { return this.resourceUptimeMetric(resourceId, days).value; }

  private resourceUptimeMetric(resourceId: string, days: number | null) {
    const row = this.db.sqlite.prepare(`SELECT pr.uptime_start_date,rs.first_checked_at,rs.monitor_interval_ms_at_start FROM project_resources pr LEFT JOIN resource_health_state rs ON rs.project_resource_id=pr.id WHERE pr.id=?`).get(resourceId) as Row | undefined;
    if (!row) return { value: null, assumed: false };
    const nowMs = this.now();
    const uptimeStartMs = Date.parse(`${calendarDateFromIso(row.uptime_start_date) ?? new Date(nowMs).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const rangeStartMs = days == null ? uptimeStartMs : nowMs - days * 86_400_000;
    const startMs = Math.max(rangeStartMs, uptimeStartMs);
    if (startMs >= nowMs) return { value: null, assumed: false };
    const assumedEndMs = Math.min(row.first_checked_at ? Date.parse(String(row.first_checked_at)) : nowMs, nowMs);
    const assumedMs = Math.max(0, Math.min(assumedEndMs, nowMs) - startMs);
    const stats = this.resourceMetricStats(resourceId, startMs, nowMs, days);
    const intervalMs = row.monitor_interval_ms_at_start == null ? this.monitorIntervalMs : Number(row.monitor_interval_ms_at_start);
    const totalMs = assumedMs + stats.checks * intervalMs;
    if (totalMs <= 0) return { value: assumedMs > 0 ? 100 : null, assumed: assumedMs > 0 };
    return { value: roundPercentage(((assumedMs + stats.successes * intervalMs) / totalMs) * 100), assumed: assumedMs > 0 };
  }

  private resourceMetricStats(resourceId: string, startMs: number, endMs: number, days: number | null) {
    if (days != null && days <= 30) {
      const raw = this.db.sqlite.prepare(`SELECT COUNT(*) AS checks,COALESCE(SUM(success),0) AS successes FROM resource_health_checks WHERE project_resource_id=? AND checked_at>=? AND checked_at<?`).get(resourceId, new Date(startMs).toISOString(), new Date(endMs).toISOString()) as { checks: number; successes: number };
      return { checks: Number(raw.checks), successes: Number(raw.successes) };
    }
    const raw = this.db.sqlite.prepare(`SELECT COALESCE(SUM(check_count),0) AS checks,COALESCE(SUM(success_count),0) AS successes FROM resource_daily_metrics WHERE project_resource_id=? AND day>=? AND day<=?`).get(resourceId, new Date(startMs).toISOString().slice(0, 10), new Date(endMs).toISOString().slice(0, 10)) as { checks: number; successes: number };
    return { checks: Number(raw.checks), successes: Number(raw.successes) };
  }

  private resourceDailySeries(resourceId: string, days: number) {
    const row = this.db.sqlite.prepare(`SELECT uptime_start_date FROM project_resources WHERE id=?`).get(resourceId) as Row | undefined;
    if (!row) return Array.from({ length: days }, () => null);
    const nowMs = this.now();
    const firstDayMs = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate()) - (days - 1) * 86_400_000;
    const entries = new Map((this.db.sqlite.prepare(`SELECT day,check_count,success_count FROM resource_daily_metrics WHERE project_resource_id=? AND day>=?`).all(resourceId, new Date(firstDayMs).toISOString().slice(0, 10)) as Row[]).map((item) => [String(item.day), { checks: Number(item.check_count), successes: Number(item.success_count) }]));
    const state = this.db.sqlite.prepare(`SELECT first_checked_at,monitor_interval_ms_at_start FROM resource_health_state WHERE project_resource_id=?`).get(resourceId) as Row | undefined;
    const uptimeStartMs = Date.parse(`${calendarDateFromIso(row.uptime_start_date) ?? new Date(nowMs).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const intervalMs = state?.monitor_interval_ms_at_start == null ? this.monitorIntervalMs : Number(state.monitor_interval_ms_at_start);
    return Array.from({ length: days }, (_, index) => {
      const dayStartMs = firstDayMs + index * 86_400_000;
      const dayEndMs = Math.min(dayStartMs + 86_400_000, nowMs);
      const startMs = Math.max(dayStartMs, uptimeStartMs);
      if (startMs >= dayEndMs) return null;
      const assumedEndMs = Math.min(state?.first_checked_at ? Date.parse(String(state.first_checked_at)) : nowMs, dayEndMs);
      const assumedMs = Math.max(0, Math.min(assumedEndMs, dayEndMs) - startMs);
      const stats = entries.get(new Date(dayStartMs).toISOString().slice(0, 10)) ?? { checks: 0, successes: 0 };
      const totalMs = assumedMs + stats.checks * intervalMs;
      return totalMs > 0 ? roundPercentage(((assumedMs + stats.successes * intervalMs) / totalMs) * 100) : null;
    });
  }

  private uptimeMetric(projectId: string, days: number | null) {
    const meta = this.monitoringMeta(projectId);
    if (!meta.monitoringEnabled) return { value: null, assumed: false };
    const nowMs = this.now();
    const rangeStartMs = days == null ? meta.uptimeStartMs : nowMs - days * 86_400_000;
    const startMs = Math.max(rangeStartMs, meta.uptimeStartMs);
    if (startMs >= nowMs) return { value: null, assumed: false };
    const assumedEndMs = Math.min(meta.firstCheckedMs ?? nowMs, nowMs);
    const assumedMs = Math.max(0, Math.min(assumedEndMs, nowMs) - startMs);
    const stats = this.metricStats(projectId, startMs, nowMs, days);
    const intervalMs = meta.monitorIntervalMsAtStart ?? this.monitorIntervalMs;
    const totalMs = assumedMs + stats.checks * intervalMs;
    if (totalMs <= 0) return { value: assumedMs > 0 ? 100 : null, assumed: assumedMs > 0 };
    return { value: roundPercentage(((assumedMs + stats.successes * intervalMs) / totalMs) * 100), assumed: assumedMs > 0 };
  }

  private metricStats(projectId: string, startMs: number, endMs: number, days: number | null) {
    if (days != null && days <= 30) {
      const raw = this.db.sqlite.prepare(`SELECT COUNT(*) AS checks,COALESCE(SUM(success),0) AS successes FROM health_checks WHERE project_id=? AND checked_at>=? AND checked_at<?`).get(projectId, new Date(startMs).toISOString(), new Date(endMs).toISOString()) as { checks: number; successes: number };
      return { checks: Number(raw.checks), successes: Number(raw.successes) };
    }
    const raw = this.db.sqlite.prepare(`SELECT COALESCE(SUM(check_count),0) AS checks,COALESCE(SUM(success_count),0) AS successes FROM daily_metrics WHERE project_id=? AND day>=? AND day<=?`).get(projectId, new Date(startMs).toISOString().slice(0, 10), new Date(endMs).toISOString().slice(0, 10)) as { checks: number; successes: number };
    return { checks: Number(raw.checks), successes: Number(raw.successes) };
  }

  private dailySeries(projectId: string, days: number) {
    const meta = this.monitoringMeta(projectId);
    if (!meta.monitoringEnabled) return Array.from({ length: days }, () => null);
    const nowMs = this.now();
    const firstDayMs = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate()) - (days - 1) * 86_400_000;
    const entries = new Map((this.db.sqlite.prepare(`SELECT day,check_count,success_count FROM daily_metrics WHERE project_id=? AND day>=?`).all(projectId, new Date(firstDayMs).toISOString().slice(0, 10)) as Row[]).map((row) => [String(row.day), { checks: Number(row.check_count), successes: Number(row.success_count) }]));
    const intervalMs = meta.monitorIntervalMsAtStart ?? this.monitorIntervalMs;
    return Array.from({ length: days }, (_, index) => {
      const dayStartMs = firstDayMs + index * 86_400_000;
      const dayEndMs = Math.min(dayStartMs + 86_400_000, nowMs);
      const startMs = Math.max(dayStartMs, meta.uptimeStartMs);
      if (startMs >= dayEndMs) return null;
      const assumedEndMs = Math.min(meta.firstCheckedMs ?? nowMs, dayEndMs);
      const assumedMs = Math.max(0, Math.min(assumedEndMs, dayEndMs) - startMs);
      const stats = entries.get(new Date(dayStartMs).toISOString().slice(0, 10)) ?? { checks: 0, successes: 0 };
      const totalMs = assumedMs + stats.checks * intervalMs;
      return totalMs > 0 ? roundPercentage(((assumedMs + stats.successes * intervalMs) / totalMs) * 100) : null;
    });
  }

  private monitoringMeta(projectId: string) {
    const row = this.db.sqlite.prepare(`SELECT p.uptime_start_date,p.monitoring_enabled,hs.first_checked_at,hs.monitor_interval_ms_at_start FROM projects p LEFT JOIN health_state hs ON hs.project_id=p.id WHERE p.id=?`).get(projectId) as Row | undefined;
    const uptimeStartDate = calendarDateFromIso(row?.uptime_start_date) ?? new Date(this.now()).toISOString().slice(0, 10);
    return {
      monitoringEnabled: Boolean(Number(row?.monitoring_enabled)),
      uptimeStartMs: Date.parse(`${uptimeStartDate}T00:00:00.000Z`),
      firstCheckedMs: row?.first_checked_at ? Date.parse(String(row.first_checked_at)) : null,
      monitorIntervalMsAtStart: row?.monitor_interval_ms_at_start == null ? null : Number(row.monitor_interval_ms_at_start),
    };
  }

  private currentStreakStart(projectId: string, row: Row, status: string, activeIncident: Row | undefined, uptimeStartDate: string) {
    if (!Number(row.monitoring_enabled) || status === "offline" || activeIncident) return null;
    const baseline = `${uptimeStartDate}T00:00:00.000Z`;
    const recovery = this.db.sqlite.prepare(`SELECT ended_at FROM incidents WHERE project_id=? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`).get(projectId) as Row | undefined;
    if (recovery?.ended_at && Date.parse(String(recovery.ended_at)) > Date.parse(baseline)) return String(recovery.ended_at);
    return baseline;
  }

  private assertUptimeStartDate(projectId: string, value: string) {
    if (!isCalendarDate(value)) throw new ProjectValidationError("INVALID_UPTIME_START_DATE", ["uptimeStartDate"]);
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (value > today) throw new ProjectValidationError("INVALID_UPTIME_START_DATE", ["uptimeStartDate"]);
    const state = this.db.sqlite.prepare(`SELECT first_checked_at FROM health_state WHERE project_id=?`).get(projectId) as Row | undefined;
    if (state?.first_checked_at && Date.parse(`${value}T00:00:00.000Z`) > Date.parse(String(state.first_checked_at))) throw new ProjectValidationError("INVALID_UPTIME_START_DATE", ["uptimeStartDate"]);
  }

  private assertResourceUptimeStartDate(resourceId: string, value: string) {
    if (!isCalendarDate(value)) throw new ProjectValidationError("INVALID_UPTIME_START_DATE", ["resources"]);
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (value > today) throw new ProjectValidationError("INVALID_UPTIME_START_DATE", ["resources"]);
    const state = this.db.sqlite.prepare(`SELECT first_checked_at FROM resource_health_state WHERE project_resource_id=?`).get(resourceId) as Row | undefined;
    if (state?.first_checked_at && Date.parse(`${value}T00:00:00.000Z`) > Date.parse(String(state.first_checked_at))) throw new ProjectValidationError("INVALID_UPTIME_START_DATE", ["resources"]);
  }

  private assertPublishable(id: string, input: ProjectInput) {
    const required = ["titleEn", "titleEs", "summaryEn", "summaryEs", "descriptionEn", "descriptionEs", "coverAltEn", "coverAltEs"] as const;
    const missing = required.filter((key) => !input[key].trim());
    if (missing.length) throw new ProjectValidationError("INCOMPLETE_TRANSLATIONS", [...missing]);
    if (input.operationalNoticeType !== "none") {
      const missingNotice = (["maintenanceMessageEn", "maintenanceMessageEs"] as const).filter((key) => !input[key].trim());
      if (missingNotice.length) throw new ProjectValidationError("INCOMPLETE_MAINTENANCE_TRANSLATIONS", [...missingNotice]);
    }
    const resources = this.normalizedResourceInputs(id, input);
    const missingLabels = resources.flatMap((resource, index) => [
      ...(resource.labelEn.trim() ? [] : [`resources.${index}.labelEn`]),
      ...(resource.labelEs.trim() ? [] : [`resources.${index}.labelEs`]),
    ]);
    if (missingLabels.length) throw new ProjectValidationError("INCOMPLETE_RESOURCE_LABELS", ["resources"]);
    const invalidMonitor = resources.find((resource) => resource.uptimeEnabled && !resource.healthUrl?.trim());
    if (invalidMonitor) throw new ProjectValidationError("RESOURCE_HEALTH_REQUIRED", ["resources"]);
    if (!this.db.sqlite.prepare(`SELECT id FROM media WHERE project_id=?`).get(id)) throw new Error("COVER_REQUIRED");
  }

  private uniqueSlug(base: string) {
    let slug = base;
    let suffix = 2;
    while (this.db.sqlite.prepare(`SELECT id FROM projects WHERE slug=?`).get(slug)) slug = `${base}-${suffix++}`;
    return slug;
  }
}

function calendarDateFromIso(value: unknown) {
  const date = typeof value === "string" ? value.slice(0, 10) : "";
  return isCalendarDate(date) ? date : null;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function roundPercentage(value: number) { return Math.round(value * 100) / 100; }

export function slugify(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
}
