import { describe, expect, it } from "vitest";
import { projectInputSchema } from "@izbri/contracts";
import { applyPreviewInput, previewStorageKey } from "./api";
import { getDemoProjectDetail } from "./demo-projects";

describe("admin preview projection", () => {
  it("applies unsaved localized form values without changing monitoring data", () => {
    const base = getDemoProjectDetail("demo-atlas-inbox", "es");
    expect(base).not.toBeNull();
    const input = projectInputSchema.parse({
      slug: "nombre-nuevo",
      titleEn: "New name",
      titleEs: "Nombre nuevo",
      summaryEn: "English summary",
      summaryEs: "Resumen español",
      descriptionEn: "English description",
      descriptionEs: "Descripción española",
      maintenanceMessageEn: "Updating",
      maintenanceMessageEs: "Actualizando",
      operationalNoticeType: "update",
      liveUrl: "https://preview.example.com",
      repositoryUrl: "",
      caseStudyUrl: "https://example.com/case-study",
      technologyNames: ["Next.js", "SQLite"],
      featured: false,
      published: false,
      displayOrder: 7,
      accentColor: "mint",
      monitoringEnabled: true,
      healthUrl: "https://preview.example.com/health",
      healthMethod: "GET",
      healthTimeoutMs: 10_000,
      expectedStatusMin: 200,
      expectedStatusMax: 399,
      coverAltEn: "English cover",
      coverAltEs: "Portada española",
    });

    const preview = applyPreviewInput(base!, input, "es");
    expect(preview).toMatchObject({
      slug: "nombre-nuevo",
      title: "Nombre nuevo",
      summary: "Resumen español",
      description: "Descripción española",
      maintenanceMessage: "Actualizando",
      liveUrl: "https://preview.example.com",
      repositoryUrl: null,
      caseStudyUrl: "https://example.com/case-study",
      displayOrder: 7,
      accentColor: "mint",
    });
    expect(preview.technologies.map((technology) => technology.slug)).toEqual(["next-js", "sqlite"]);
    expect(preview.health).toEqual(base!.health);
    expect(preview.coolify).toEqual(base!.coolify);
    expect(previewStorageKey(base!.id)).toBe("izbri-project-preview:demo-project-0");
  });
});
