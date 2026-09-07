import { describe, expect, it } from "vitest";
import { messages } from "./messages";

describe("localized interface messages", () => {
  it("keeps English and Spanish message keys complete", () => {
    expect(Object.keys(messages.es).sort()).toEqual(Object.keys(messages.en).sort());
    expect(Object.values(messages.en).every(Boolean)).toBe(true);
    expect(Object.values(messages.es).every(Boolean)).toBe(true);
  });
});
