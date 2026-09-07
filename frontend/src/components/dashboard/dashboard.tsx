"use client";

import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import * as Popover from "@radix-ui/react-popover";
import { ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Filter, Github, House, Info, Linkedin, MessageCircleWarning, Moon, Rocket, RotateCw, SlidersHorizontal, Sun, TriangleAlert, Wrench, X } from "lucide-react";
import { ES, GB } from "country-flag-icons/react/3x2";
import gsap from "gsap";
import type { Locale, ProjectDetail, ProjectHealth, ProjectSummary } from "@izbri/contracts";
import type { SiteData } from "@/lib/api";
import { fetchProjectDetail, fetchPublicProjects } from "@/lib/api";
import { getMessages } from "@/lib/messages";
import { projectAccentHex } from "@/lib/project-accents";
import { getDemoProjects } from "@/lib/demo-projects";

interface Props { locale: Locale; initialProjects: ProjectSummary[]; site: SiteData; apiAvailable: boolean; sampleData: boolean }

export function Dashboard({ locale, initialProjects, site, apiAvailable, sampleData }: Props) {
  const t = getMessages(locale);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [projects, setProjects] = useState(initialProjects);
  const [showingSamples, setShowingSamples] = useState(sampleData);
  const detailRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const selectedSlug = searchParams.get("project");
  const previewId = searchParams.get("preview");
  const status = searchParams.get("status") ?? "";
  const technology = searchParams.get("technology") ?? "";
  const resourceType = searchParams.get("resourceType") ?? "";
  const sort = searchParams.get("sort") ?? "curated";

  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    if (!selectedSlug) return;
    const controller = new AbortController();
    void fetchProjectDetail(selectedSlug, locale, controller.signal, previewId).then((project) => { setDetail(project); setDetailError(false); setDetailSlug(selectedSlug); }).catch((error) => { if (error instanceof Error && error.name !== "AbortError") { setDetailError(true); setDetailSlug(selectedSlug); } });
    return () => controller.abort();
  }, [selectedSlug, locale, previewId]);
  useEffect(() => { if (selectedSlug && detailRef.current) detailRef.current.focus(); }, [selectedSlug, detail]);
  useEffect(() => {
    if (previewId) return;
    let active = true;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await fetchPublicProjects(locale, controller.signal);
        if (!active) return;
        setProjects(next.length ? next : getDemoProjects(locale));
        setShowingSamples(next.length === 0);
        if (selectedSlug) {
          const selected = await fetchProjectDetail(selectedSlug, locale, controller.signal);
          if (active) { setDetail(selected); setDetailSlug(selectedSlug); setDetailError(false); }
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") return;
      }
    };
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; controller?.abort(); window.clearInterval(interval); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisibility); };
  }, [locale, previewId, selectedSlug]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape" && selectedSlug) closeDetail(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !listRef.current) return;
    const context = gsap.context(() => {
      gsap.fromTo(".project-card", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: .48, stagger: .07, ease: "power2.out", clearProps: "opacity,visibility,transform" });
    }, listRef);
    return () => context.revert();
  }, []);
  useLayoutEffect(() => {
    const panel = detailRef.current;
    if (!selectedSlug || !panel || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const mobile = window.matchMedia("(max-width: 860px)").matches;
    const tween = gsap.fromTo(panel, { autoAlpha: 0, x: mobile ? 0 : 38, y: mobile ? 28 : 0, scale: .985 }, { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: .46, ease: "power3.out", clearProps: "opacity,visibility,transform" });
    const backdrop = document.querySelector<HTMLElement>(".detail-backdrop");
    const backdropTween = backdrop ? gsap.fromTo(backdrop, { autoAlpha: 0 }, { autoAlpha: 1, duration: .28, ease: "power1.out", clearProps: "opacity,visibility" }) : null;
    return () => { tween.kill(); backdropTween?.kill(); };
  }, [selectedSlug]);
  useLayoutEffect(() => {
    if (!detailSlug || detailSlug !== selectedSlug || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const content = detailRef.current?.querySelector<HTMLElement>(".panel-content");
    if (!content) return;
    const tween = gsap.fromTo(content, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: .38, ease: "power2.out", clearProps: "opacity,visibility,transform" });
    return () => { tween.kill(); };
  }, [detailSlug, selectedSlug]);

  const displayedProjects = useMemo(() => previewId && detail?.id === previewId ? [detail, ...projects.filter((project) => project.id !== detail.id)] : projects, [detail, projects, previewId]);
  const filtered = useMemo(() => {
    const items = displayedProjects.filter((project) => (!status || project.health.status === status) && (!technology || project.technologies.some((item) => item.slug === technology)) && (!resourceType || project.resourceType === resourceType));
    return items.sort((a, b) => sort === "name" ? a.title.localeCompare(b.title, locale) : sort === "uptime" ? (b.health.uptime30d ?? -1) - (a.health.uptime30d ?? -1) : sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : Number(b.featured) - Number(a.featured) || a.displayOrder - b.displayOrder);
  }, [displayedProjects, locale, resourceType, sort, status, technology]);

  function setQuery(name: string, value?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value); else params.delete(name);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }
  function openDetail(slug: string, trigger: HTMLElement) { previousFocus.current = trigger; const params = new URLSearchParams(searchParams.toString()); params.set("project", slug); if (previewId && slug !== selectedSlug) params.delete("preview"); router.push(`${pathname}?${params}`, { scroll: false }); }
  function closeDetail() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("project");
    params.delete("preview");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
    window.setTimeout(() => previousFocus.current?.focus(), 0);
  }
  function clearFilters() { const params = new URLSearchParams(searchParams.toString()); for (const name of ["status", "technology", "resourceType"]) params.delete(name); router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }); }
  function switchLocale() { const next = locale === "en" ? "es" : "en"; document.cookie = `izbri.locale=${next};path=/;max-age=31536000;samesite=lax`; router.push(`/${next}${searchParams.size ? `?${searchParams}` : ""}`); }
  const filterCount = [status, technology, resourceType].filter(Boolean).length;
  const LanguageFlag = locale === "en" ? GB : ES;

  return (
    <div className="site-shell">
      {previewId && <div className="preview-mode-bar" role="status"><span>{t.previewOnly}</span><Link href={`/admin?project=${encodeURIComponent(previewId)}`}>{t.returnToEditor}<ArrowUpRight size={16} /></Link></div>}
      <header className="site-header">
        <div className="brand-block">
          <h1>{t.title}<span className="lime-mark">.</span></h1>
          <p>{t.subtitle}</p>
        </div>
        <nav className="toolbar" aria-label={locale === "en" ? "Project controls" : "Controles de proyectos"}>
          <Popover.Root>
            <Popover.Trigger className="round-control" aria-label={t.filter}><Filter size={18} /><span className="control-label">{t.filter}</span>{filterCount > 0 && <span className="control-count">{filterCount}</span>}</Popover.Trigger>
            <Popover.Portal><Popover.Content className="control-popover" align="end" sideOffset={10}>
              <FilterField label={t.status} value={status} onChange={(value) => setQuery("status", value)} options={["online", "degraded", "offline", "collecting", "unknown"].map((value) => ({ value, label: statusText(value as ProjectHealth, t) }))} all={t.all} />
              <FilterField label={t.technology} value={technology} onChange={(value) => setQuery("technology", value)} options={site.technologies.map((item) => ({ value: item.slug, label: item.name }))} all={t.all} />
              <FilterField label={t.resource} value={resourceType} onChange={(value) => setQuery("resourceType", value)} options={[{ value: "application", label: t.application }, { value: "service", label: t.service }]} all={t.all} />
              {filterCount > 0 && <button className="text-button" onClick={clearFilters}>{t.clear}</button>}
              <Popover.Arrow className="popover-arrow" /></Popover.Content></Popover.Portal>
          </Popover.Root>
          <Popover.Root>
            <Popover.Trigger className="round-control" aria-label={t.sort}><SlidersHorizontal size={18} /><span className="control-label">{t.sort}</span></Popover.Trigger>
            <Popover.Portal><Popover.Content className="control-popover sort-popover" align="start" collisionPadding={14} sideOffset={10}>
              {[{ value: "curated", label: t.curated }, { value: "name", label: t.name }, { value: "uptime", label: t.uptime }, { value: "newest", label: t.newest }].map((option) => <button key={option.value} className="menu-option" onClick={() => setQuery("sort", option.value === "curated" ? undefined : option.value)}><span>{option.label}</span>{sort === option.value && <Check size={16} />}</button>)}
              <Popover.Arrow className="popover-arrow" /></Popover.Content></Popover.Portal>
          </Popover.Root>
          <button className="round-control icon-only language-control" onClick={switchLocale} aria-label={t.language}><LanguageFlag className="language-flag" aria-hidden="true" /></button>
          <button className="round-control icon-only" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label={t.theme}>{mounted && resolvedTheme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
        </nav>
      </header>

      <main className={`dashboard-layout ${selectedSlug ? "has-selection" : ""}`}>
        <section ref={listRef} className="project-list" aria-label={locale === "en" ? "Projects" : "Proyectos"}>
          {!apiAvailable && <div className="notice-card"><span>!</span><p>{t.unavailable}</p></div>}
          {showingSamples && <div className="notice-card sample-notice"><span>i</span><p>{t.sampleData}</p></div>}
          {apiAvailable && displayedProjects.length === 0 && <div className="empty-state"><div className="empty-orbit" /><h2>{t.emptyLead}</h2></div>}
          {displayedProjects.length > 0 && filtered.length === 0 && <div className="empty-state"><div className="empty-orbit" /><h2>{t.empty}</h2><button className="primary-button" onClick={() => router.replace(pathname)}>{t.clear}</button></div>}
          {filtered.map((project) => <ProjectCard key={project.id} project={project} selected={project.slug === selectedSlug} locale={locale} contactUrl={site.contactUrl} t={t} onOpen={openDetail} />)}
        </section>
        {selectedSlug && <ProjectPanel ref={detailRef} project={detailSlug === selectedSlug ? detail : null} error={detailSlug === selectedSlug && detailError} locale={locale} contactUrl={site.contactUrl} t={t} onClose={closeDetail} />}
      </main>
      <footer className="site-footer"><a className="footer-brand" href="https://izbri.com" target="_blank" rel="noreferrer" aria-label="izbri.com"><strong>izbri.com™</strong><span>© {new Date().getFullYear()}</span></a><span className="footer-note">{t.footer}</span><span className="footer-line" /><nav className="footer-links" aria-label={locale === "en" ? "Izbri links" : "Enlaces de Izbri"}><a href="https://izbri.com" target="_blank" rel="noreferrer" aria-label={locale === "en" ? "Main website" : "Web principal"} title="izbri.com"><House size={18} /></a><a href="https://www.linkedin.com/in/andresizbri" target="_blank" rel="noreferrer" aria-label="LinkedIn" title="LinkedIn"><Linkedin size={18} /></a><a href={site.githubUrl ?? "https://github.com/AndresIzquierdoBrito"} target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub"><Github size={18} /></a></nav></footer>
    </div>
  );
}

