import path from "node:path";
import { z } from "zod";

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_PATH: z.string().default("./data/projects.sqlite"),
  UPLOADS_PATH: z.string().default("./data/uploads"),
  SESSION_SECRET: z.string().min(24).default("development-only-change-this-secret"),
  COOLIFY_API_URL: z.string().url().optional(),
  COOLIFY_API_KEY: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_ADMIN_LOGINS: z.string().default(""),
  ADMIN_USERNAME: z.string().default(""),
  ADMIN_PASSWORD: z.string().default(""),
  OWNER_CONTACT_URL: z.string().url().optional(),
  MONITOR_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  COOLIFY_SYNC_INTERVAL_MS: z.coerce.number().int().min(60_000).default(300_000),
  ALLOW_PRIVATE_MONITOR_TARGETS: booleanFromEnv,
  LOG_LEVEL: z.string().default("info"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(source);
  if (parsed.NODE_ENV === "production") validateProductionConfig(parsed);
  const coolifyRoot = parsed.COOLIFY_API_URL?.replace(/\/$/, "");
  const isProduction = parsed.NODE_ENV === "production";
  const githubAdminLogins = new Set(
    parsed.GITHUB_ADMIN_LOGINS.split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    ...parsed,
    databasePath: path.resolve(parsed.DATABASE_PATH),
    uploadsPath: path.resolve(parsed.UPLOADS_PATH),
    coolifyApiUrl: coolifyRoot
      ? coolifyRoot.endsWith("/api/v1")
        ? coolifyRoot
        : `${coolifyRoot}/api/v1`
      : undefined,
    githubAdminLogins,
    githubAuthConfigured: Boolean(parsed.GITHUB_CLIENT_ID && parsed.GITHUB_CLIENT_SECRET && githubAdminLogins.size),
    passwordAuthConfigured: !isProduction && Boolean(parsed.ADMIN_USERNAME && parsed.ADMIN_PASSWORD),
    isProduction,
  };
}

function validateProductionConfig(config: z.infer<typeof envSchema>) {
  const missing = [
    ["GITHUB_CLIENT_ID", config.GITHUB_CLIENT_ID],
    ["GITHUB_CLIENT_SECRET", config.GITHUB_CLIENT_SECRET],
    ["GITHUB_ADMIN_LOGINS", config.GITHUB_ADMIN_LOGINS.split(",").some((login) => login.trim()) ? config.GITHUB_ADMIN_LOGINS : ""],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Production GitHub authentication is incomplete. Set: ${missing.join(", ")}.`);
  if (config.SESSION_SECRET === "development-only-change-this-secret") throw new Error("Production SESSION_SECRET must be replaced with a random secret.");
  if (new URL(config.APP_ORIGIN).protocol !== "https:") throw new Error("Production APP_ORIGIN must use HTTPS.");
}
