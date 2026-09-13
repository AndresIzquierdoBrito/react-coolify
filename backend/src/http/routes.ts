import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { importProjectSchema, localeSchema, projectInputSchema, reorderProjectsSchema } from "@izbri/contracts";
import type { DatabaseContext } from "../db/index.js";
import type { CoolifyClient } from "../coolify/client.js";
import { CoolifySyncError, persistCoolifyResources, persistSentinelServers } from "../coolify/client.js";
import { requireAuth, requireCsrf } from "../auth/index.js";
import { ProjectValidationError, type ProjectRepository } from "../projects/repository.js";
import type { MediaService } from "../media/service.js";

export function createPublicRouter(projects: ProjectRepository) {
  const router = Router();
  router.get("/projects", (request, response) => {
    const locale = localeSchema.catch("en").parse(request.query.locale);
    response.set("Cache-Control", "public, max-age=0, must-revalidate");
    response.json({ projects: projects.listPublic(locale, stringFilters(request)) });
  });
  router.get("/projects/:slug", (request, response) => {
    const locale = localeSchema.catch("en").parse(request.query.locale);
    const project = projects.getPublicBySlug(request.params.slug, locale);
    if (!project) return notFound(response, "PROJECT_NOT_FOUND", "Project not found.");
    response.set("Cache-Control", "public, max-age=0, must-revalidate").json({ project });
  });
  router.get("/projects/:slug/metrics", (request, response) => {
    const locale = localeSchema.catch("en").parse(request.query.locale);
    const project = projects.getPublicBySlug(request.params.slug, locale);
    if (!project) return notFound(response, "PROJECT_NOT_FOUND", "Project not found.");
    const range = ["24h", "7d", "30d", "all"].includes(String(request.query.range)) ? String(request.query.range) : "30d";
    response.json({ range, uptime: project.uptime, health: project.health, latencySeries: project.latencySeries, incidents: project.incidents });
  });
  router.get("/site", (request, response) => {
    const locale = localeSchema.catch("en").parse(request.query.locale);
    response.set("Cache-Control", "public, max-age=300").json(projects.site(locale));
  });
  return router;
}

export function createAdminRouter(dependencies: { db: DatabaseContext; projects: ProjectRepository; coolify: CoolifyClient; media: MediaService }) {
  const { db, projects, coolify, media } = dependencies;
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  router.use(requireAuth);
  router.get("/projects", (_request, response) => response.json({ projects: projects.getAdminProjects() }));
  router.get("/projects/:id/preview", (request, response) => {
    const locale = localeSchema.catch("en").parse(request.query.locale);
    const project = projects.getAdminPreview(String(request.params.id), locale);
    if (!project) return notFound(response, "PROJECT_NOT_FOUND", "Project not found.");
    response.set("Cache-Control", "private, no-store").json({ project });
  });
  router.get("/coolify/resources", (_request, response) => response.json({ configured: coolify.configured, resources: catalog(db), sentinel: sentinelSummary(db) }));
  router.post("/coolify/sync", requireCsrf, asyncHandler(async (_request, response) => {
    const { resources, warnings } = await coolify.listResources();
    persistCoolifyResources(db, resources);
    const sentinel = await coolify.listSentinelStatus();
    persistSentinelServers(db, sentinel.servers);
    response.json({ synced: resources.length, sentinelServers: sentinel.servers.length, sentinel: sentinelSummary(db), resources: catalog(db), warnings: [...warnings, ...sentinel.warnings] });
  }));
  router.post("/projects/import", requireCsrf, (request, response) => {
    const input = importProjectSchema.parse(request.body);
    const id = projects.import(input.resourceType, input.resourceUuid, input.liveUrl);
    response.status(201).json({ id });
  });
  router.put("/projects/reorder", requireCsrf, (request, response) => {
    const input = reorderProjectsSchema.parse(request.body);
    projects.reorder(input.ids);
    response.status(204).end();
  });
  router.put("/projects/:id", requireCsrf, (request, response) => {
    const input = projectInputSchema.parse(request.body);
    const id = String(request.params.id);
    projects.update(id, input);
    response.json({ project: projects.getAdminProjects().find((project) => (project as Record<string, unknown>).id === id) });
  });
  router.post("/projects/:id/cover", requireCsrf, upload.single("cover"), asyncHandler(async (request, response) => {
    if (!request.file) return response.status(400).json({ error: { code: "COVER_REQUIRED", message: "Choose an image to upload.", requestId: response.locals.requestId } });
    const result = await media.replaceCover(String(request.params.id), request.file.buffer, String(request.body.altEn ?? ""), String(request.body.altEs ?? ""));
    response.status(201).json(result);
  }));
  router.post("/projects/:id/gallery", requireCsrf, upload.single("image"), asyncHandler(async (request, response) => {
    if (!request.file) return response.status(400).json({ error: { code: "IMAGE_REQUIRED", message: "Choose an image or GIF to upload.", requestId: response.locals.requestId } });
    const result = await media.addGalleryImage(String(request.params.id), request.file.buffer, String(request.body.altEn ?? ""), String(request.body.altEs ?? ""));
    response.status(201).json(result);
  }));
  router.delete("/projects/:id/gallery/:imageId", requireCsrf, (request, response) => {
    media.deleteGalleryImage(String(request.params.id), String(request.params.imageId));
    response.status(204).end();
  });
  router.put("/projects/:id/gallery/reorder", requireCsrf, (request, response) => {
    const input = reorderProjectsSchema.parse(request.body);
    media.reorderGallery(String(request.params.id), input.ids);
    response.status(204).end();
  });
  return router;
}

