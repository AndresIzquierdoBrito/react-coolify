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
  const coolifyRoot = parsed.COOLIFY_API_URL?.replace(/\/$/, "");
  return {
    ...parsed,
    databasePath: path.resolve(parsed.DATABASE_PATH),
    uploadsPath: path.resolve(parsed.UPLOADS_PATH),
    coolifyApiUrl: coolifyRoot
      ? coolifyRoot.endsWith("/api/v1")
        ? coolifyRoot
        : `${coolifyRoot}/api/v1`
      : undefined,
    githubAdminLogins: new Set(
      parsed.GITHUB_ADMIN_LOGINS.split(",")
        .map((login) => login.trim().toLowerCase())
        .filter(Boolean),
    ),
    passwordAuthConfigured: Boolean(parsed.ADMIN_USERNAME && parsed.ADMIN_PASSWORD),
    isProduction: parsed.NODE_ENV === "production",
  };
}
