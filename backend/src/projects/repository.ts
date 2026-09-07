import { randomUUID } from "node:crypto";
import type { Locale, ProjectInput, ProjectSummary } from "@izbri/contracts";
import type { DatabaseContext } from "../db/index.js";

type Row = Record<string, unknown>;

export class ProjectValidationError extends Error {
  constructor(code: string, readonly fields: (keyof ProjectInput)[]) { super(code); }
}

export class ProjectRepository {
  constructor(private readonly db: DatabaseContext) {}

  listPublic(locale: Locale, filters: { status?: string; technology?: string; resourceType?: string; sort?: string }) {
    const rows = this.db.sqlite.prepare(`
      SELECT p.*, cr.resource_type, cr.created_at_source, cr.updated_at_source, cr.status AS coolify_status,
        cr.source_type, cr.source_branch, cr.commit_sha, cr.deployment_in_progress,cr.last_successful_deployment_at,cr.synced_at, hs.status, hs.streak_started_at,
        ss.enabled AS sentinel_enabled, ss.metrics_enabled AS sentinel_metrics_enabled,
        ss.refresh_rate_seconds AS sentinel_refresh_rate_seconds, ss.history_days AS sentinel_history_days,
        ss.push_interval_seconds AS sentinel_push_interval_seconds, ss.last_reported_at AS sentinel_last_reported_at,
        hs.latency_ms, hs.last_checked_at, m.large_path, m.small_path, m.alt_en, m.alt_es
      FROM projects p
      JOIN coolify_resources cr ON cr.id=p.coolify_resource_id
      LEFT JOIN health_state hs ON hs.project_id=p.id
      LEFT JOIN media m ON m.project_id=p.id
      LEFT JOIN sentinel_servers ss ON ss.server_uuid=cr.server_uuid
      WHERE p.published=1
    `).all() as Row[];
    let projects = rows.map((row) => this.toSummary(row, locale));
    if (filters.status) projects = projects.filter((project) => project.health.status === filters.status);
    if (filters.resourceType) projects = projects.filter((project) => project.resourceType === filters.resourceType);
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
        cr.source_type, cr.source_branch, cr.commit_sha, cr.deployment_in_progress,cr.last_successful_deployment_at,cr.synced_at, hs.status, hs.streak_started_at,
        ss.enabled AS sentinel_enabled, ss.metrics_enabled AS sentinel_metrics_enabled,
        ss.refresh_rate_seconds AS sentinel_refresh_rate_seconds, ss.history_days AS sentinel_history_days,
        ss.push_interval_seconds AS sentinel_push_interval_seconds, ss.last_reported_at AS sentinel_last_reported_at,
        hs.latency_ms, hs.last_checked_at, m.large_path, m.small_path, m.alt_en, m.alt_es
      FROM projects p JOIN coolify_resources cr ON cr.id=p.coolify_resource_id
      LEFT JOIN health_state hs ON hs.project_id=p.id LEFT JOIN media m ON m.project_id=p.id
      LEFT JOIN sentinel_servers ss ON ss.server_uuid=cr.server_uuid
      WHERE p.slug=? AND p.published=1
    `).get(slug) as Row | undefined;
    return row ? this.toDetail(row, locale) : null;
  }

  getAdminPreview(id: string, locale: Locale) {
    const row = this.db.sqlite.prepare(`
      SELECT p.*, cr.resource_type,cr.created_at_source,cr.updated_at_source,cr.status AS coolify_status,
        cr.source_type,cr.source_branch,cr.commit_sha,cr.deployment_in_progress,cr.last_successful_deployment_at,cr.synced_at,
        hs.status,hs.streak_started_at,hs.latency_ms,hs.last_checked_at,
        ss.enabled AS sentinel_enabled,ss.metrics_enabled AS sentinel_metrics_enabled,
        ss.refresh_rate_seconds AS sentinel_refresh_rate_seconds,ss.history_days AS sentinel_history_days,
        ss.push_interval_seconds AS sentinel_push_interval_seconds,ss.last_reported_at AS sentinel_last_reported_at,
        m.large_path,m.small_path,m.alt_en,m.alt_es
      FROM projects p JOIN coolify_resources cr ON cr.id=p.coolify_resource_id
      LEFT JOIN health_state hs ON hs.project_id=p.id LEFT JOIN media m ON m.project_id=p.id
      LEFT JOIN sentinel_servers ss ON ss.server_uuid=cr.server_uuid WHERE p.id=?
    `).get(id) as Row | undefined;
    return row ? this.toDetail(row, locale) : null;
  }

  getAdminProjects() {
    return this.db.sqlite.prepare(`
      SELECT p.*, cr.name AS coolify_name, cr.resource_type, cr.resource_uuid,
        m.large_path, m.small_path, m.alt_en, m.alt_es
      FROM projects p JOIN coolify_resources cr ON cr.id=p.coolify_resource_id
      LEFT JOIN media m ON m.project_id=p.id ORDER BY p.display_order, p.created_at
    `).all().map((value) => { const row = value as Row; return { ...row, technologies: this.technologiesFor(String(row.id)), gallery: this.galleryForAdmin(String(row.id)) }; });
  }

  import(resourceType: string, resourceUuid: string, liveUrl: string) {
    const resource = this.db.sqlite.prepare(`SELECT * FROM coolify_resources WHERE resource_type=? AND resource_uuid=?`).get(resourceType, resourceUuid) as Row | undefined;
    if (!resource) throw new Error("RESOURCE_NOT_FOUND");
    const existing = this.db.sqlite.prepare(`SELECT id FROM projects WHERE coolify_resource_id=?`).get(resource.id);
    if (existing) throw new Error("RESOURCE_ALREADY_IMPORTED");
    const id = randomUUID();
    const now = new Date().toISOString();
    const slug = this.uniqueSlug(slugify(String(resource.name)) || `project-${id.slice(0, 8)}`);
    const max = this.db.sqlite.prepare(`SELECT COALESCE(MAX(display_order), -1) AS value FROM projects`).get() as { value: number };
    this.db.sqlite.prepare(`
      INSERT INTO projects(id,coolify_resource_id,slug,title_en,title_es,live_url,health_url,display_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(id, resource.id, slug, resource.name, resource.name, liveUrl, liveUrl, max.value + 1, now, now);
    this.db.sqlite.prepare(`INSERT INTO health_state(project_id,status) VALUES(?, 'collecting')`).run(id);
    return id;
  }

  update(id: string, input: ProjectInput) {
    if (input.expectedStatusMin > input.expectedStatusMax) throw new Error("INVALID_STATUS_RANGE");
    if (input.published) this.assertPublishable(id, input);
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
          updated_at=@updatedAt WHERE id=@id
      `).run({ ...input, id, repositoryUrl: urlOrNull(input.repositoryUrl), caseStudyUrl: urlOrNull(input.caseStudyUrl), healthUrl: urlOrNull(input.healthUrl) ?? input.liveUrl, featured: Number(input.featured), published: Number(input.published), monitoringEnabled: Number(input.monitoringEnabled), updatedAt: new Date().toISOString() });
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

  reorder(ids: string[]) {
    this.db.sqlite.transaction(() => ids.forEach((id, index) => this.db.sqlite.prepare(`UPDATE projects SET display_order=?,updated_at=? WHERE id=?`).run(index, new Date().toISOString(), id)))();
  }

  site(locale: Locale) {
    const settings = this.db.sqlite.prepare(`SELECT * FROM site_settings WHERE id=1`).get() as Row;
    const technologies = this.db.sqlite.prepare(`SELECT DISTINCT t.id,t.name,t.slug FROM technologies t JOIN project_technologies pt ON pt.technology_id=t.id JOIN projects p ON p.id=pt.project_id WHERE p.published=1 ORDER BY t.name`).all();
    return { title: settings.title, githubUrl: settings.github_url ?? null, contactUrl: settings.contact_url ?? null, locale, technologies, resourceTypes: ["application", "service"], statuses: ["online", "degraded", "offline", "collecting", "unknown"] };
  }

  private toSummary(row: Row, locale: Locale): ProjectSummary {
    const projectId = String(row.id);
    const status = !Number(row.monitoring_enabled) ? "unknown" : row.status ? String(row.status) : "collecting";
    const streakStartedAt = row.streak_started_at ? String(row.streak_started_at) : null;
    const activeIncident = this.db.sqlite.prepare(`SELECT started_at,trigger_error_code,trigger_status_code FROM incidents WHERE project_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(projectId) as Row | undefined;
    return {
      id: projectId,
      slug: String(row.slug),
      title: String(row[locale === "es" ? "title_es" : "title_en"]),
      summary: String(row[locale === "es" ? "summary_es" : "summary_en"]),
      maintenanceMessage: String(row.operational_notice_type) === "none" ? null : String(row[locale === "es" ? "maintenance_message_es" : "maintenance_message_en"] ?? "").trim() || null,
      operationalNoticeType: (["maintenance", "restart", "update"].includes(String(row.operational_notice_type)) ? String(row.operational_notice_type) : "none") as ProjectSummary["operationalNoticeType"],
      resourceType: String(row.resource_type) as "application" | "service",
      technologies: this.technologiesFor(projectId),
      liveUrl: String(row.live_url),
      repositoryUrl: row.repository_url ? String(row.repository_url) : null,
      caseStudyUrl: row.case_study_url ? String(row.case_study_url) : null,
      cover: row.large_path ? { src: `/media/${row.large_path}`, srcSmall: `/media/${row.small_path}`, alt: String(row[locale === "es" ? "alt_es" : "alt_en"] ?? "") } : null,
      health: {
        status: status as ProjectSummary["health"]["status"],
        uptime30d: this.uptimeForDays(projectId, 30),
        streakStartedAt,
        streakDays: streakStartedAt ? Math.max(0, (Date.now() - Date.parse(streakStartedAt)) / 86_400_000) : null,
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
    return {
      ...this.toSummary(row, locale),
      description: String(row[locale === "es" ? "description_es" : "description_en"] ?? ""),
      gallery: this.galleryFor(projectId, locale),
      uptime: {
        h24: this.uptimeForDays(projectId, 1),
        d7: this.uptimeForDays(projectId, 7),
        d30: this.uptimeForDays(projectId, 30),
        all: this.uptimeForDays(projectId, null),
      },
      latencySeries: (this.db.sqlite.prepare(`SELECT checked_at,latency_ms FROM health_checks WHERE project_id=? AND success=1 AND latency_ms IS NOT NULL ORDER BY checked_at DESC LIMIT 30`).all(projectId) as Row[]).reverse().map((point) => ({ at: String(point.checked_at), value: Number(point.latency_ms) })),
      incidents: (this.db.sqlite.prepare(`SELECT started_at,ended_at,trigger_error_code,trigger_status_code,recovered_status_code FROM incidents WHERE project_id=? ORDER BY started_at DESC LIMIT 10`).all(projectId) as Row[]).map((incident) => ({ startedAt: String(incident.started_at), endedAt: incident.ended_at ? String(incident.ended_at) : null, trigger: incident.trigger_error_code ? String(incident.trigger_error_code) : null, statusCode: incident.trigger_status_code == null ? null : Number(incident.trigger_status_code), recoveredStatusCode: incident.recovered_status_code == null ? null : Number(incident.recovered_status_code) })),
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

  private uptimeForDays(projectId: string, days: number | null) {
    if (days && days <= 30) {
      const raw = this.db.sqlite.prepare(`SELECT COUNT(*) AS checks,SUM(success) AS successes FROM health_checks WHERE project_id=? AND checked_at>=?`).get(projectId, new Date(Date.now() - days * 86_400_000).toISOString()) as { checks: number; successes: number | null };
      return raw.checks ? Math.round(((raw.successes ?? 0) / raw.checks) * 10_000) / 100 : null;
    }
    const since = days ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : null;
    const row = (since
      ? this.db.sqlite.prepare(`SELECT SUM(check_count) AS checks,SUM(success_count) AS successes FROM daily_metrics WHERE project_id=? AND day>=?`).get(projectId, since)
      : this.db.sqlite.prepare(`SELECT SUM(check_count) AS checks,SUM(success_count) AS successes FROM daily_metrics WHERE project_id=?`).get(projectId)) as { checks: number | null; successes: number | null };
    return row.checks ? Math.round(((row.successes ?? 0) / row.checks) * 10_000) / 100 : null;
  }

  private dailySeries(projectId: string, days: number) {
    const entries = new Map((this.db.sqlite.prepare(`SELECT day,check_count,success_count FROM daily_metrics WHERE project_id=? AND day>=?`).all(projectId, new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)) as Row[]).map((row) => [String(row.day), Number(row.check_count) ? (Number(row.success_count) / Number(row.check_count)) * 100 : null]));
    return Array.from({ length: days }, (_, index) => entries.get(new Date(Date.now() - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10)) ?? null);
  }

  private assertPublishable(id: string, input: ProjectInput) {
    const required = ["titleEn", "titleEs", "summaryEn", "summaryEs", "descriptionEn", "descriptionEs", "coverAltEn", "coverAltEs"] as const;
    const missing = required.filter((key) => !input[key].trim());
    if (missing.length) throw new ProjectValidationError("INCOMPLETE_TRANSLATIONS", [...missing]);
    if (input.operationalNoticeType !== "none") {
      const missingNotice = (["maintenanceMessageEn", "maintenanceMessageEs"] as const).filter((key) => !input[key].trim());
      if (missingNotice.length) throw new ProjectValidationError("INCOMPLETE_MAINTENANCE_TRANSLATIONS", [...missingNotice]);
    }
    if (!this.db.sqlite.prepare(`SELECT id FROM media WHERE project_id=?`).get(id)) throw new Error("COVER_REQUIRED");
  }

  private uniqueSlug(base: string) {
    let slug = base;
    let suffix = 2;
    while (this.db.sqlite.prepare(`SELECT id FROM projects WHERE slug=?`).get(slug)) slug = `${base}-${suffix++}`;
    return slug;
  }
}

export function slugify(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
}
