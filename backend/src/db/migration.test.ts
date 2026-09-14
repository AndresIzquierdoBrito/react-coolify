import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./index.js";

describe("uptime baseline migration", () => {
  let directory = "";

  afterEach(() => {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it("backfills the baseline and first measurement metadata for an existing database", () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "izbri-migration-"));
    const databasePath = path.join(directory, "legacy.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE coolify_resources (id TEXT PRIMARY KEY, created_at_source TEXT);
      CREATE TABLE projects (id TEXT PRIMARY KEY, coolify_resource_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE health_state (project_id TEXT PRIMARY KEY, first_checked_at TEXT);
      CREATE TABLE health_checks (project_id TEXT NOT NULL, checked_at TEXT NOT NULL);
      CREATE TABLE daily_metrics (project_id TEXT NOT NULL, day TEXT NOT NULL);
      INSERT INTO coolify_resources(id, created_at_source) VALUES ('application:legacy', '2025-11-02T09:30:00.000Z');
      INSERT INTO projects(id, coolify_resource_id, created_at) VALUES ('legacy-project', 'application:legacy', '2026-01-01T00:00:00.000Z');
      INSERT INTO health_state(project_id) VALUES ('legacy-project');
      INSERT INTO health_checks(project_id, checked_at) VALUES ('legacy-project', '2025-11-03T10:11:12.000Z');
    `);
    legacy.close();

    const db = createDatabase(databasePath);
    expect(db.sqlite.prepare("SELECT uptime_start_date FROM projects WHERE id='legacy-project'").pluck().get()).toBe("2025-11-02");
    expect(db.sqlite.prepare("SELECT first_checked_at FROM health_state WHERE project_id='legacy-project'").pluck().get()).toBe("2025-11-03T10:11:12.000Z");
    expect(db.sqlite.prepare("SELECT label_en,uptime_enabled FROM project_resources WHERE project_id='legacy-project'").get()).toEqual({ label_en: "", uptime_enabled: 1 });
    expect((db.sqlite.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).some((column) => column.name === "uptime_start_date")).toBe(true);
    db.sqlite.close();
  });
});
