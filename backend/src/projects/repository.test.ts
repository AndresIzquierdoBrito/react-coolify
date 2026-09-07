import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectInput } from "@izbri/contracts";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { persistCoolifyResources } from "../coolify/client.js";
import { ProjectRepository, ProjectValidationError } from "./repository.js";

describe("ProjectRepository curated identity", () => {
  let directory = "";
  let db: DatabaseContext | undefined;
  afterEach(() => { db?.sqlite.close(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

  it("keeps editable public names and accent when Coolify metadata changes", () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "izbri-project-"));
    db = createDatabase(path.join(directory, "test.sqlite"));
    const now = new Date().toISOString();
    persistCoolifyResources(db, [{ id: "application:app-1", resourceType: "application", resourceUuid: "app-1", name: "Coolify Name", description: "", status: "running", sourceType: "nixpacks", branch: "main", commitSha: "abc123", deploymentInProgress: true, lastSuccessfulDeploymentAt: "2026-08-15T09:00:00.000Z", suggestedUrls: ["https://example.com"], createdAtSource: now, updatedAtSource: now, syncedAt: now }]);
    const repository = new ProjectRepository(db);
    const id = repository.import("application", "app-1", "https://example.com");
    const input: ProjectInput = { slug: "curated-name", titleEn: "Curated Name", titleEs: "Nombre Curado", summaryEn: "Summary", summaryEs: "Resumen", descriptionEn: "Description", descriptionEs: "Descripción", maintenanceMessageEn: "", maintenanceMessageEs: "", operationalNoticeType: "none", liveUrl: "https://example.com", repositoryUrl: "", caseStudyUrl: "", technologyNames: ["Next.js"], featured: false, published: false, displayOrder: 0, accentColor: "cyan", monitoringEnabled: false, healthUrl: "https://example.com", healthMethod: "GET", healthTimeoutMs: 10_000, expectedStatusMin: 200, expectedStatusMax: 399, coverAltEn: "", coverAltEs: "" };
    try {
      repository.update(id, { ...input, published: true });
      throw new Error("Expected publication validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectValidationError);
      expect((error as ProjectValidationError).fields).toEqual(["coverAltEn", "coverAltEs"]);
    }
    repository.update(id, input);
    expect(repository.getPublicBySlug("curated-name", "en")).toBeNull();
    expect(repository.getAdminPreview(id, "en")).toMatchObject({ id, title: "Curated Name", maintenanceMessage: null });
    repository.update(id, { ...input, operationalNoticeType: "update", maintenanceMessageEn: "Deploying a faster cache.", maintenanceMessageEs: "Desplegando una caché más rápida." });
    expect(repository.getAdminPreview(id, "en")).toMatchObject({ operationalNoticeType: "update", maintenanceMessage: "Deploying a faster cache." });
    expect(repository.getAdminPreview(id, "es")).toMatchObject({ operationalNoticeType: "update", maintenanceMessage: "Desplegando una caché más rápida." });
    persistCoolifyResources(db, [{ id: "application:app-1", resourceType: "application", resourceUuid: "app-1", name: "Renamed in Coolify", description: "", status: "running", sourceType: "nixpacks", branch: "main", commitSha: "def456", suggestedUrls: ["https://example.com"], createdAtSource: now, updatedAtSource: now, syncedAt: now }]);
    const project = repository.getAdminProjects()[0] as Record<string, unknown>;
    expect(project.title_en).toBe("Curated Name");
    expect(project.title_es).toBe("Nombre Curado");
    expect(project.accent_color).toBe("cyan");
    expect(project.coolify_name).toBe("Renamed in Coolify");
    expect(db.sqlite.prepare(`SELECT deployment_in_progress,last_successful_deployment_at FROM coolify_resources WHERE resource_uuid='app-1'`).get()).toEqual({ deployment_in_progress: 1, last_successful_deployment_at: "2026-08-15T09:00:00.000Z" });
  });
});
