import { projectInputSchema, type Locale, type ProjectDetail, type ProjectInput, type ProjectSummary } from "@izbri/contracts";
import { getDemoProjectDetail, getDemoProjects } from "./demo-projects";

const internalApi = process.env.API_INTERNAL_URL ?? "http://localhost:3001";
export interface SiteData { title: string; githubUrl: string | null; contactUrl: string | null; technologies: { id: string; name: string; slug: string }[] }

export async function getInitialDashboard(locale: Locale): Promise<{ projects: ProjectSummary[]; site: SiteData; available: boolean; sample: boolean }> {
  try {
    const [projectResponse, siteResponse] = await Promise.all([
      fetch(`${internalApi}/api/v1/projects?locale=${locale}`, { cache: "no-store" }),
      fetch(`${internalApi}/api/v1/site?locale=${locale}`, { next: { revalidate: 300 } }),
    ]);
    if (!projectResponse.ok || !siteResponse.ok) throw new Error("API unavailable");
    const [{ projects }, site] = await Promise.all([projectResponse.json() as Promise<{ projects: ProjectSummary[] }>, siteResponse.json() as Promise<SiteData>]);
    if (projects.length > 0) return { projects, site, available: true, sample: false };
    const samples = getDemoProjects(locale);
    return { projects: samples, site: { ...site, technologies: uniqueTechnologies(samples) }, available: true, sample: true };
  } catch {
    const samples = getDemoProjects(locale);
    return { projects: samples, site: { title: "Izbri Projects", githubUrl: null, contactUrl: null, technologies: uniqueTechnologies(samples) }, available: false, sample: true };
  }
}