function FilterField({ label, value, onChange, options, all }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; all: string }) {
  return <label className="filter-field"><span>{label}</span><span className="select-wrap"><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">{all}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} /></span></label>;
}

function ProjectCard({ project, selected, locale, contactUrl, t, onOpen }: { project: ProjectSummary; selected: boolean; locale: Locale; contactUrl: string | null; t: ReturnType<typeof getMessages>; onOpen: (slug: string, trigger: HTMLElement) => void }) {
  return <article className={`project-card ${selected ? "is-selected" : ""}`} style={accentStyle(project.accentColor)}>
    <OperationalBanner project={project} locale={locale} contactUrl={contactUrl} t={t} />
    <button className="card-open" type="button" aria-label={`${t.viewDetails}: ${project.title}`} aria-pressed={selected} onClick={(event) => onOpen(project.slug, event.currentTarget)} />
    <div className="project-identity"><div className="card-topline"><div className="card-labels"><span className="resource-pill">{project.resourceType === "service" ? t.service : t.application}</span>{project.coolify.sourceType && <span className="source-pill">{project.coolify.sourceType}</span>}{project.coolify.deploymentInProgress && <span className="deployment-pill"><Rocket size={12} />{t.deploying}</span>}</div>{project.featured && <span className="featured-star" aria-label="Featured">✦</span>}</div><h2>{project.title}</h2><p>{project.summary}</p>{project.coolify.lastSuccessfulDeploymentAt && <span className="last-deployment"><Rocket size={13} />{t.lastDeployed}: {formatRelativeTime(project.coolify.lastSuccessfulDeploymentAt, locale)}</span>}<div className="stack-block"><span>{t.stack}</span><div className="tech-list">{project.technologies.map((tech) => <span key={tech.id}>{tech.name}</span>)}</div></div></div>
    <div className="project-metrics"><StatusPill status={project.health.status} t={t} /><div className="metric-main"><strong>{formatPercent(project.health.uptime30d, t.noHistory)}</strong><span>{t.uptime30}</span></div><UptimeBars values={project.health.daily} label={t.uptime30} /><div className="metric-row"><span>{project.health.streakDays == null ? "—" : project.health.streakDays.toFixed(project.health.streakDays < 10 ? 1 : 0)} {t.daysRunning}</span><span>{project.health.latencyMs == null ? "—" : `${project.health.latencyMs}ms`} {t.response}</span></div></div>
    <div className="project-art">{project.cover ? <img src={project.cover.srcSmall} alt={project.cover.alt} loading="lazy" /> : <PlaceholderArt seed={project.slug} />}<a className="art-action" href={project.liveUrl} target="_blank" rel="noreferrer" aria-label={`${t.openApp}: ${project.title}`}><ArrowUpRight size={18} /></a></div>
    <a className="card-report-action" href={reportUrl(contactUrl, project, locale)} target="_blank" rel="noreferrer" aria-label={`${t.reportProblem}: ${project.title}`} title={t.reportProblem}><MessageCircleWarning size={17} /></a>
    <a className="card-live-compact" href={project.liveUrl} target="_blank" rel="noreferrer" aria-label={`${t.openApp}: ${project.title}`}><ArrowUpRight size={18} /></a>
  </article>;
}

