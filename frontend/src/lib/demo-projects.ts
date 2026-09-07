import type { Locale, ProjectDetail, ProjectSummary } from "@izbri/contracts";

const daily = {
  online: [100, 100, 100, 100, 100, 100, 99.8, 100, 100, 100, 100, 100, 100, 100, 100, 100, 99.7, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
  degraded: [100, 100, 100, 98, 100, 100, 100, 100, 96, 100, 100, 100, 100, 100, 92, 100, 100, 100, 100, 100, 100, 89, 100, 100, 100, 100, 100, 100, 97, 96],
  offline: [100, 100, 100, 100, 100, 95, 100, 100, 100, 88, 100, 100, 100, 100, 75, 100, 100, 91, 100, 100, 100, 100, 100, 84, 100, 100, 100, 66, 42, 0],
};

const technology = (name: string) => ({ id: `demo-tech-${name.toLowerCase().replaceAll(".", "").replaceAll(" ", "-")}`, name, slug: name.toLowerCase().replaceAll(".", "").replaceAll(" ", "-") });

const localized = {
  en: [
    { title: "Atlas Inbox", summary: "A focused client workspace for turning scattered requests into clear next actions.", description: "Atlas Inbox brings messages, decisions, and delivery milestones into one calm workspace. This sample demonstrates how a healthy application appears in the expanded project view." },
    { title: "Canary Notes", summary: "Fast, local-first notes with shared collections and a distraction-free writing flow.", description: "Canary Notes is a bilingual, local-first knowledge space designed for quick capture and thoughtful organization. This sample uses a degraded state to exercise the dashboard's warning treatment." },
    { title: "Lumen API", summary: "A small service layer for media processing, search, and reliable background jobs.", description: "Lumen API represents a backend service with operational history. Its sample outage makes offline states, incident information, and response-time fallbacks visible before real monitoring data exists." },
  ],
  es: [
    { title: "Atlas Inbox", summary: "Un espacio de trabajo enfocado que convierte solicitudes dispersas en próximos pasos claros.", description: "Atlas Inbox reúne mensajes, decisiones e hitos de entrega en un espacio tranquilo. Este ejemplo muestra cómo aparece una aplicación saludable en la vista ampliada." },
    { title: "Canary Notes", summary: "Notas rápidas y locales con colecciones compartidas y una escritura sin distracciones.", description: "Canary Notes es un espacio de conocimiento bilingüe y local pensado para capturar y organizar ideas. Este ejemplo usa un estado degradado para mostrar el tratamiento visual de las alertas." },
    { title: "Lumen API", summary: "Una pequeña capa de servicios para medios, búsqueda y tareas en segundo plano fiables.", description: "Lumen API representa un servicio backend con historial operativo. Su caída de ejemplo permite ver estados fuera de línea, incidentes y alternativas de latencia antes de tener datos reales." },
  ],
} as const;

export function getDemoProjects(locale: Locale): ProjectSummary[] {
  const copy = localized[locale];
  return [
    makeSummary(0, copy[0], "application", ["Next.js", "TypeScript", "SQLite"], "online", 99.98, 46.2, 118, daily.online, true),
    makeSummary(1, copy[1], "application", ["React", "Express", "WebSockets"], "degraded", 98.72, 4.3, 384, daily.degraded, false, locale === "en" ? "Brief maintenance is planned while shared collections are upgraded." : "Hay un mantenimiento breve previsto mientras se actualizan las colecciones compartidas."),
    makeSummary(2, copy[2], "service", ["Node.js", "Docker", "PostgreSQL"], "offline", 96.45, null, null, daily.offline, false),
  ];
}

export function getDemoProjectDetail(slug: string, locale: Locale): ProjectDetail | null {
  const summary = getDemoProjects(locale).find((project) => project.slug === slug);
  if (!summary) return null;
  const index = Number(summary.id.at(-1));
  const descriptions = localized[locale];
  const uptime = index === 0
    ? { h24: 100, d7: 100, d30: 99.98, all: 99.96 }
    : index === 1
      ? { h24: 96.8, d7: 98.1, d30: 98.72, all: 98.9 }
      : { h24: 72.4, d7: 91.7, d30: 96.45, all: 97.6 };
  const values = index === 0 ? [122, 116, 121, 112, 119, 115, 118] : index === 1 ? [210, 248, 225, 310, 286, 342, 384] : [165, 170, 182, 194, 231, 410];
  return {
    ...summary,
    description: descriptions[index]?.description ?? "",
    gallery: [],
    uptime,
    latencySeries: values.map((value, point) => ({ at: new Date(Date.UTC(2026, 7, 16, point + 8)).toISOString(), value })),
    incidents: index === 2 ? [{ startedAt: "2026-08-16T13:12:00.000Z", endedAt: null, trigger: "HTTP_STATUS", statusCode: 503, recoveredStatusCode: null }] : index === 1 ? [{ startedAt: "2026-08-12T09:20:00.000Z", endedAt: "2026-08-12T09:29:00.000Z", trigger: "TimeoutError", statusCode: null, recoveredStatusCode: 200 }] : [],
  };
}

function makeSummary(index: number, copy: { title: string; summary: string }, resourceType: "application" | "service", names: string[], status: "online" | "degraded" | "offline", uptime30d: number, streakDays: number | null, latencyMs: number | null, history: number[], featured: boolean, maintenanceMessage: string | null = null): ProjectSummary {
  return {
    id: `demo-project-${index}`,
    slug: `demo-${["atlas-inbox", "canary-notes", "lumen-api"][index]}`,
    title: copy.title,
    summary: copy.summary,
    maintenanceMessage,
    operationalNoticeType: index === 1 ? "maintenance" : "none",
    resourceType,
    technologies: names.map(technology),
    liveUrl: "https://example.com",
    repositoryUrl: index === 0 ? "https://github.com" : null,
    caseStudyUrl: index === 1 ? "https://example.com" : null,
    cover: null,
    health: { status, uptime30d, streakStartedAt: streakDays == null ? null : "2026-07-01T00:00:00.000Z", streakDays, latencyMs, lastCheckedAt: "2026-08-16T14:30:00.000Z", daily: history, activeIncident: index === 2 ? { startedAt: "2026-08-16T13:12:00.000Z", trigger: "HTTP_STATUS", statusCode: 503 } : null },
    createdAt: new Date(Date.UTC(2026, 6, 12 + index)).toISOString(),
    featured,
    displayOrder: index,
    accentColor: (["lime", "cyan", "coral"] as const)[index] ?? "lime",
    coolify: {
      runtimeStatus: status === "offline" ? "exited" : "running",
      sourceType: resourceType === "service" ? "docker-compose" : index === 0 ? "nixpacks" : "dockerfile",
      branch: resourceType === "application" ? "main" : null,
      commitSha: resourceType === "application" ? ["a84d19c9f12b", "38bc0a2f7de1"][index] ?? null : null,
      resourceUpdatedAt: "2026-08-16T14:22:00.000Z",
      deploymentInProgress: index === 1,
      lastSuccessfulDeploymentAt: index === 2 ? null : "2026-08-16T14:18:00.000Z",
      syncedAt: "2026-08-16T14:30:00.000Z",
      sentinel: null,
    },
  };
}
