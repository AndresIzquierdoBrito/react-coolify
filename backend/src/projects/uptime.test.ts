import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { persistCoolifyResources } from "../coolify/client.js";
import { MonitorService } from "../monitoring/monitor.js";
import { ProjectRepository } from "./repository.js";
import type { ProjectInput } from "@izbri/contracts";

describe("historical uptime baseline", () => {
  let db: DatabaseContext | undefined;
  const now = Date.parse("2026-01-03T00:00:00.000Z");

  afterEach(() => db?.sqlite.close());

  it("defaults imported projects to the Coolify creation date", () => {
    const { repository, id } = setup("2025-12-01T12:00:00.000Z");
    expect((repository.getAdminProjects()[0] as Record<string, unknown>).uptime_start_date).toBe("2025-12-01");
    expect(repository.getAdminPreview(id, "en")?.health.uptimeStartDate).toBe("2025-12-01");
  });

  it("counts the period before the first check as perfect uptime", () => {
    const { repository, id } = setup("2026-01-01T00:00:00.000Z");
    const monitor = new MonitorService(db!, loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", MONITOR_INTERVAL_MS: "60000" }), { info() {}, warn() {} });
    monitor.record(id, { checkedAt: "2026-01-02T12:00:00.000Z", success: true, statusCode: 200, latencyMs: 20, errorCode: null });
    monitor.record(id, { checkedAt: "2026-01-02T12:01:00.000Z", success: false, statusCode: 503, latencyMs: 30, errorCode: null });

    const project = repository.getPublicBySlug("example", "en");
    expect(project).toMatchObject({ health: { uptimeStartDate: "2026-01-01", measurementStartedAt: "2026-01-02T12:00:00.000Z", assumedUptime: true } });
    expect(project?.uptime.all).toBe(99.95);
    expect(project?.health.daily.at(-3)).toBe(100);
    expect(project?.health.daily.at(-2)).toBe(99.86);
    expect(project?.health.daily.at(-1)).toBeNull();
  });

  it("shows assumed uptime without measurements and hides it when monitoring is disabled", () => {
    const { repository, id } = setup("2026-01-01T00:00:00.000Z");
    const collecting = repository.getPublicBySlug("example", "en");
    expect(collecting).toMatchObject({ health: { status: "collecting", assumedUptime: true }, uptime: { all: 100, d30: 100 } });

    db!.sqlite.prepare(`UPDATE projects SET monitoring_enabled=0 WHERE id=?`).run(id);
    const disabled = repository.getPublicBySlug("example", "en");
    expect(disabled).toMatchObject({ health: { status: "unknown", assumedUptime: false }, uptime: { all: null, d30: null } });
    expect(disabled?.health.daily.every((value) => value === null)).toBe(true);
  });

  it("uses recovery time for the current streak and validates the baseline date", () => {
    const { repository, id } = setup("2026-01-01T00:00:00.000Z");
    const monitor = new MonitorService(db!, loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", MONITOR_INTERVAL_MS: "60000" }), { info() {}, warn() {} });
    for (const minute of [0, 1, 2]) monitor.record(id, { checkedAt: `2026-01-02T12:0${minute}:00.000Z`, success: false, statusCode: 503, latencyMs: 20, errorCode: null });
    monitor.record(id, { checkedAt: "2026-01-02T12:03:00.000Z", success: true, statusCode: 200, latencyMs: 20, errorCode: null });
    expect(repository.getPublicBySlug("example", "en")?.health.streakStartedAt).toBe("2026-01-02T12:03:00.000Z");

    expect(() => repository.update(id, { ...baseInput, uptimeStartDate: "2026-01-03" })).toThrow("INVALID_UPTIME_START_DATE");
    expect(() => repository.update(id, { ...baseInput, uptimeStartDate: "2026-01-04" })).toThrow("INVALID_UPTIME_START_DATE");
    expect(() => repository.update(id, { ...baseInput, uptimeStartDate: "2026-02-30" })).toThrow("INVALID_UPTIME_START_DATE");
    repository.update(id, { ...baseInput, uptimeStartDate: "2025-12-31" });
    expect(repository.getAdminPreview(id, "en")?.health.uptimeStartDate).toBe("2025-12-31");
  });

  function setup(createdAtSource: string) {
    db = createDatabase(":memory:");
    persistCoolifyResources(db, [{ id: "application:app-1", resourceType: "application", resourceUuid: "app-1", name: "Example", description: "", status: "running", sourceType: "nixpacks", branch: "main", commitSha: "abc123", deploymentInProgress: false, lastSuccessfulDeploymentAt: null, suggestedUrls: ["https://example.com"], createdAtSource, updatedAtSource: createdAtSource, syncedAt: createdAtSource }]);
    const repository = new ProjectRepository(db, 60_000, () => now);
    const id = repository.import("application", "app-1", "https://example.com");
    db.sqlite.prepare(`UPDATE projects SET published=1 WHERE id=?`).run(id);
    return { repository, id };
  }
});

const baseInput: ProjectInput = {
  slug: "example",
  titleEn: "Example",
  titleEs: "Ejemplo",
  summaryEn: "Summary",
  summaryEs: "Resumen",
  descriptionEn: "Description",
  descriptionEs: "Descripción",
  maintenanceMessageEn: "",
  maintenanceMessageEs: "",
  operationalNoticeType: "none",
  liveUrl: "https://example.com",
  repositoryUrl: "",
  caseStudyUrl: "",
  technologyNames: [],
  featured: false,
  published: false,
  displayOrder: 0,
  accentColor: "lime",
  monitoringEnabled: true,
  uptimeStartDate: "2026-01-01",
  healthUrl: "https://example.com/health",
  healthMethod: "GET",
  healthTimeoutMs: 10_000,
  expectedStatusMin: 200,
  expectedStatusMax: 399,
  coverAltEn: "",
  coverAltEs: "",
};
