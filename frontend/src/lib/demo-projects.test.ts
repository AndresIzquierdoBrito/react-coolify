import { describe, expect, it } from "vitest";
import { getDemoProjectDetail, getDemoProjects } from "./demo-projects";

describe("sample projects", () => {
  it("provides three localized cards with complete detail states", () => {
    const english = getDemoProjects("en");
    const spanish = getDemoProjects("es");
    expect(english).toHaveLength(3);
    expect(english.map((project) => project.health.status)).toEqual(["online", "degraded", "offline"]);
    expect(spanish[0]?.summary).not.toBe(english[0]?.summary);
    for (const project of english) {
      const detail = getDemoProjectDetail(project.slug, "en");
      expect(detail?.description).toBeTruthy();
      expect(detail?.health.daily).toHaveLength(30);
      expect(detail?.latencySeries.length).toBeGreaterThan(1);
    }
  });
});
