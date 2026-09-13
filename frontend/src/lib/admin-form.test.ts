import { describe, expect, it } from "vitest";
import { projectInputSchema } from "@izbri/contracts";
import { getChangedProjectFields, getMissingPublicationFields } from "./admin-form";

const complete = projectInputSchema.parse({
  slug: "app-cache",
  titleEn: "AppCache",
  titleEs: "AppCache",
  summaryEn: "A useful application.",
  summaryEs: "Una aplicación útil.",
  descriptionEn: "A complete English overview.",
  descriptionEs: "Una descripción completa en español.",
  maintenanceMessageEn: "",
  maintenanceMessageEs: "",
  operationalNoticeType: "none",
  liveUrl: "https://example.com",
  repositoryUrl: "",
  caseStudyUrl: "",
  technologyNames: [],
  featured: false,
  published: true,
  displayOrder: 0,
  accentColor: "lime",
  monitoringEnabled: true,
  uptimeStartDate: "2026-01-01",
  healthUrl: "https://example.com",
  healthMethod: "GET",
  healthTimeoutMs: 10_000,
  expectedStatusMin: 200,
  expectedStatusMax: 399,
  coverAltEn: "AppCache dashboard",
  coverAltEs: "Panel de AppCache",
});

describe("publication completeness", () => {
  it("reports only the fields that are actually missing", () => {
    const errors = getMissingPublicationFields({ ...complete, summaryEn: "", descriptionEs: "" });
    expect(errors).toEqual({
      summaryEn: "Add the English summary before publishing.",
      descriptionEs: "Añade la descripción detallada en español antes de publicar.",
    });
    expect(errors.titleEn).toBeUndefined();
    expect(errors.titleEs).toBeUndefined();
  });

  it("requires only missing notice translations when a notice is active", () => {
    const errors = getMissingPublicationFields({ ...complete, operationalNoticeType: "maintenance", maintenanceMessageEn: "Planned work", maintenanceMessageEs: "" });
    expect(errors).toEqual({ maintenanceMessageEs: "Añade el aviso en español antes de publicar." });
  });

  it("tracks only values that differ from the last saved project", () => {
    expect(getChangedProjectFields({ ...complete, titleEn: "AppCache 2", operationalNoticeType: "update", maintenanceMessageEn: "Deploying" }, complete)).toEqual(["titleEn", "maintenanceMessageEn", "operationalNoticeType"]);
    expect(getChangedProjectFields({ ...complete, technologyNames: [] }, complete)).toEqual([]);
  });
});