interface ProjectPanelProps { project: ProjectDetail | null; error: boolean; locale: Locale; contactUrl: string | null; t: ReturnType<typeof getMessages>; onClose: () => void }

const ProjectPanel = forwardRef<HTMLElement, ProjectPanelProps>(function ProjectPanel({ project, error, locale, contactUrl, t, onClose }, ref) {
  return <><button className="detail-backdrop" aria-label={t.close} onClick={onClose} /><aside ref={ref} className="project-panel" style={project ? accentStyle(project.accentColor) : undefined} tabIndex={-1} role="dialog" aria-modal="true" aria-label={project?.title ?? t.overview} onKeyDown={(event) => trapFocus(event)}>
    <button className="panel-close" aria-label={t.close} onClick={onClose}><X size={26} strokeWidth={3.25} /></button>
    {error ? <div className="panel-loading"><p>{t.unavailable}</p></div> : !project ? <div className="panel-loading"><span className="loading-ring" /><p>{locale === "en" ? "Loading the full story…" : "Cargando todos los detalles…"}</p></div> : <div className="panel-content" key={project.id}>
      <OperationalBanner project={project} locale={locale} contactUrl={contactUrl} t={t} panel />
      <div className="panel-heading"><span className="resource-pill">{project.resourceType === "service" ? t.service : t.application}</span><StatusPill status={project.health.status} t={t} /><h2>{project.title}</h2><div className="tech-list">{project.technologies.map((tech) => <span key={tech.id}>{tech.name}</span>)}</div></div>
      <section className="panel-section"><h3>{t.overview}</h3><p>{project.description}</p><div className="deployment-meta">{project.coolify.deploymentInProgress && <MetaFact label={t.deploying} value={t.ongoing} />}{project.coolify.lastSuccessfulDeploymentAt && <MetaFact label={t.lastDeployed} value={new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(project.coolify.lastSuccessfulDeploymentAt))} />}{project.coolify.sourceType && <MetaFact label={t.build} value={project.coolify.sourceType} />}{project.coolify.branch && <MetaFact label={t.branch} value={project.coolify.branch} />}{project.coolify.commitSha && <MetaFact label={t.commit} value={project.coolify.commitSha} mono />}{project.coolify.runtimeStatus && <MetaFact label={t.coolifyState} value={humanizeMachine(project.coolify.runtimeStatus)} />}<MetaFact label={t.lastSynchronized} value={new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(project.coolify.syncedAt))} />{project.coolify.sentinel && <MetaFact label={t.sentinel} value={project.coolify.sentinel.metricsEnabled ? t.sentinelMetrics : project.coolify.sentinel.enabled ? t.sentinelAgent : t.sentinelOff} />}{project.coolify.sentinel?.lastReportedAt && <MetaFact label={t.sentinelPulse} value={new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(project.coolify.sentinel.lastReportedAt))} />}</div></section>
      <section className="panel-section"><h3>{t.reliability}</h3>{project.health.status === "collecting" && <p className="collecting-explainer">{t.collectingExplanation}</p>}<div className="stat-grid">{[[t.period24h, project.uptime.h24], [t.period7d, project.uptime.d7], [t.period30d, project.uptime.d30], [t.allTime, project.uptime.all]].map(([label, value]) => <div className="stat-cell" key={String(label)}><span>{label}</span><strong>{formatPercent(value as number | null, "—")}</strong></div>)}</div><UptimeBars values={project.health.daily} label={t.uptime30} large /><LatencyChart values={project.latencySeries.map((point) => point.value)} label={t.latency} /><div className="detail-metrics"><p><span>{t.currentStreak}</span><strong>{project.health.streakDays == null ? "—" : `${project.health.streakDays.toFixed(1)} ${t.daysRunning}`}</strong></p><p><span>{t.latency}</span><strong>{project.health.latencyMs == null ? "—" : `${project.health.latencyMs} ms`}</strong></p><p><span>{t.lastCheck}</span><strong>{project.health.lastCheckedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(project.health.lastCheckedAt)) : "—"}</strong></p></div></section>
      <section className="panel-section"><h3>{t.incidents}</h3>{project.incidents.length === 0 ? <p>{t.noIncidents}</p> : <div className="incident-list">{project.incidents.map((incident) => <div key={incident.startedAt}><span className={incident.endedAt ? "recovered" : "ongoing"} /> <p><strong>{incident.endedAt ? t.recovered : t.ongoing}</strong><small>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(incident.startedAt))}{incident.endedAt ? ` → ${new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(incident.endedAt))}` : ""}</small><small>{incident.statusCode ? `HTTP ${incident.statusCode}` : incident.trigger ? humanizeMachine(incident.trigger) : ""}{incident.endedAt ? ` · ${formatDuration(incident.startedAt, incident.endedAt, locale)}` : ""}</small></p></div>)}</div>}</section>
      <div className="panel-actions">{project.caseStudyUrl && <a className="primary-button" href={project.caseStudyUrl} target="_blank" rel="noreferrer">{t.caseStudy}<ArrowUpRight size={17} /></a>}{project.repositoryUrl && <a className="secondary-button" href={project.repositoryUrl} target="_blank" rel="noreferrer"><Github size={17} />{t.repository}</a>}<a className="secondary-button report-problem-button" href={reportUrl(contactUrl, project, locale)} target="_blank" rel="noreferrer"><MessageCircleWarning size={17} />{t.reportProblem}</a></div>
      <ProjectCarousel key={project.id} project={project} t={t} />
    </div>}
  </aside></>;
});

