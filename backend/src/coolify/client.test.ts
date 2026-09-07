import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { CoolifyClient } from "./client.js";

describe("CoolifyClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes applications and services without retaining sensitive fields", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const isApplications = String(input).endsWith("/applications");
      return new Response(JSON.stringify(isApplications ? [{ uuid: "app-1", name: "App", fqdn: "app.example.com,https://alt.example.com", status: "running", build_pack: "nixpacks", destination: { server: { uuid: "server-1", ip: "private" } }, dockerfile: "secret", manual_webhook_secret_github: "secret" }] : [{ uuid: "service-1", name: "Service", service_type: "gitea", applications: [{ fqdn: "git.example.com" }], docker_compose_raw: "secret" }]), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new CoolifyClient(loadConfig({ NODE_ENV: "test", COOLIFY_API_URL: "https://coolify.example.com", COOLIFY_API_KEY: "token" }));
    const { resources, warnings } = await client.listResources();
    expect(resources).toHaveLength(2);
    expect(warnings).toEqual([]);
    expect(resources[0]).toMatchObject({ resourceType: "application", resourceUuid: "app-1", serverUuid: "server-1", suggestedUrls: ["https://app.example.com", "https://alt.example.com"] });
    expect(resources[1]).toMatchObject({ resourceType: "service", resourceUuid: "service-1", suggestedUrls: ["https://git.example.com"] });
    expect(JSON.stringify(resources)).not.toContain("dockerfile");
    expect(JSON.stringify(resources)).not.toContain("secret");
  });

  it("reads safe Sentinel capability and pulse metadata without retaining its token", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/servers")) return new Response(JSON.stringify([{ uuid: "server-1", name: "Primary" }]), { status: 200 });
      return new Response(JSON.stringify({ is_sentinel_enabled: true, is_metrics_enabled: true, sentinel_metrics_refresh_rate_seconds: 10, sentinel_metrics_history_days: 7, sentinel_push_interval_seconds: 60, sentinel_updated_at: "2026-08-16T10:00:00.000Z", sentinel_token: "do-not-store" }), { status: 200 });
    }));
    const client = new CoolifyClient(loadConfig({ NODE_ENV: "test", COOLIFY_API_URL: "https://coolify.example.com", COOLIFY_API_KEY: "token" }));
    const result = await client.listSentinelStatus();
    expect(result.warnings).toEqual([]);
    expect(result.servers).toEqual([{ serverUuid: "server-1", name: "Primary", enabled: true, metricsEnabled: true, refreshRateSeconds: 10, historyDays: 7, pushIntervalSeconds: 60, lastReportedAt: "2026-08-16T10:00:00.000Z", syncedAt: expect.any(String) }]);
    expect(JSON.stringify(result)).not.toContain("do-not-store");
  });

  it("keeps applications when the services endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/applications")) return new Response(JSON.stringify([{ uuid: "app-1", name: "App", fqdn: "app.example.com" }]), { status: 200 });
      if (url.includes("/deployments/applications/")) return new Response(JSON.stringify({ deployments: [] }), { status: 200 });
      return new Response(JSON.stringify({ message: "Method not allowed" }), { status: 405 });
    }));
    const client = new CoolifyClient(loadConfig({ NODE_ENV: "test", COOLIFY_API_URL: "https://coolify.example.com", COOLIFY_API_KEY: "token" }));
    const result = await client.listResources();
    expect(result.resources).toHaveLength(1);
    expect(result.warnings).toMatchObject([{ source: "services", status: 405 }]);
  });

  it("derives active and last successful deployment metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/applications")) return new Response(JSON.stringify([{ uuid: "app-1", name: "App", fqdn: "app.example.com" }]), { status: 200 });
      if (url.endsWith("/services")) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify({ deployments: [
        { status: "finished", finished_at: "2026-08-15T09:00:00.000Z" },
        { status: "in_progress", created_at: "2026-08-16T09:00:00.000Z" },
      ] }), { status: 200 });
    }));
    const client = new CoolifyClient(loadConfig({ NODE_ENV: "test", COOLIFY_API_URL: "https://coolify.example.com", COOLIFY_API_KEY: "token" }));
    const result = await client.listResources();
    expect(result.resources[0]).toMatchObject({ deploymentInProgress: true, lastSuccessfulDeploymentAt: "2026-08-15T09:00:00.000Z" });
  });

  it("explains an untrusted Coolify certificate without leaking request data", async () => {
    const failure = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }) });
    vi.stubGlobal("fetch", vi.fn(async () => { throw failure; }));
    const client = new CoolifyClient(loadConfig({ NODE_ENV: "test", COOLIFY_API_URL: "https://coolify.example.com", COOLIFY_API_KEY: "secret-token" }));
    await expect(client.listResources()).rejects.toMatchObject({ code: "COOLIFY_SYNC_FAILED" });
    await expect(client.listResources()).rejects.not.toThrow("secret-token");
  });
});
