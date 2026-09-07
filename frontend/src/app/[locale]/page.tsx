import type { Locale } from "@izbri/contracts";
import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getInitialDashboard } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function LocalePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const initial = await getInitialDashboard(locale);
  return <Suspense fallback={<main className="admin-centered"><span className="loading-ring" /><p>{locale === "es" ? "Cargando proyectos…" : "Loading projects…"}</p></main>}><Dashboard locale={locale} initialProjects={initial.projects} site={initial.site} apiAvailable={initial.available} sampleData={initial.sample} /></Suspense>;
}
