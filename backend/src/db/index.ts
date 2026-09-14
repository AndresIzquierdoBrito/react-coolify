import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export interface DatabaseContext {
  sqlite: Database.Database;
  orm: BetterSQLite3Database<typeof schema>;
}

export function createDatabase(databasePath: string): DatabaseContext {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  migrate(sqlite);
  return { sqlite, orm: drizzle(sqlite, { schema }) };
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coolify_teams (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, api_url TEXT,
      credential_source TEXT NOT NULL DEFAULT 'database',
      token_ciphertext TEXT, token_iv TEXT, token_auth_tag TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      sync_status TEXT NOT NULL DEFAULT 'never',
      last_attempt_at TEXT, last_successful_at TEXT,
      last_error_code TEXT, last_error_message TEXT,
      synced_resource_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(name COLLATE NOCASE)
    );
    CREATE TABLE IF NOT EXISTS coolify_resources (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL DEFAULT 'legacy-default' REFERENCES coolify_teams(id),
      resource_type TEXT NOT NULL, resource_uuid TEXT NOT NULL,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT,
      source_type TEXT, suggested_urls_json TEXT NOT NULL DEFAULT '[]',
      source_branch TEXT, commit_sha TEXT, updated_at_source TEXT,
      created_at_source TEXT, server_uuid TEXT,
      deployment_in_progress INTEGER NOT NULL DEFAULT 0,
      last_successful_deployment_at TEXT, synced_at TEXT NOT NULL,
      UNIQUE(team_id, resource_type, resource_uuid)
    );
    CREATE TABLE IF NOT EXISTS sentinel_servers (
      team_id TEXT NOT NULL DEFAULT 'legacy-default' REFERENCES coolify_teams(id),
      server_uuid TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
      metrics_enabled INTEGER NOT NULL DEFAULT 0, refresh_rate_seconds INTEGER,
      history_days INTEGER, push_interval_seconds INTEGER, last_reported_at TEXT, synced_at TEXT NOT NULL,
      PRIMARY KEY(team_id, server_uuid)
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, coolify_resource_id TEXT NOT NULL UNIQUE REFERENCES coolify_resources(id),
      slug TEXT NOT NULL UNIQUE, title_en TEXT NOT NULL DEFAULT '', title_es TEXT NOT NULL DEFAULT '',
      summary_en TEXT NOT NULL DEFAULT '', summary_es TEXT NOT NULL DEFAULT '',
      description_en TEXT NOT NULL DEFAULT '', description_es TEXT NOT NULL DEFAULT '',
      maintenance_message_en TEXT NOT NULL DEFAULT '', maintenance_message_es TEXT NOT NULL DEFAULT '',
      operational_notice_type TEXT NOT NULL DEFAULT 'none',
      live_url TEXT NOT NULL, repository_url TEXT, case_study_url TEXT,
      featured INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0, accent_color TEXT NOT NULL DEFAULT 'lime', monitoring_enabled INTEGER NOT NULL DEFAULT 1,
      health_url TEXT, health_method TEXT NOT NULL DEFAULT 'GET', health_timeout_ms INTEGER NOT NULL DEFAULT 10000,
      expected_status_min INTEGER NOT NULL DEFAULT 200, expected_status_max INTEGER NOT NULL DEFAULT 399,
      uptime_start_date TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_resources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      coolify_resource_id TEXT NOT NULL REFERENCES coolify_resources(id),
      label_en TEXT NOT NULL DEFAULT '', label_es TEXT NOT NULL DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 0,
      uptime_enabled INTEGER NOT NULL DEFAULT 0,
      health_url TEXT, health_method TEXT NOT NULL DEFAULT 'GET',
      health_timeout_ms INTEGER NOT NULL DEFAULT 10000,
      expected_status_min INTEGER NOT NULL DEFAULT 200,
      expected_status_max INTEGER NOT NULL DEFAULT 399,
      uptime_start_date TEXT,
      UNIQUE(coolify_resource_id), UNIQUE(project_id, display_order)
    );
    CREATE INDEX IF NOT EXISTS project_resources_project_order ON project_resources(project_id, display_order);
    CREATE TABLE IF NOT EXISTS technologies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS project_technologies (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      technology_id TEXT NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
      UNIQUE(project_id, technology_id)
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      original_path TEXT NOT NULL, large_path TEXT NOT NULL, small_path TEXT NOT NULL,
      alt_en TEXT NOT NULL DEFAULT '', alt_es TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_gallery (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL, mime_type TEXT NOT NULL,
      alt_en TEXT NOT NULL DEFAULT '', alt_es TEXT NOT NULL DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS project_gallery_order ON project_gallery(project_id, display_order, created_at);
    CREATE TABLE IF NOT EXISTS health_state (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'collecting', consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT, last_success_at TEXT, streak_started_at TEXT, latency_ms INTEGER,
      first_checked_at TEXT, monitor_interval_ms_at_start INTEGER
    );
    CREATE TABLE IF NOT EXISTS health_checks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      checked_at TEXT NOT NULL, success INTEGER NOT NULL, status_code INTEGER,
      latency_ms INTEGER, error_code TEXT
    );
    CREATE INDEX IF NOT EXISTS health_checks_project_date ON health_checks(project_id, checked_at);
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL, ended_at TEXT, trigger_error_code TEXT,
      trigger_status_code INTEGER, recovered_status_code INTEGER
    );
    CREATE INDEX IF NOT EXISTS incidents_project_date ON incidents(project_id, started_at);
    CREATE TABLE IF NOT EXISTS daily_metrics (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      day TEXT NOT NULL, check_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
      latency_sum_ms REAL NOT NULL DEFAULT 0, latency_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_id, day)
    );
    CREATE TABLE IF NOT EXISTS resource_health_state (
      project_resource_id TEXT PRIMARY KEY REFERENCES project_resources(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'collecting', consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT, last_success_at TEXT, streak_started_at TEXT, latency_ms INTEGER,
      first_checked_at TEXT, monitor_interval_ms_at_start INTEGER
    );
    CREATE TABLE IF NOT EXISTS resource_health_checks (
      id TEXT PRIMARY KEY, project_resource_id TEXT NOT NULL REFERENCES project_resources(id) ON DELETE CASCADE,
      checked_at TEXT NOT NULL, success INTEGER NOT NULL, status_code INTEGER, latency_ms INTEGER, error_code TEXT
    );
    CREATE INDEX IF NOT EXISTS resource_health_checks_project_date ON resource_health_checks(project_resource_id, checked_at);
    CREATE TABLE IF NOT EXISTS resource_incidents (
      id TEXT PRIMARY KEY, project_resource_id TEXT NOT NULL REFERENCES project_resources(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL, ended_at TEXT, trigger_error_code TEXT, trigger_status_code INTEGER, recovered_status_code INTEGER
    );
    CREATE INDEX IF NOT EXISTS resource_incidents_project_date ON resource_incidents(project_resource_id, started_at);
    CREATE TABLE IF NOT EXISTS resource_daily_metrics (
      project_resource_id TEXT NOT NULL REFERENCES project_resources(id) ON DELETE CASCADE,
      day TEXT NOT NULL, check_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
      latency_sum_ms REAL NOT NULL DEFAULT 0, latency_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_resource_id, day)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1), title TEXT NOT NULL DEFAULT 'Izbri Projects',
      github_url TEXT, contact_url TEXT, updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO site_settings(id, updated_at) VALUES(1, datetime('now'));
  `);
  ensureColumn(db, "coolify_resources", "source_branch", "TEXT");
  ensureColumn(db, "coolify_resources", "commit_sha", "TEXT");
  ensureColumn(db, "coolify_resources", "updated_at_source", "TEXT");
  ensureColumn(db, "coolify_resources", "server_uuid", "TEXT");
  ensureColumn(db, "coolify_resources", "deployment_in_progress", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "coolify_resources", "last_successful_deployment_at", "TEXT");
  ensureColumn(db, "coolify_resources", "team_id", "TEXT NOT NULL DEFAULT 'legacy-default'");
  ensureColumn(db, "coolify_resources", "name", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "coolify_resources", "resource_type", "TEXT NOT NULL DEFAULT 'application'");
  ensureColumn(db, "coolify_resources", "resource_uuid", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "coolify_resources", "suggested_urls_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "sentinel_servers", "team_id", "TEXT NOT NULL DEFAULT 'legacy-default'");
  ensureLegacyTeam(db);
  migrateLegacyCoolifyResources(db);
  migrateLegacySentinelServers(db);
  ensureColumn(db, "projects", "accent_color", "TEXT NOT NULL DEFAULT 'lime'");
  ensureColumn(db, "projects", "maintenance_message_en", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "projects", "maintenance_message_es", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "projects", "operational_notice_type", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, "projects", "uptime_start_date", "TEXT");
  ensureColumn(db, "projects", "monitoring_enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "projects", "health_url", "TEXT");
  ensureColumn(db, "projects", "health_method", "TEXT NOT NULL DEFAULT 'GET'");
  ensureColumn(db, "projects", "health_timeout_ms", "INTEGER NOT NULL DEFAULT 10000");
  ensureColumn(db, "projects", "expected_status_min", "INTEGER NOT NULL DEFAULT 200");
  ensureColumn(db, "projects", "expected_status_max", "INTEGER NOT NULL DEFAULT 399");
  ensureColumn(db, "incidents", "trigger_error_code", "TEXT");
  ensureColumn(db, "incidents", "trigger_status_code", "INTEGER");
  ensureColumn(db, "incidents", "recovered_status_code", "INTEGER");
  ensureColumn(db, "health_state", "first_checked_at", "TEXT");
  ensureColumn(db, "health_state", "monitor_interval_ms_at_start", "INTEGER");
  ensureColumn(db, "health_state", "status", "TEXT NOT NULL DEFAULT 'collecting'");
  ensureColumn(db, "health_state", "consecutive_failures", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "health_state", "last_checked_at", "TEXT");
  ensureColumn(db, "health_state", "last_success_at", "TEXT");
  ensureColumn(db, "health_state", "streak_started_at", "TEXT");
  ensureColumn(db, "health_state", "latency_ms", "INTEGER");
  ensureColumn(db, "health_checks", "id", "TEXT");
  ensureColumn(db, "health_checks", "success", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "health_checks", "status_code", "INTEGER");
  ensureColumn(db, "health_checks", "latency_ms", "INTEGER");
  ensureColumn(db, "health_checks", "error_code", "TEXT");
  ensureColumn(db, "incidents", "id", "TEXT");
  ensureColumn(db, "incidents", "ended_at", "TEXT");
  ensureColumn(db, "incidents", "trigger_error_code", "TEXT");
  ensureColumn(db, "incidents", "trigger_status_code", "INTEGER");
  ensureColumn(db, "incidents", "recovered_status_code", "INTEGER");
  ensureColumn(db, "daily_metrics", "check_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "daily_metrics", "success_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "daily_metrics", "latency_sum_ms", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "daily_metrics", "latency_count", "INTEGER NOT NULL DEFAULT 0");
  migrateProjectResources(db);
  db.exec(`
    UPDATE projects
    SET uptime_start_date = COALESCE(
      (SELECT substr(created_at_source, 1, 10) FROM coolify_resources WHERE coolify_resources.id = projects.coolify_resource_id AND created_at_source IS NOT NULL AND length(created_at_source) >= 10),
      substr(created_at, 1, 10),
      '1970-01-01'
    )
    WHERE uptime_start_date IS NULL OR uptime_start_date = '';
    UPDATE health_state
    SET first_checked_at = COALESCE(
      (SELECT MIN(checked_at) FROM health_checks WHERE health_checks.project_id = health_state.project_id),
      (SELECT MIN(day) || 'T00:00:00.000Z' FROM daily_metrics WHERE daily_metrics.project_id = health_state.project_id)
    )
    WHERE first_checked_at IS NULL;
    UPDATE resource_health_state
    SET first_checked_at = COALESCE(
      (SELECT MIN(checked_at) FROM resource_health_checks WHERE resource_health_checks.project_resource_id = resource_health_state.project_resource_id),
      (SELECT MIN(day) || 'T00:00:00.000Z' FROM resource_daily_metrics WHERE resource_daily_metrics.project_resource_id = resource_health_state.project_resource_id)
    )
    WHERE first_checked_at IS NULL;
  `);
}

function migrateProjectResources(db: Database.Database) {
  const rows = db.prepare(`
    SELECT p.id AS project_id,p.coolify_resource_id,cr.name,cr.created_at_source,
      p.monitoring_enabled,p.health_url,p.health_method,p.health_timeout_ms,
      p.expected_status_min,p.expected_status_max,p.uptime_start_date
    FROM projects p JOIN coolify_resources cr ON cr.id=p.coolify_resource_id
  `).all() as Record<string, unknown>[];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO project_resources
      (id,project_id,coolify_resource_id,label_en,label_es,display_order,uptime_enabled,health_url,health_method,health_timeout_ms,expected_status_min,expected_status_max,uptime_start_date)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const state = db.prepare(`INSERT OR IGNORE INTO resource_health_state(project_resource_id,status,consecutive_failures,last_checked_at,last_success_at,streak_started_at,latency_ms,first_checked_at,monitor_interval_ms_at_start) SELECT ?,status,consecutive_failures,last_checked_at,last_success_at,streak_started_at,latency_ms,first_checked_at,monitor_interval_ms_at_start FROM health_state WHERE project_id=?`);
  const checks = db.prepare(`INSERT OR IGNORE INTO resource_health_checks(id,project_resource_id,checked_at,success,status_code,latency_ms,error_code) SELECT id,?,checked_at,success,status_code,latency_ms,error_code FROM health_checks WHERE project_id=?`);
  const incidents = db.prepare(`INSERT OR IGNORE INTO resource_incidents(id,project_resource_id,started_at,ended_at,trigger_error_code,trigger_status_code,recovered_status_code) SELECT id,?,started_at,ended_at,trigger_error_code,trigger_status_code,recovered_status_code FROM incidents WHERE project_id=?`);
  const daily = db.prepare(`INSERT OR IGNORE INTO resource_daily_metrics(project_resource_id,day,check_count,success_count,latency_sum_ms,latency_count) SELECT ?,day,check_count,success_count,latency_sum_ms,latency_count FROM daily_metrics WHERE project_id=?`);
  db.transaction(() => {
    for (const row of rows) {
      const projectId = String(row.project_id);
      const resourceId = `${projectId}:primary`;
      const start = String(row.uptime_start_date ?? row.created_at_source ?? new Date().toISOString()).slice(0, 10);
      insert.run(resourceId, projectId, String(row.coolify_resource_id), String(row.name ?? ""), String(row.name ?? ""), 0, Number(row.monitoring_enabled), row.health_url ?? null, row.health_method ?? "GET", Number(row.health_timeout_ms ?? 10_000), Number(row.expected_status_min ?? 200), Number(row.expected_status_max ?? 399), start);
      state.run(resourceId, projectId); checks.run(resourceId, projectId); incidents.run(resourceId, projectId); daily.run(resourceId, projectId);
    }
  })();
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureLegacyTeam(db: Database.Database) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO coolify_teams
      (id,name,api_url,credential_source,enabled,sync_status,synced_resource_count,created_at,updated_at)
    VALUES ('legacy-default','Default team',NULL,'environment',1,'never',0,?,?)
  `).run(now, now);
}

