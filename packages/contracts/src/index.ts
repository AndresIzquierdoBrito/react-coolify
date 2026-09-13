import { z } from "zod";

export const localeSchema = z.enum(["en", "es"]);
export type Locale = z.infer<typeof localeSchema>;

export const resourceTypeSchema = z.enum(["application", "service"]);
export const projectAccentSchema = z.enum([
  "lime",
  "chartreuse",
  "mint",
  "aqua",
  "cyan",
  "turquoise",
  "sky",
  "periwinkle",
  "yellow",
  "amber",
  "tangerine",
  "coral",
  "raspberry",
  "pink",
]);
export const projectHealthSchema = z.enum([
  "online",
  "degraded",
  "offline",
  "collecting",
  "unknown",
]);
export const projectTeamSchema = z.object({ id: z.string(), name: z.string() });
export const operationalNoticeTypeSchema = z.enum(["none", "maintenance", "restart", "update"]);
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");

export const technologySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const projectSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  maintenanceMessage: z.string().nullable(),
  operationalNoticeType: operationalNoticeTypeSchema,
  resourceType: resourceTypeSchema,
  technologies: z.array(technologySchema),
  liveUrl: z.string().url(),
  repositoryUrl: z.string().url().nullable(),
  caseStudyUrl: z.string().url().nullable(),
  cover: z
    .object({
      src: z.string(),
      srcSmall: z.string(),
      alt: z.string(),
    })
    .nullable(),
  health: z.object({
    status: projectHealthSchema,
    uptime30d: z.number().min(0).max(100).nullable(),
    uptimeStartDate: calendarDateSchema,
    measurementStartedAt: z.string().nullable(),
    assumedUptime: z.boolean(),
    streakStartedAt: z.string().nullable(),
    streakDays: z.number().nullable(),
    latencyMs: z.number().nullable(),
    lastCheckedAt: z.string().nullable(),
    daily: z.array(z.number().min(0).max(100).nullable()),
    activeIncident: z.object({
      startedAt: z.string(),
      trigger: z.string().nullable(),
      statusCode: z.number().nullable(),
    }).nullable(),
  }),
  createdAt: z.string(),
  featured: z.boolean(),
  displayOrder: z.number(),
  accentColor: projectAccentSchema,
  team: projectTeamSchema,
  coolify: z.object({
    runtimeStatus: z.string().nullable(),
    sourceType: z.string().nullable(),
    branch: z.string().nullable(),
    commitSha: z.string().nullable(),
    resourceUpdatedAt: z.string().nullable(),
    deploymentInProgress: z.boolean(),
    lastSuccessfulDeploymentAt: z.string().nullable(),
    syncedAt: z.string(),
    sentinel: z.object({
      enabled: z.boolean(),
      metricsEnabled: z.boolean(),
      refreshRateSeconds: z.number().nullable(),
      historyDays: z.number().nullable(),
      pushIntervalSeconds: z.number().nullable(),
      lastReportedAt: z.string().nullable(),
    }).nullable(),
  }),
});

export const projectDetailSchema = projectSummarySchema.extend({
  description: z.string(),
  gallery: z.array(z.object({
    id: z.string(),
    src: z.string(),
    alt: z.string(),
    mimeType: z.string(),
  })),
  uptime: z.object({
    h24: z.number().nullable(),
    d7: z.number().nullable(),
    d30: z.number().nullable(),
    all: z.number().nullable(),
  }),
  latencySeries: z.array(
    z.object({ at: z.string(), value: z.number() }),
  ),
  incidents: z.array(
    z.object({
      startedAt: z.string(),
      endedAt: z.string().nullable(),
      trigger: z.string().nullable(),
      statusCode: z.number().nullable(),
      recoveredStatusCode: z.number().nullable(),
    }),
  ),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type ResourceType = z.infer<typeof resourceTypeSchema>;
export type ProjectHealth = z.infer<typeof projectHealthSchema>;
export type ProjectAccent = z.infer<typeof projectAccentSchema>;

const optionalUrl = z.union([z.string().url(), z.literal("")]).optional();

export const projectInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(80),
  titleEn: z.string().trim().max(120),
  titleEs: z.string().trim().max(120),
  summaryEn: z.string().trim().max(280),
  summaryEs: z.string().trim().max(280),
  descriptionEn: z.string().trim().max(4000),
  descriptionEs: z.string().trim().max(4000),
  maintenanceMessageEn: z.string().trim().max(280),
  maintenanceMessageEs: z.string().trim().max(280),
  operationalNoticeType: operationalNoticeTypeSchema,
  liveUrl: z.string().url(),
  repositoryUrl: optionalUrl,
  caseStudyUrl: optionalUrl,
  technologyNames: z.array(z.string().trim().min(1).max(40)).max(16),
  featured: z.boolean(),
  published: z.boolean(),
  displayOrder: z.number().int().min(0),
  accentColor: projectAccentSchema,
  monitoringEnabled: z.boolean(),
  uptimeStartDate: calendarDateSchema,
  healthUrl: optionalUrl,
  healthMethod: z.enum(["GET", "HEAD"]),
  healthTimeoutMs: z.number().int().min(1000).max(30000),
  expectedStatusMin: z.number().int().min(100).max(599),
  expectedStatusMax: z.number().int().min(100).max(599),
  coverAltEn: z.string().trim().max(180),
  coverAltEs: z.string().trim().max(180),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const importProjectSchema = z.object({ liveUrl: z.string().url() }).and(z.union([
  z.object({ resourceId: z.string().min(1), resourceType: resourceTypeSchema.optional(), resourceUuid: z.string().min(1).optional(), teamId: z.string().min(1).optional() }),
  z.object({ resourceType: resourceTypeSchema, resourceUuid: z.string().min(1), teamId: z.string().min(1).optional(), resourceId: z.string().min(1).optional() }),
]));

export const coolifyTeamInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  apiUrl: z.string().url(),
  token: z.string().trim().min(1).optional(),
  enabled: z.boolean().default(true),
});
export const coolifyTeamUpdateSchema = coolifyTeamInputSchema.partial();

export const reorderProjectsSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