function OperationalBanner({ project, locale, contactUrl, t, panel = false }: { project: ProjectSummary; locale: Locale; contactUrl: string | null; t: ReturnType<typeof getMessages>; panel?: boolean }) {
  const incident = project.health.activeIncident;
  const noticeType = incident ? "incident" : project.operationalNoticeType !== "none" ? project.operationalNoticeType : project.coolify.deploymentInProgress ? "update" : null;
  if (!noticeType) return null;
  const title = noticeType === "incident" ? t.activeIncident : noticeType === "maintenance" ? t.noticeMaintenance : noticeType === "restart" ? t.noticeRestart : t.noticeUpdate;
  const NoticeIcon = noticeType === "incident" ? TriangleAlert : noticeType === "maintenance" ? Wrench : noticeType === "restart" ? RotateCw : Info;
  const detail = incident
    ? incident.statusCode ? `HTTP ${incident.statusCode}` : incident.trigger ? humanizeMachine(incident.trigger) : t.ongoing
    : project.maintenanceMessage ?? t.deploying;
  return <div className={`operational-banner notice-${noticeType} ${panel ? "panel-notice" : ""}`}>
    <NoticeIcon size={panel ? 20 : 18} />
    <span className="operational-copy"><strong>{title}</strong><small>{detail}</small>{incident && <small>{t.incidentUserPrompt}</small>}</span>
    {(noticeType === "incident" || noticeType === "maintenance") && <a href={reportUrl(contactUrl, project, locale)} target="_blank" rel="noreferrer"><MessageCircleWarning size={15} />{t.contactOwner}</a>}
  </div>;
}

function MetaFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>; }

function ProjectCarousel({ project, t }: { project: ProjectDetail; t: ReturnType<typeof getMessages> }) {
  const slides: { id: string; src: string | null; alt: string }[] = [
    ...(project.cover ? [{ id: "cover", src: project.cover.src, alt: project.cover.alt }] : []),
    ...project.gallery.map((image) => ({ id: image.id, src: image.src, alt: image.alt })),
  ];
  if (slides.length === 0) slides.push({ id: "placeholder", src: null, alt: "" });
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const slideRef = useRef<HTMLDivElement>(null);
  const direction = useRef(1);
  const reducedMotion = useSyncExternalStore(reducedMotionSubscribe, reducedMotionSnapshot, () => true);
  function move(delta: number) { direction.current = delta; setIndex((current) => (current + delta + slides.length) % slides.length); }
  useEffect(() => {
    if (paused || reducedMotion || slides.length < 2) return;
    const timer = window.setInterval(() => { direction.current = 1; setIndex((current) => (current + 1) % slides.length); }, 5_000);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion, slides.length]);
  useLayoutEffect(() => {
    if (!slideRef.current || reducedMotion) return;
    const tween = gsap.fromTo(slideRef.current, { autoAlpha: 0, x: direction.current * 18, scale: .985 }, { autoAlpha: 1, x: 0, scale: 1, duration: .42, ease: "power2.out", clearProps: "opacity,visibility,transform" });
    return () => { tween.kill(); };
  }, [index, reducedMotion]);
  return <div className="panel-carousel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <a className="panel-art" href={project.liveUrl} target="_blank" rel="noreferrer" aria-label={`${t.openApp}: ${project.title}`}>
      <div ref={slideRef} className="carousel-slide">{slides[index]?.src ? <img src={slides[index].src} alt={slides[index].alt} /> : <PlaceholderArt seed={project.slug} />}</div>
      <span className="panel-live-action">{t.openApp}<ArrowUpRight size={18} /></span>
    </a>
    {slides.length > 1 && <><button className="carousel-arrow previous" type="button" aria-label={t.previousSlide} onClick={() => move(-1)}><ChevronLeft size={21} /></button><button className="carousel-arrow next" type="button" aria-label={t.nextSlide} onClick={() => move(1)}><ChevronRight size={21} /></button><div className="carousel-dots" aria-label={t.slides}>{slides.map((slide, slideIndex) => <button key={slide.id} type="button" className={slideIndex === index ? "active" : ""} aria-label={`${t.slide} ${slideIndex + 1}`} aria-current={slideIndex === index ? "true" : undefined} onClick={() => { direction.current = slideIndex > index ? 1 : -1; setIndex(slideIndex); }} />)}</div></>}
  </div>;
}