function catalog(db: DatabaseContext) {
  return db.sqlite.prepare(`
    SELECT cr.id,cr.resource_type AS resourceType,cr.resource_uuid AS resourceUuid,cr.name,cr.description,
      cr.status,cr.source_type AS sourceType,cr.suggested_urls_json AS suggestedUrlsJson,cr.synced_at AS syncedAt,
      CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS imported
    FROM coolify_resources cr LEFT JOIN projects p ON p.coolify_resource_id=cr.id
    ORDER BY cr.resource_type,cr.name
  `).all().map((row) => { const item = row as Record<string, unknown>; return { ...item, imported: Boolean(item.imported), suggestedUrls: JSON.parse(String(item.suggestedUrlsJson)), suggestedUrlsJson: undefined }; });
}

function sentinelSummary(db: DatabaseContext) {
  const row = db.sqlite.prepare(`SELECT COUNT(*) AS server_count,COALESCE(SUM(enabled),0) AS enabled_count,COALESCE(SUM(metrics_enabled),0) AS metrics_enabled_count,MAX(last_reported_at) AS last_reported_at FROM sentinel_servers`).get() as Record<string, unknown>;
  return { serverCount: Number(row.server_count), enabledCount: Number(row.enabled_count), metricsEnabledCount: Number(row.metrics_enabled_count), lastReportedAt: row.last_reported_at ? String(row.last_reported_at) : null };
}

function stringFilters(request: Request) {
  const get = (name: string) => typeof request.query[name] === "string" ? request.query[name] as string : undefined;
  return { status: get("status"), technology: get("technology"), resourceType: get("resourceType"), sort: get("sort") };
}

function notFound(response: Response, code: string, message: string) { return response.status(404).json({ error: { code, message, requestId: response.locals.requestId } }); }
function asyncHandler(handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) { return (request: Request, response: Response, next: NextFunction) => { void handler(request, response, next).catch(next); }; }

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof CoolifySyncError) return response.status(error.status).json({ error: { code: error.code, message: error.message, requestId: response.locals.requestId, details: error.warnings } });
  const isZod = error && typeof error === "object" && "issues" in error;
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const known = ["RESOURCE_NOT_FOUND", "RESOURCE_ALREADY_IMPORTED", "INVALID_STATUS_RANGE", "INVALID_UPTIME_START_DATE", "INCOMPLETE_TRANSLATIONS", "INCOMPLETE_MAINTENANCE_TRANSLATIONS", "COVER_REQUIRED", "PROJECT_NOT_FOUND", "UNSUPPORTED_IMAGE", "GALLERY_ALT_REQUIRED", "GALLERY_LIMIT", "GALLERY_IMAGE_NOT_FOUND", "INVALID_GALLERY_ORDER"].includes(message);
  const status = isZod ? 400 : known ? 422 : 500;
  const projectDetails = error instanceof ProjectValidationError ? error.fields.map((field) => ({ path: [field], message: "Required before publishing." })) : undefined;
  response.status(status).json({ error: { code: isZod ? "VALIDATION_ERROR" : known ? message : "INTERNAL_ERROR", message: isZod ? "The submitted data is invalid." : known ? humanize(message) : "An unexpected error occurred.", requestId: response.locals.requestId, details: isZod ? (error as { issues: unknown }).issues : projectDetails } });
}

function humanize(code: string) { return code.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) + "."; }
export function requestId(_request: Request, response: Response, next: NextFunction) { response.locals.requestId = randomUUID(); response.set("X-Request-Id", response.locals.requestId); next(); }