export async function fetchProjectDetail(slug: string, locale: Locale, signal?: AbortSignal, previewId?: string | null): Promise<ProjectDetail> {
  const sample = getDemoProjectDetail(slug, locale);
  if (sample && !previewId) return sample;
  const url = previewId ? `/api/v1/admin/projects/${encodeURIComponent(previewId)}/preview?locale=${locale}` : `/api/v1/projects/${encodeURIComponent(slug)}?locale=${locale}`;
  const response = await fetch(url, { signal, credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Project unavailable");
  const project = (await response.json() as { project: ProjectDetail }).project;
  if (!previewId || typeof window === "undefined") return project;
  const stored = window.localStorage.getItem(previewStorageKey(previewId));
  if (!stored) return project;
  try {
    const parsed = projectInputSchema.safeParse(JSON.parse(stored));
    if (!parsed.success) return project;
    const preview = applyPreviewInput(project, parsed.data, locale);
    const catalogResponse = await fetch("/api/v1/admin/coolify/resources", { credentials: "include", cache: "no-store" });
    if (!catalogResponse.ok) return preview;
    const catalog = (await catalogResponse.json() as { resources?: { id: string; name: string; resourceType: "application" | "service"; status: string | null; sourceType: string | null; sourceBranch?: string | null; commitSha?: string | null; resourceUpdatedAt?: string | null; deploymentInProgress?: boolean; lastSuccessfulDeploymentAt?: string | null; syncedAt: string }[] }).resources ?? [];
    const existing = new Set(preview.resources.map((resource) => resource.resourceId));
    const added = parsed.data.resources?.filter((resource) => !existing.has(resource.resourceId)).flatMap((resource) => {
      const source = catalog.find((item) => item.id === resource.resourceId);
      if (!source) return [];
      const health = resource.uptimeEnabled ? emptyPreviewHealth(resource.uptimeStartDate) : null;
      return [{ id: `preview-${source.id}`, resourceId: source.id, label: locale === "es" ? resource.labelEs : resource.labelEn, resourceName: source.name, resourceType: source.resourceType, uptimeEnabled: resource.uptimeEnabled, coolify: { runtimeStatus: source.status, sourceType: source.sourceType, branch: source.sourceBranch ?? null, commitSha: source.commitSha ?? null, resourceUpdatedAt: source.resourceUpdatedAt ?? null, deploymentInProgress: Boolean(source.deploymentInProgress), lastSuccessfulDeploymentAt: source.lastSuccessfulDeploymentAt ?? null, syncedAt: source.syncedAt, sentinel: null }, health, uptime: resource.uptimeEnabled ? { h24: null, d7: null, d30: null, all: null } : null, latencySeries: [], incidents: [] }];
    }) ?? [];
    const byResourceId = new Map([...preview.resources, ...added].map((resource) => [resource.resourceId, resource]));
    return { ...preview, resources: parsed.data.resources.flatMap((resource) => { const item = byResourceId.get(resource.resourceId); return item ? [item] : []; }) };
  } catch {
    return project;
  }
}

export async function fetchPublicProjects(locale: Locale, signal?: AbortSignal): Promise<ProjectSummary[]> {
  const response = await fetch(`/api/v1/projects?locale=${locale}`, { signal, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Project feed unavailable");
  return (await response.json() as { projects: ProjectSummary[] }).projects;
}

export function previewStorageKey(projectId: string) { return `izbri-project-preview:${projectId}`; }

export function applyPreviewInput(project: ProjectDetail, input: ProjectInput, locale: Locale): ProjectDetail {
  const maintenanceMessage = input.operationalNoticeType === "none" ? null : (locale === "es" ? input.maintenanceMessageEs : input.maintenanceMessageEn) || null;
  const coverAlt = locale === "es" ? input.coverAltEs : input.coverAltEn;
  const resourceInputs = input.resources ?? [];
  return {
    ...project,
    slug: input.slug,
    title: locale === "es" ? input.titleEs : input.titleEn,
    summary: locale === "es" ? input.summaryEs : input.summaryEn,
    description: locale === "es" ? input.descriptionEs : input.descriptionEn,
    maintenanceMessage,
    operationalNoticeType: input.operationalNoticeType,
    liveUrl: input.liveUrl,
    repositoryUrl: input.repositoryUrl || null,
    caseStudyUrl: input.caseStudyUrl || null,
    technologies: input.technologyNames.map((name, index) => ({ id: `preview-technology-${index}`, name, slug: technologySlug(name) })),
    featured: input.featured,
    displayOrder: input.displayOrder,
    accentColor: input.accentColor,
    health: { ...project.health, uptimeStartDate: input.uptimeStartDate },
    cover: project.cover ? { ...project.cover, alt: coverAlt || project.cover.alt } : null,
    resources: resourceInputs.flatMap((input) => {
      const resource = project.resources.find((item) => item.resourceId === input.resourceId);
      if (!resource) return [];
      const override = resourceInputs.find((item) => item.resourceId === resource.resourceId);
      if (!override) return [];
      return [{ ...resource, label: locale === "es" ? override.labelEs : override.labelEn, uptimeEnabled: override.uptimeEnabled, health: override.uptimeEnabled ? resource.health ?? emptyPreviewHealth(override.uptimeStartDate) : null, uptime: override.uptimeEnabled ? resource.uptime ?? { h24: null, d7: null, d30: null, all: null } : null, latencySeries: override.uptimeEnabled ? resource.latencySeries : [], incidents: override.uptimeEnabled ? resource.incidents : [] }];
    }),
  };
}

function emptyPreviewHealth(uptimeStartDate: string) {
  return { status: "collecting" as const, uptime30d: null, uptimeStartDate, measurementStartedAt: null, assumedUptime: true, streakStartedAt: null, streakDays: null, latencyMs: null, lastCheckedAt: null, daily: Array.from({ length: 30 }, () => null), activeIncident: null };
}

function technologySlug(value: string) {
  return value.toLocaleLowerCase("en").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueTechnologies(projects: ProjectSummary[]) {
  return [...new Map(projects.flatMap((project) => project.technologies).map((technology) => [technology.slug, technology])).values()].sort((a, b) => a.name.localeCompare(b.name));
}
