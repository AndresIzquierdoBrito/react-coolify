import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const coolifyResources = sqliteTable(
  "coolify_resources",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type", { enum: ["application", "service"] }).notNull(),
    resourceUuid: text("resource_uuid").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status"),
    sourceType: text("source_type"),
    sourceBranch: text("source_branch"),
    commitSha: text("commit_sha"),
    suggestedUrlsJson: text("suggested_urls_json").notNull().default("[]"),
    createdAtSource: text("created_at_source"),
    updatedAtSource: text("updated_at_source"),
    serverUuid: text("server_uuid"),
    deploymentInProgress: integer("deployment_in_progress", { mode: "boolean" }).notNull().default(false),
    lastSuccessfulDeploymentAt: text("last_successful_deployment_at"),
    syncedAt: text("synced_at").notNull(),
  },
  (table) => [uniqueIndex("coolify_resource_unique").on(table.resourceType, table.resourceUuid)],
);

export const sentinelServers = sqliteTable("sentinel_servers", {
  serverUuid: text("server_uuid").primaryKey(),
  name: text("name").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  metricsEnabled: integer("metrics_enabled", { mode: "boolean" }).notNull().default(false),
  refreshRateSeconds: integer("refresh_rate_seconds"),
  historyDays: integer("history_days"),
  pushIntervalSeconds: integer("push_interval_seconds"),
  lastReportedAt: text("last_reported_at"),
  syncedAt: text("synced_at").notNull(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    coolifyResourceId: text("coolify_resource_id").notNull().references(() => coolifyResources.id),
    slug: text("slug").notNull().unique(),
    titleEn: text("title_en").notNull().default(""),
    titleEs: text("title_es").notNull().default(""),
    summaryEn: text("summary_en").notNull().default(""),
    summaryEs: text("summary_es").notNull().default(""),
    descriptionEn: text("description_en").notNull().default(""),
    descriptionEs: text("description_es").notNull().default(""),
    maintenanceMessageEn: text("maintenance_message_en").notNull().default(""),
    maintenanceMessageEs: text("maintenance_message_es").notNull().default(""),
    operationalNoticeType: text("operational_notice_type").notNull().default("none"),
    liveUrl: text("live_url").notNull(),
    repositoryUrl: text("repository_url"),
    caseStudyUrl: text("case_study_url"),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    accentColor: text("accent_color", { enum: ["lime", "chartreuse", "mint", "aqua", "cyan", "turquoise", "sky", "periwinkle", "yellow", "amber", "tangerine", "coral", "raspberry", "pink"] }).notNull().default("lime"),
    monitoringEnabled: integer("monitoring_enabled", { mode: "boolean" }).notNull().default(true),
    healthUrl: text("health_url"),
    healthMethod: text("health_method", { enum: ["GET", "HEAD"] }).notNull().default("GET"),
    healthTimeoutMs: integer("health_timeout_ms").notNull().default(10_000),
    expectedStatusMin: integer("expected_status_min").notNull().default(200),
    expectedStatusMax: integer("expected_status_max").notNull().default(399),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("project_coolify_resource_unique").on(table.coolifyResourceId)],
);

export const technologies = sqliteTable("technologies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const projectTechnologies = sqliteTable(
  "project_technologies",
  {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    technologyId: text("technology_id").notNull().references(() => technologies.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("project_technology_unique").on(table.projectId, table.technologyId)],
);

export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().unique().references(() => projects.id, { onDelete: "cascade" }),
  originalPath: text("original_path").notNull(),
  largePath: text("large_path").notNull(),
  smallPath: text("small_path").notNull(),
  altEn: text("alt_en").notNull().default(""),
  altEs: text("alt_es").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const projectGallery = sqliteTable("project_gallery", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  altEn: text("alt_en").notNull().default(""),
  altEs: text("alt_es").notNull().default(""),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const healthState = sqliteTable("health_state", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("collecting"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastCheckedAt: text("last_checked_at"),
  lastSuccessAt: text("last_success_at"),
  streakStartedAt: text("streak_started_at"),
  latencyMs: integer("latency_ms"),
});

export const healthChecks = sqliteTable("health_checks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  checkedAt: text("checked_at").notNull(),
  success: integer("success", { mode: "boolean" }).notNull(),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms"),
  errorCode: text("error_code"),
});

export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  triggerErrorCode: text("trigger_error_code"),
  triggerStatusCode: integer("trigger_status_code"),
  recoveredStatusCode: integer("recovered_status_code"),
});

export const dailyMetrics = sqliteTable("daily_metrics", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  checkCount: integer("check_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  latencySumMs: real("latency_sum_ms").notNull().default(0),
  latencyCount: integer("latency_count").notNull().default(0),
});
