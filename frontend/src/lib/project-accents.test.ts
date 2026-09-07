import { describe, expect, it } from "vitest";
import { projectAccents, projectAccentHex } from "./project-accents";

describe("project accent palette", () => {
  it("provides fourteen unique bright curated colors", () => {
    expect(projectAccents).toHaveLength(14);
    expect(new Set(projectAccents.map((accent) => accent.value)).size).toBe(14);
    expect(new Set(projectAccents.map((accent) => accent.hex)).size).toBe(14);
    expect(projectAccentHex("lime")).toBe("#c2ef4e");
  });
});