function migrateLegacyCoolifyResources(db: Database.Database) {
  const indexes = db.prepare(`PRAGMA index_list(coolify_resources)`).all() as { name: string; unique: number }[];
  const legacyUnique = indexes.some((index) => {
    if (!index.unique) return false;
    const columns = db.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`).all() as { name: string | null }[];
    return columns.map((column) => column.name).join(",") === "resource_type,resource_uuid";
  });
  if (!legacyUnique) return;
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE coolify_resources_v2 (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL DEFAULT 'legacy-default',
        resource_type TEXT NOT NULL, resource_uuid TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT,
        source_type TEXT, source_branch TEXT, commit_sha TEXT,
        suggested_urls_json TEXT NOT NULL DEFAULT '[]', created_at_source TEXT,
        updated_at_source TEXT, server_uuid TEXT,
        deployment_in_progress INTEGER NOT NULL DEFAULT 0,
        last_successful_deployment_at TEXT, synced_at TEXT NOT NULL,
        UNIQUE(team_id, resource_type, resource_uuid)
      );
    `);
    const rows = db.prepare(`SELECT id,team_id,resource_type,resource_uuid,name,description,status,source_type,source_branch,commit_sha,suggested_urls_json,created_at_source,updated_at_source,server_uuid,deployment_in_progress,last_successful_deployment_at,synced_at FROM coolify_resources`).all() as Record<string, unknown>[];
    const insert = db.prepare(`INSERT INTO coolify_resources_v2(id,team_id,resource_type,resource_uuid,name,description,status,source_type,source_branch,commit_sha,suggested_urls_json,created_at_source,updated_at_source,server_uuid,deployment_in_progress,last_successful_deployment_at,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const updateProjects = db.prepare(`UPDATE projects SET coolify_resource_id=? WHERE coolify_resource_id=?`);
    for (const row of rows) {
      const teamId = String(row.team_id || "legacy-default");
      const type = String(row.resource_type);
      const uuid = String(row.resource_uuid);
      const nextId = `${teamId}:${type}:${uuid}`;
      insert.run(nextId, teamId, type, uuid, row.name, row.description, row.status, row.source_type, row.source_branch, row.commit_sha, row.suggested_urls_json, row.created_at_source, row.updated_at_source, row.server_uuid, row.deployment_in_progress, row.last_successful_deployment_at, row.synced_at);
      updateProjects.run(nextId, row.id);
    }
    db.exec(`DROP TABLE coolify_resources; ALTER TABLE coolify_resources_v2 RENAME TO coolify_resources;`);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function migrateLegacySentinelServers(db: Database.Database) {
  const columns = db.prepare(`PRAGMA table_info(sentinel_servers)`).all() as { name: string; pk: number }[];
  const legacyPrimaryKey = columns.some((column) => column.name === "server_uuid" && column.pk === 1) && !columns.some((column) => column.name === "team_id" && column.pk === 1);
  if (!legacyPrimaryKey) return;
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE sentinel_servers_v2 (
        team_id TEXT NOT NULL DEFAULT 'legacy-default', server_uuid TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
        metrics_enabled INTEGER NOT NULL DEFAULT 0, refresh_rate_seconds INTEGER,
        history_days INTEGER, push_interval_seconds INTEGER, last_reported_at TEXT,
        synced_at TEXT NOT NULL, PRIMARY KEY(team_id, server_uuid)
      );
      INSERT INTO sentinel_servers_v2(team_id,server_uuid,name,enabled,metrics_enabled,refresh_rate_seconds,history_days,push_interval_seconds,last_reported_at,synced_at)
        SELECT COALESCE(team_id,'legacy-default'),server_uuid,name,enabled,metrics_enabled,refresh_rate_seconds,history_days,push_interval_seconds,last_reported_at,synced_at FROM sentinel_servers;
      DROP TABLE sentinel_servers;
      ALTER TABLE sentinel_servers_v2 RENAME TO sentinel_servers;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function quoteIdentifier(value: string) { return `"${value.replaceAll('"', '""')}"`; }
