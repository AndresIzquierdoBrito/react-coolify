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
    return parsed.success ? applyPreviewInput(project, parsed.data, locale) : project;
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
    cover: project.cover ? { ...project.cover, alt: coverAlt || project.cover.alt } : null,
  };
}

function technologySlug(value: string) {
  return value.toLocaleLowerCase("en").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueTechnologies(projects: ProjectSummary[]) {
  return [...new Map(projects.flatMap((project) => project.technologies).map((technology) => [technology.slug, technology])).values()].sort((a, b) => a.name.localeCompare(b.name));
}