function StatusPill({ status, t }: { status: ProjectHealth; t: ReturnType<typeof getMessages> }) { return <span className={`status-pill status-${status}`}><span />{statusText(status, t)}</span>; }
function statusText(status: ProjectHealth, t: ReturnType<typeof getMessages>) { return t[status]; }
function formatPercent(value: number | null, fallback: string) { return value == null ? fallback : `${value.toFixed(value >= 99 ? 2 : 1)}%`; }
function UptimeBars({ values, label, large = false }: { values: (number | null)[]; label: string; large?: boolean }) { return <div className={`uptime-bars ${large ? "large" : ""}`} role="img" aria-label={label}>{values.map((value, index) => <span key={index} className={value == null ? "unknown" : value >= 99 ? "good" : value >= 90 ? "mixed" : "bad"} style={{ opacity: value == null ? .22 : Math.max(.45, value / 100) }} />)}</div>; }
function LatencyChart({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1); const min = Math.min(...values); const span = Math.max(1, max - min);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${38 - ((value - min) / span) * 32}`).join(" ");
  return <div className="latency-chart" role="img" aria-label={`${label}: ${values.at(-1)} ms`}><span>{label}</span><svg viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg><strong>{values.at(-1)} ms</strong></div>;
}
function PlaceholderArt({ seed }: { seed: string }) { return <div className="placeholder-art" aria-hidden="true"><span>{seed.slice(0, 2).toUpperCase()}</span><i /><b /></div>; }
function humanizeMachine(value: string) { return value.replaceAll(/[:_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()); }
function reportUrl(contactUrl: string | null, project: ProjectSummary, locale: Locale) {
  const target = contactUrl || "https://izbri.com";
  const subject = locale === "es" ? `Problema con ${project.title}` : `Problem with ${project.title}`;
  const body = locale === "es" ? `Estoy usando ${project.title} (${project.liveUrl}) y he encontrado este problema: ` : `I am using ${project.title} (${project.liveUrl}) and found this problem: `;
  try {
    const url = new URL(target);
    if (url.protocol === "mailto:") { url.searchParams.set("subject", subject); url.searchParams.set("body", body); }
    else { url.searchParams.set("project", project.slug); url.searchParams.set("report", "problem"); }
    return url.toString();
  } catch { return "https://izbri.com"; }
}
function formatRelativeTime(value: string, locale: Locale) {
  const difference = Date.parse(value) - Date.now();
  const absolute = Math.abs(difference);
  const [unit, divisor] = absolute < 3_600_000 ? ["minute", 60_000] as const : absolute < 86_400_000 ? ["hour", 3_600_000] as const : ["day", 86_400_000] as const;
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(difference / divisor), unit);
}
function formatDuration(start: string, end: string, locale: Locale) { const minutes = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 60_000)); return new Intl.NumberFormat(locale, { style: "unit", unit: minutes >= 60 ? "hour" : "minute", unitDisplay: "short", maximumFractionDigits: 1 }).format(minutes >= 60 ? minutes / 60 : minutes); }
function accentStyle(accent: ProjectSummary["accentColor"]) { return { "--project-accent": projectAccentHex(accent) } as CSSProperties; }
function reducedMotionSubscribe(callback: () => void) { const query = window.matchMedia("(prefers-reduced-motion: reduce)"); query.addEventListener("change", callback); return () => query.removeEventListener("change", callback); }
function reducedMotionSnapshot() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab" || window.matchMedia("(min-width: 861px)").matches) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')];
  if (!items.length) return;
  const first = items[0]!; const last = items[items.length - 1]!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
