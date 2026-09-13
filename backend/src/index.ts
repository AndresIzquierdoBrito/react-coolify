import path from "node:path";
import dotenv from "dotenv";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";
import { createApp } from "./app.js";
import { MonitorService } from "./monitoring/monitor.js";

// The workspace dev command runs the backend with `backend/` as its cwd,
// while the root dev command runs it from the repository root. Load both
// locations so local configuration behaves consistently in either mode.
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

const config = loadConfig();
const db = createDatabase(config.databasePath);
if (config.OWNER_CONTACT_URL) db.sqlite.prepare(`UPDATE site_settings SET contact_url=?,updated_at=datetime('now') WHERE id=1`).run(config.OWNER_CONTACT_URL);
const { app, logger, sync } = createApp(config, db);
const monitor = new MonitorService(db, config, logger);

async function syncCoolify() {
  const outcomes = await sync.syncAll();
  logger.info({ teams: outcomes.map((outcome) => ({ id: outcome.team.id, status: outcome.status, resources: outcome.resources, warnings: outcome.warnings.length })) }, "Coolify catalog synchronization completed");
}

const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, "API listening"));
monitor.start();
void syncCoolify();
const syncTimer = setInterval(() => void syncCoolify(), config.COOLIFY_SYNC_INTERVAL_MS);
syncTimer.unref();

function shutdown() {
  clearInterval(syncTimer);
  monitor.stop();
  server.close(() => { db.sqlite.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
