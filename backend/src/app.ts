import fs from "node:fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pino from "pino";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "./config.js";
import type { DatabaseContext } from "./db/index.js";
import { configurePassport, authMiddleware, createAuthRouter } from "./auth/index.js";
import { CoolifyClient } from "./coolify/client.js";
import { ProjectRepository } from "./projects/repository.js";
import { MediaService } from "./media/service.js";
import { createAdminRouter, createPublicRouter, errorHandler, requestId } from "./http/routes.js";

export function createApp(config: AppConfig, db: DatabaseContext) {
  const app = express();
  const logger = pino({ level: config.LOG_LEVEL });
  const coolify = new CoolifyClient(config);
  const projects = new ProjectRepository(db, config.MONITOR_INTERVAL_MS);
  const media = new MediaService(db, config);
  configurePassport(config);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(pinoHttp({ logger }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cors({ origin: config.APP_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  for (const middleware of authMiddleware(config, db)) app.use(middleware);
  app.use("/media", express.static(config.uploadsPath, { fallthrough: false, immutable: true, maxAge: "1y", dotfiles: "deny" }));
  app.get("/healthz", (_request, response) => response.json({ ok: true }));
  app.get("/readyz", (_request, response) => {
    try { db.sqlite.prepare("SELECT 1").get(); fs.accessSync(config.uploadsPath, fs.constants.W_OK); response.json({ ok: true }); }
    catch { response.status(503).json({ ok: false }); }
  });
  app.use("/api/v1/auth", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }), createAuthRouter(config));
  app.use("/api/v1", rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false }), createPublicRouter(projects));
  app.use("/api/v1/admin", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }), createAdminRouter({ db, projects, coolify, media }));
  app.use(errorHandler);
  return { app, logger, coolify, projects };
}
