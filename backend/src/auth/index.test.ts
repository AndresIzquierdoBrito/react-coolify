import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createDatabase, type DatabaseContext } from "../db/index.js";

describe("temporary username/password authentication", () => {
  let db: DatabaseContext;
  let tempDirectory: string;

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "izbri-auth-"));
  });

  afterEach(() => {
    db?.sqlite.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("creates the normal authenticated session only for configured credentials", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_PATH: ":memory:",
      UPLOADS_PATH: tempDirectory,
      SESSION_SECRET: "test-session-secret-with-enough-length",
      ADMIN_USERNAME: "temporary-owner",
      ADMIN_PASSWORD: "a-long-temporary-password",
      LOG_LEVEL: "silent",
    });
    db = createDatabase(":memory:");
    const { app } = createApp(config, db);
    const agent = supertest.agent(app);

    const anonymous = await agent.get("/api/v1/auth/session").expect(200);
    expect(anonymous.body).toMatchObject({ authenticated: false, methods: { password: true, github: false } });
    await agent.post("/api/v1/auth/password").send({ username: "temporary-owner", password: "wrong" }).expect(401);
    await agent.post("/api/v1/auth/password").send({ username: "temporary-owner", password: "a-long-temporary-password" }).expect(200);

    const authenticated = await agent.get("/api/v1/auth/session").expect(200);
    expect(authenticated.body.authenticated).toBe(true);
    expect(authenticated.body.user.login).toBe("temporary-owner");
    expect(authenticated.body.csrfToken).toEqual(expect.any(String));
  });

  it("exposes only GitHub authentication in production", async () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_PATH: ":memory:",
      UPLOADS_PATH: tempDirectory,
      APP_ORIGIN: "https://projects.izbri.com",
      SESSION_SECRET: "test-production-session-secret-with-length",
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      GITHUB_ADMIN_LOGINS: "AndresIzquierdoBrito",
      ADMIN_USERNAME: "stale-user",
      ADMIN_PASSWORD: "stale-password",
      LOG_LEVEL: "silent",
    });
    db = createDatabase(":memory:");
    const { app } = createApp(config, db);
    const agent = supertest.agent(app);

    await agent.get("/api/v1/auth/session").expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ authenticated: false, configured: true, methods: { github: true, password: false } });
    });
    await agent.post("/api/v1/auth/password").send({ username: "stale-user", password: "stale-password" }).expect(404);
    const redirect = await agent.get("/api/v1/auth/github").expect(302);
    expect(new URL(redirect.headers.location).searchParams.get("state")).toBeTruthy();
  });
});
