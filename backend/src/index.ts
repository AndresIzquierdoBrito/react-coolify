import "dotenv/config";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";
import { createApp } from "./app.js";
import { MonitorService } from "./monitoring/monitor.js";
import { persistCoolifyResources, persistSentinelServers } from "./coolify/client.js";

const config = loadConfig();
const db = createDatabase(config.databasePath);
if (config.OWNER_CONTACT_URL) db.sqlite.prepare(`UPDATE site_settings SET contact_url=?,updated_at=datetime('now') WHERE id=1`).run(config.OWNER_CONTACT_URL);
const { app, logger, coolify } = createApp(config, db);
const monitor = new MonitorService(db, config, logger);

async function syncCoolify() {
  if (!coolify.configured) return;
  try {
    const { resources, warnings } = await coolify.listResources();
    persistCoolifyResources(db, resources);
    const sentinel = await coolify.listSentinelStatus();
    persistSentinelServers(db, sentinel.servers);
    logger.info({ count: resources.length, sentinelServers: sentinel.servers.length, warnings: [...warnings, ...sentinel.warnings] }, "Coolify catalog synchronized");
  } catch (error) { logger.warn({ error }, "Coolify synchronization failed"); }
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
