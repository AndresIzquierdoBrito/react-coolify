import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { decryptToken, encryptToken, CredentialsKeyError } from "./credentials.js";

describe("managed Coolify credentials", () => {
  it("reports a missing encryption key without exposing the token", () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:" });

    expect(() => encryptToken("team-secret", config)).toThrowError(CredentialsKeyError);
    try {
      encryptToken("team-secret", config);
    } catch (error) {
      expect(error).toMatchObject({ code: "COOLIFY_CREDENTIALS_KEY_MISSING" });
      expect(String(error)).not.toContain("team-secret");
    }
  });

  it("rejects encryption keys that are not exactly 32 bytes", () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", COOLIFY_CREDENTIALS_KEY: Buffer.alloc(31).toString("base64") });

    expect(() => encryptToken("team-secret", config)).toThrowError(CredentialsKeyError);
    try {
      encryptToken("team-secret", config);
    } catch (error) {
      expect(error).toMatchObject({ code: "COOLIFY_CREDENTIALS_KEY_INVALID" });
    }
  });

  it("round-trips a token with a valid key", () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", COOLIFY_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64") });
    const encrypted = encryptToken("team-secret", config);

    expect(decryptToken(encrypted, config)).toBe("team-secret");
    expect(JSON.stringify(encrypted)).not.toContain("team-secret");
  });
});
