import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const productionBase = {
  NODE_ENV: "production" as const,
  APP_ORIGIN: "https://projects.izbri.com",
  SESSION_SECRET: "a-production-session-secret-that-is-random",
};

describe("production configuration", () => {
  it("requires complete GitHub authentication settings", () => {
    expect(() => loadConfig(productionBase)).toThrow(/GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_ADMIN_LOGINS/);
    expect(() => loadConfig({
      ...productionBase,
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      GITHUB_ADMIN_LOGINS: " , ",
    })).toThrow(/GITHUB_ADMIN_LOGINS/);
  });

  it("disables the development password fallback in production", () => {
    const config = loadConfig({
      ...productionBase,
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      GITHUB_ADMIN_LOGINS: "AndresIzquierdoBrito",
      ADMIN_USERNAME: "stale-user",
      ADMIN_PASSWORD: "stale-password",
    });
    expect(config.githubAuthConfigured).toBe(true);
    expect(config.githubAdminLogins).toEqual(new Set(["andresizquierdobrito"]));
    expect(config.passwordAuthConfigured).toBe(false);
  });

  it("treats an empty optional contact URL as unset", () => {
    const config = loadConfig({ ...productionBase, OWNER_CONTACT_URL: "", GITHUB_CLIENT_ID: "client-id", GITHUB_CLIENT_SECRET: "client-secret", GITHUB_ADMIN_LOGINS: "admin" });
    expect(config.OWNER_CONTACT_URL).toBeUndefined();
  });
});
