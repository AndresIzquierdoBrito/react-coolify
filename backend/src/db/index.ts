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
    CREATE TABLE IF NOT EXISTS coolify_resources (
      id TEXT PRIMARY KEY, resource_type TEXT NOT NULL, resource_uuid TEXT NOT NULL,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT,
      source_type TEXT, suggested_urls_json TEXT NOT NULL DEFAULT '[]',
      created_at_source TEXT, synced_at TEXT NOT NULL,
      UNIQUE(resource_type, resource_uuid)
    );
    CREATE TABLE IF NOT EXISTS sentinel_servers (
      server_uuid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
      metrics_enabled INTEGER NOT NULL DEFAULT 0, refresh_rate_seconds INTEGER,
      history_days INTEGER, push_interval_seconds INTEGER, last_reported_at TEXT, synced_at TEXT NOT NULL
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
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
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
      last_checked_at TEXT, last_success_at TEXT, streak_started_at TEXT, latency_ms INTEGER
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
  ensureColumn(db, "projects", "accent_color", "TEXT NOT NULL DEFAULT 'lime'");
  ensureColumn(db, "projects", "maintenance_message_en", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "projects", "maintenance_message_es", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "projects", "operational_notice_type", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, "incidents", "trigger_error_code", "TEXT");
  ensureColumn(db, "incidents", "trigger_status_code", "INTEGER");
  ensureColumn(db, "incidents", "recovered_status_code", "INTEGER");
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
