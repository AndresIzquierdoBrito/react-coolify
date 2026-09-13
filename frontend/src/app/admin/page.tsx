"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowDown, ArrowUp, ArrowUpRight, CheckCircle2, Cloud, Github, GripVertical, ImagePlus, LogOut, Moon, Plus, RefreshCw, Save, Sun, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { projectInputSchema, type ProjectInput } from "@izbri/contracts";
import { projectAccents } from "@/lib/project-accents";
import { previewStorageKey } from "@/lib/api";
import { getChangedProjectFields, getMissingPublicationFields } from "@/lib/admin-form";

interface SessionData { authenticated: boolean; configured: boolean; methods: { github: boolean; password: boolean }; csrfToken: string | null; user: { login: string; displayName: string; avatarUrl: string | null } | null }
interface CoolifyTeam { id: string; name: string; apiUrl: string | null; credentialSource: "environment" | "database"; tokenConfigured: boolean; enabled: boolean; syncStatus: "never" | "success" | "partial" | "error" | "disabled"; lastAttemptAt: string | null; lastSuccessfulAt: string | null; lastErrorCode: string | null; lastErrorMessage: string | null; syncedResourceCount: number }
interface CatalogResource { id: string; resourceType: "application" | "service"; resourceUuid: string; name: string; description: string; status: string | null; sourceType: string | null; suggestedUrls: string[]; imported: boolean; syncedAt: string; team: { id: string; name: string } }
interface SentinelSummary { serverCount: number; enabledCount: number; metricsEnabledCount: number; lastReportedAt: string | null }
interface AdminGalleryImage { id: string; file_path: string; mime_type: string; alt_en: string; alt_es: string; display_order: number }
type AdminProject = Record<string, unknown> & { id: string; coolify_name: string; resource_type: string; team_name: string; technologies: { name: string }[]; gallery: AdminGalleryImage[] };
type FormErrors = Partial<Record<keyof ProjectInput | "cover" | "galleryAltEn" | "galleryAltEs", string>>;

class ApiMutationError extends Error {
  constructor(message: string, readonly code?: string, readonly details?: unknown) { super(message); }
}

const emptySession: SessionData = { authenticated: false, configured: false, methods: { github: false, password: false }, csrfToken: null, user: null };

export default function AdminPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [session, setSession] = useState<SessionData | null>(null);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [resources, setResources] = useState<CatalogResource[]>([]);
  const [teams, setTeams] = useState<CoolifyTeam[]>([]);
  const [sentinel, setSentinel] = useState<SentinelSummary>({ serverCount: 0, enabledCount: 0, metricsEnabledCount: 0, lastReportedAt: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [form, setForm] = useState<ProjectInput | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: "", apiUrl: "", token: "", enabled: true });

  const load = useCallback(async (options: { preserveForm?: boolean } = {}) => {
    const authResponse = await fetch("/api/v1/auth/session", { credentials: "include" });
    const auth = authResponse.ok ? await authResponse.json() as SessionData : emptySession;
    setSession(auth);
    if (!auth.authenticated) return;
    const [projectResponse, resourceResponse] = await Promise.all([fetch("/api/v1/admin/projects", { credentials: "include" }), fetch("/api/v1/admin/coolify/resources", { credentials: "include" })]);
    if (projectResponse.ok) {
      const data = await projectResponse.json() as { projects: AdminProject[] };
      setProjects(data.projects);
      const requestedId = new URLSearchParams(window.location.search).get("project");
      const targetId = selectedIdRef.current ?? (data.projects.some((project) => project.id === requestedId) ? requestedId : null) ?? data.projects[0]?.id ?? null;
      selectedIdRef.current = targetId;
      setSelectedId(targetId);
      const target = data.projects.find((project) => project.id === targetId);
      if (!options.preserveForm) {
        const saved = target ? toForm(target) : null;
        const stored = target && requestedId === targetId ? window.localStorage.getItem(previewStorageKey(targetId)) : null;
        if (stored) {
          try {
            const restored = projectInputSchema.safeParse(JSON.parse(stored));
            setForm(restored.success ? restored.data : saved);
          } catch { setForm(saved); }
        } else setForm(saved);
      }
    }
    if (resourceResponse.ok) { const data = await resourceResponse.json() as { resources: CatalogResource[]; teams: CoolifyTeam[]; sentinel: SentinelSummary }; setResources(data.resources); setTeams(data.teams ?? []); setSentinel(data.sentinel); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const selected = useMemo(() => projects.find((project) => project.id === selectedId) ?? null, [projects, selectedId]);
  const hasUnsavedChanges = useMemo(() => Boolean(form && selected && getChangedProjectFields(form, toForm(selected)).length), [form, selected]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (hasUnsavedChanges) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);
  function selectProject(project: AdminProject) {
    if (hasUnsavedChanges && !window.confirm("Discard the unsaved changes for this project?")) return;
    selectedIdRef.current = project.id; setSelectedId(project.id); setForm(toForm(project)); setFormErrors({}); setMessage(null);
  }

  async function mutate(url: string, options: RequestInit = {}) {
    const response = await fetch(url, { ...options, credentials: "include", headers: { ...(options.headers ?? {}), "x-csrf-token": session?.csrfToken ?? "" } });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string; details?: unknown } } | null;
      throw new ApiMutationError(payload?.error?.message ?? "The request could not be completed.", payload?.error?.code, payload?.error?.details);
    }
    return response;
  }

  async function sync() {
    setSyncing(true); setMessage(null);
    try { const response = await mutate("/api/v1/admin/coolify/sync", { method: "POST" }); const payload = await response.json() as { resources: CatalogResource[]; teams: CoolifyTeam[]; synced: number; sentinelServers: number; sentinel: SentinelSummary; warnings?: { message: string }[] }; setResources(payload.resources); setTeams(payload.teams ?? []); setSentinel(payload.sentinel); const summary = `${payload.synced} Coolify resources synchronized across ${payload.teams?.length ?? 0} teams.`; setMessage(payload.warnings?.length ? `${summary} ${payload.warnings.map((warning) => warning.message).join(" ")}` : summary); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Sync failed."); }
    finally { setSyncing(false); }
  }

  function beginTeam(team?: CoolifyTeam) {
    setTeamFormOpen(true);
    setEditingTeamId(team?.id ?? null);
    setTeamForm({ name: team?.name ?? "", apiUrl: team?.apiUrl ?? "", token: "", enabled: team?.enabled ?? true });
  }

  async function saveTeam(event: React.FormEvent) {
    event.preventDefault();
    try {
      const isEditing = Boolean(editingTeamId);
      const body: Record<string, unknown> = { name: teamForm.name, apiUrl: teamForm.apiUrl, enabled: teamForm.enabled };
      if (teamForm.token.trim()) body.token = teamForm.token.trim();
      const response = await mutate(isEditing ? `/api/v1/admin/coolify/teams/${editingTeamId}` : "/api/v1/admin/coolify/teams", { method: isEditing ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { team: CoolifyTeam };
      setTeams((current) => isEditing ? current.map((item) => item.id === payload.team.id ? payload.team : item) : [...current, payload.team]);
      setMessage(`${payload.team.name} connection saved.`);
      setTeamFormOpen(false); setEditingTeamId(null); setTeamForm({ name: "", apiUrl: "", token: "", enabled: true });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Team connection could not be saved."); }
  }

  async function syncTeam(id: string) {
    try {
      const response = await mutate(`/api/v1/admin/coolify/teams/${id}/sync`, { method: "POST" });
      const payload = await response.json() as { team: CoolifyTeam; resources: CatalogResource[]; warnings?: { message: string }[] };
      setTeams((current) => current.map((item) => item.id === id ? payload.team : item));
      setResources(payload.resources);
      setMessage(payload.warnings?.length ? payload.warnings.map((warning) => warning.message).join(" ") : `${payload.team.name} synchronized.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Team synchronization failed."); }
  }

  async function importResource(resource: CatalogResource, liveUrl: string) {
    try {
      const response = await mutate("/api/v1/admin/projects/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceId: resource.id, liveUrl }) });
      const { id } = await response.json() as { id: string };
      selectedIdRef.current = id; await load(); setMessage(`${resource.name} imported as a draft.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
  }

  async function save() {
    if (!form || !selectedId) return;
    if (!validateForm(form, setFormErrors, setMessage, true)) return;
    setSaving(true); setMessage(null);
    try {
      await mutate(`/api/v1/admin/projects/${selectedId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      window.localStorage.removeItem(previewStorageKey(selectedId));
      await load();
      setSelectedId(selectedId);
      setMessage(form.published ? "Project saved and published. It is now available on the public dashboard." : "Draft saved. Enable Published when it is ready for the public dashboard.");
    }
    catch (error) { showFormError(error, form, setFormErrors, setMessage); }
    finally { setSaving(false); }
  }

  async function preview() {
    if (!form || !selectedId) return;
    if (!validateForm(form, setFormErrors, setMessage, false)) return;
    const previewUrl = `/en?project=${encodeURIComponent(form.slug)}&preview=${encodeURIComponent(selectedId)}`;
    setMessage(null);
    try {
      window.localStorage.setItem(previewStorageKey(selectedId), JSON.stringify(form));
      const previewWindow = window.open(previewUrl, "_blank");
      if (!previewWindow) setMessage("Allow pop-ups for this site to open the preview. Nothing has been saved yet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The preview could not be opened. Nothing has been saved.");
    }
  }

  async function uploadCover(file: File) {
    if (!form || !selectedId) return;
    const body = new FormData(); body.append("cover", file); body.append("altEn", form.coverAltEn); body.append("altEs", form.coverAltEs);
    setSaving(true); setMessage(null);
    try { await mutate(`/api/v1/admin/projects/${selectedId}/cover`, { method: "POST", body }); await load({ preserveForm: true }); setSelectedId(selectedId); setMessage("Cover image optimized and uploaded. Your other unsaved edits were preserved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed."); }
    finally { setSaving(false); }
  }

  async function uploadGallery(file: File, altEn: string, altEs: string) {
    if (!selectedId) return false;
    const body = new FormData(); body.append("image", file); body.append("altEn", altEn); body.append("altEs", altEs);
    setSaving(true); setMessage(null);
    try { await mutate(`/api/v1/admin/projects/${selectedId}/gallery`, { method: "POST", body }); await load({ preserveForm: true }); setMessage("Carousel image uploaded. Your other unsaved edits were preserved."); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Gallery upload failed."); return false; }
    finally { setSaving(false); }
  }

  async function deleteGallery(imageId: string) {
    if (!selectedId) return;
    try { await mutate(`/api/v1/admin/projects/${selectedId}/gallery/${imageId}`, { method: "DELETE" }); await load({ preserveForm: true }); setMessage("Carousel image removed. Your unsaved edits were preserved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Gallery image could not be removed."); }
  }

  async function moveGallery(imageId: string, direction: -1 | 1) {
    if (!selectedId || !selected) return;
    const current = [...(selected.gallery ?? [])]; const index = current.findIndex((image) => image.id === imageId); const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target]!, current[index]!];
    try { await mutate(`/api/v1/admin/projects/${selectedId}/gallery/reorder`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: current.map((image) => image.id) }) }); await load({ preserveForm: true }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Gallery reordering failed."); }
  }

  async function applyOrder(next: AdminProject[]) {
    setProjects(next);
    try { await mutate("/api/v1/admin/projects/reorder", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: next.map((project) => project.id) }) }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Reordering failed."); await load({ preserveForm: true }); }
  }
  function moveProject(id: string, direction: -1 | 1) { const index = projects.findIndex((project) => project.id === id); const target = index + direction; if (index < 0 || target < 0 || target >= projects.length) return; const next = [...projects]; [next[index], next[target]] = [next[target]!, next[index]!]; void applyOrder(next); }
  function dropProject(targetId: string) { if (!dragging || dragging === targetId) return; const next = [...projects]; const sourceIndex = next.findIndex((item) => item.id === dragging); const targetIndex = next.findIndex((item) => item.id === targetId); const [item] = next.splice(sourceIndex, 1); if (item) next.splice(targetIndex, 0, item); setDragging(null); void applyOrder(next); }

  if (!session) return <AdminCentered><span className="loading-ring" /><p>Loading the control room…</p></AdminCentered>;
  if (!session.authenticated) {
    const authDenied = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("auth") === "denied";
    return <AdminCentered><div className="admin-login-mark">IZ</div><span className="eyebrow">Owner workspace</span><h1>Izbri Projects admin</h1><p>{session.methods.github ? "Sign in with your authorized GitHub account to manage projects." : "Sign in with the temporary owner credentials to import, curate, and monitor projects."}</p>{authDenied && <p className="field-error" role="alert">That GitHub account is not authorized for this workspace.</p>}{session.methods.password && <PasswordLogin />}{session.methods.password && session.methods.github && <span className="login-divider">or</span>}{session.methods.github && <form action="/api/v1/auth/github" method="get"><button className="secondary-button admin-login-button" type="submit"><Github size={19} /> Continue with GitHub</button></form>}{!session.configured && <div className="admin-warning">Admin authentication is not configured. Add GitHub OAuth credentials and an authorized login in production.</div>}<Link className="text-link" href="/en">Return to public dashboard</Link></AdminCentered>;
  }

  const unimported = resources.filter((resource) => !resource.imported);
  return <div className="admin-shell">
    <header className="admin-header"><div><span className="eyebrow"><span className="live-dot" />Owner workspace</span><h1>Project control room<span className="lime-mark">.</span></h1></div><div className="admin-account">{session.user?.avatarUrl && <img src={session.user.avatarUrl} alt="" />}<span><strong>{session.user?.displayName}</strong><small>@{session.user?.login}</small></span><button className="admin-icon-button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle theme">{resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button><Link className="admin-icon-button" href="/en" aria-label="Open public dashboard"><ArrowUpRight size={18} /></Link><button className="admin-icon-button" onClick={() => void mutate("/api/v1/auth/logout", { method: "POST" }).then(() => location.reload())} aria-label="Sign out"><LogOut size={18} /></button></div></header>
    {message && <div className="admin-toast" role="status">{message}<button onClick={() => setMessage(null)}>×</button></div>}
    <section className="import-panel team-panel"><div className="section-title"><div><span>Coolify connections</span><h2>{teams.length} teams</h2></div><button className="secondary-button" onClick={() => beginTeam()}><Plus size={16} />Add team</button></div><div className="team-list">{teams.map((team) => <article className="team-row" key={team.id}><div><strong>{team.name}</strong><small>{team.credentialSource === "environment" ? "Deployment-managed credentials" : team.apiUrl}</small><span className={`team-sync-status status-${team.syncStatus}`}>{team.syncStatus}{team.lastAttemptAt ? ` · attempted ${formatAdminDate(team.lastAttemptAt)}` : ""}{team.lastSuccessfulAt ? ` · last success ${formatAdminDate(team.lastSuccessfulAt)}` : ""}</span>{team.lastErrorMessage && <small className="field-error">{team.lastErrorMessage}</small>}</div><div className="team-actions"><button className="text-button" onClick={() => beginTeam(team)}>Edit</button><button className="text-button" onClick={() => void syncTeam(team.id)} disabled={!team.enabled}>Sync</button></div></article>)}</div>{teamFormOpen ? <form className="team-form" onSubmit={saveTeam}><label>Team name<input value={teamForm.name} onChange={(event) => setTeamForm((current) => ({ ...current, name: event.target.value }))} required /></label><label>Coolify API URL<input type="url" value={teamForm.apiUrl} onChange={(event) => setTeamForm((current) => ({ ...current, apiUrl: event.target.value }))} required={!editingTeamId} disabled={Boolean(editingTeamId && teams.find((team) => team.id === editingTeamId)?.credentialSource === "environment")} /></label><label>Read-only API token<input type="password" value={teamForm.token} onChange={(event) => setTeamForm((current) => ({ ...current, token: event.target.value }))} placeholder={editingTeamId ? "Leave blank to keep the existing token" : "ID|secret"} required={!editingTeamId} autoComplete="new-password" /></label><label className="checkbox-field"><input type="checkbox" checked={teamForm.enabled} onChange={(event) => setTeamForm((current) => ({ ...current, enabled: event.target.checked }))} />Enabled</label><div className="editor-actions"><button className="secondary-button" type="button" onClick={() => { setTeamFormOpen(false); setEditingTeamId(null); }}>Cancel</button><button className="primary-button" type="submit"><Save size={16} />Save connection</button></div></form> : null}</section>
    <section className="import-panel"><div className="section-title"><div><span>Coolify catalog</span><h2>Import something new</h2></div><button className="secondary-button" onClick={() => void sync()} disabled={syncing}><RefreshCw size={16} className={syncing ? "spin" : ""} />{syncing ? "Syncing…" : "Sync catalog"}</button></div>{sentinel.serverCount > 0 && <div className={`sentinel-status ${sentinel.metricsEnabledCount > 0 ? "active" : "needs-metrics"}`}><Activity size={18} /><span><strong>Sentinel</strong>{sentinel.metricsEnabledCount > 0 ? `CPU/RAM collection is enabled on ${sentinel.metricsEnabledCount} server${sentinel.metricsEnabledCount === 1 ? "" : "s"}.` : sentinel.enabledCount > 0 ? "The agent is enabled, but Coolify Metrics is off. Enable Metrics on the server Charts page to collect CPU/RAM." : "Sentinel is present but disabled."}</span></div>}{unimported.length === 0 ? <p className="muted-copy">Everything currently available in Coolify has been imported.</p> : <div className="resource-strip">{unimported.map((resource) => <ImportCard key={resource.id} resource={resource} onImport={importResource} />)}</div>}</section>
    <div className="admin-workspace">
      <aside className="admin-sidebar"><div className="section-title compact"><div><span>Portfolio</span><h2>{projects.length} projects</h2></div></div><div className="admin-project-list">{projects.map((project, index) => <div key={project.id} draggable onDragStart={() => setDragging(project.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropProject(project.id)} className={`admin-project-item ${selectedId === project.id ? "selected" : ""}`}><button className="drag-handle" aria-label="Drag to reorder"><GripVertical size={17} /></button><button className="project-select" onClick={() => selectProject(project)}><strong>{String(project.title_en || project.coolify_name)}</strong><span>{project.team_name} · {project.resource_type} · {Number(project.published) ? "Published" : "Draft"}</span></button><span className="order-buttons"><button onClick={() => moveProject(project.id, -1)} disabled={index === 0} aria-label="Move up"><ArrowUp size={14} /></button><button onClick={() => moveProject(project.id, 1)} disabled={index === projects.length - 1} aria-label="Move down"><ArrowDown size={14} /></button></span></div>)}</div></aside>
      <main className="admin-editor">{form && selected ? <ProjectEditor key={selected.id} project={selected} form={form} setForm={setForm} errors={formErrors} clearError={(key) => setFormErrors((current) => ({ ...current, [key]: undefined }))} saving={saving} onSave={save} onPreview={preview} onUpload={uploadCover} onGalleryUpload={uploadGallery} onGalleryDelete={deleteGallery} onGalleryMove={moveGallery} /> : <div className="editor-empty"><Cloud size={38} /><h2>Import or select a project</h2><p>Your Coolify resource remains untouched until you publish its curated dashboard entry.</p></div>}</main>
    </div>
  </div>;
}

function ImportCard({ resource, onImport }: { resource: CatalogResource; onImport: (resource: CatalogResource, url: string) => void }) {
  const [url, setUrl] = useState(resource.suggestedUrls[0] ?? "");
  return <article className="import-card"><div><span className="resource-pill">{resource.resourceType}</span><small>{resource.team.name} · {resource.sourceType ?? "Coolify resource"}</small></div><h3>{resource.name}</h3><p>{resource.description || "No description in Coolify."}</p><label>Public URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" /></label><button className="primary-button" onClick={() => onImport(resource, url)} disabled={!url}><Plus size={16} />Import draft</button></article>;
}

function ProjectEditor({ project, form, setForm, errors, clearError, saving, onSave, onPreview, onUpload, onGalleryUpload, onGalleryDelete, onGalleryMove }: { project: AdminProject; form: ProjectInput; setForm: (form: ProjectInput) => void; errors: FormErrors; clearError: (key: keyof FormErrors) => void; saving: boolean; onSave: () => void; onPreview: () => void; onUpload: (file: File) => void; onGalleryUpload: (file: File, altEn: string, altEs: string) => Promise<boolean>; onGalleryDelete: (imageId: string) => void; onGalleryMove: (imageId: string, direction: -1 | 1) => void }) {
  const [galleryAltEn, setGalleryAltEn] = useState("");
  const [galleryAltEs, setGalleryAltEs] = useState("");
  const [galleryFile, setGalleryFile] = useState<File | null>(null);
  const [galleryErrors, setGalleryErrors] = useState<{ en?: string; es?: string; file?: string }>({});
  const [technologyText, setTechnologyText] = useState(form.technologyNames.join(", "));
  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const savedForm = useMemo(() => toForm(project), [project]);
  const dirtyFields = getChangedProjectFields(form, savedForm);
  const isChanged = (key: keyof ProjectInput) => dirtyFields.includes(key);
  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => { clearError(key); setForm({ ...form, [key]: value }); };
  async function uploadGalleryImage() {
    const nextErrors = { en: galleryAltEn.trim() ? undefined : "Add English alternative text before uploading.", es: galleryAltEs.trim() ? undefined : "Añade el texto alternativo en español antes de subir la imagen." };
    setGalleryErrors({ ...nextErrors, file: galleryFile ? undefined : "Choose an image to upload." });
    if (nextErrors.en || nextErrors.es || !galleryFile) return;
    if (await onGalleryUpload(galleryFile, galleryAltEn, galleryAltEs)) {
      setGalleryAltEn(""); setGalleryAltEs(""); setGalleryFile(null); setGalleryErrors({});
    }
  }
  return <form noValidate onSubmit={(event) => { event.preventDefault(); void onSave(); }}>
    <div className={`editor-header ${dirtyFields.length ? "has-unsaved-changes" : ""}`}><div><span className="resource-pill">{project.resource_type}</span><span className="source-pill">{project.team_name}</span>{dirtyFields.length > 0 && <span className="unsaved-count" role="status">{dirtyFields.length} unsaved {dirtyFields.length === 1 ? "change" : "changes"}</span>}<h2>{form.titleEn || project.coolify_name}</h2><p>Coolify source: {project.coolify_name} · Your public project names remain fully editable.</p></div><div className="editor-actions"><button className="secondary-button" type="button" onClick={() => void onPreview()} disabled={saving}>Preview changes<ArrowUpRight size={16} /></button><button className="primary-button" type="submit" disabled={saving}><Save size={16} />{saving ? "Saving…" : "Save project"}</button></div></div>
    <fieldset><legend>Publishing</legend><div className="form-grid three"><Field label="Slug" error={errors.slug} changed={isChanged("slug")}><input value={form.slug} onChange={(event) => set("slug", event.target.value)} aria-invalid={Boolean(errors.slug)} /></Field><Field label="Display order" error={errors.displayOrder} changed={isChanged("displayOrder")}><input type="number" min="0" value={form.displayOrder} onChange={(event) => set("displayOrder", Number(event.target.value))} aria-invalid={Boolean(errors.displayOrder)} /></Field><Field label="Active notice" error={errors.operationalNoticeType} changed={isChanged("operationalNoticeType")}><select value={form.operationalNoticeType} onChange={(event) => set("operationalNoticeType", event.target.value as ProjectInput["operationalNoticeType"])} aria-invalid={Boolean(errors.operationalNoticeType)}><option value="none">No manual notice</option><option value="maintenance">Maintenance in progress</option><option value="restart">Restart in progress</option><option value="update">Update in progress</option></select></Field><div className="toggle-stack"><Toggle label="Featured project" checked={form.featured} changed={isChanged("featured")} onChange={(value) => set("featured", value)} /><Toggle label="Published" checked={form.published} changed={isChanged("published")} onChange={(value) => set("published", value)} /></div></div></fieldset>
    <fieldset className={isChanged("accentColor") ? "has-unsaved-changes" : undefined}><legend>Project color</legend><p className="fieldset-intro">Choose a bright accent for this project. It changes artwork, selection rings, carousel details, and other identity highlights without changing health-status colors.{isChanged("accentColor") && <strong className="inline-edited">Edited</strong>}</p><AccentPicker value={form.accentColor} onChange={(value) => set("accentColor", value)} /></fieldset>
    <fieldset><legend>English content</legend><div className="form-grid"><Field label="Public project name (English)" error={errors.titleEn} changed={isChanged("titleEn")}><input value={form.titleEn} maxLength={120} onChange={(event) => set("titleEn", event.target.value)} aria-invalid={Boolean(errors.titleEn)} /></Field><Field label="Summary" error={errors.summaryEn} changed={isChanged("summaryEn")}><textarea rows={3} value={form.summaryEn} maxLength={280} onChange={(event) => set("summaryEn", event.target.value)} aria-invalid={Boolean(errors.summaryEn)} /></Field>{form.operationalNoticeType !== "none" && <Field label="Operational notice message" wide error={errors.maintenanceMessageEn} changed={isChanged("maintenanceMessageEn")}><textarea rows={2} value={form.maintenanceMessageEn} maxLength={280} onChange={(event) => set("maintenanceMessageEn", event.target.value)} aria-invalid={Boolean(errors.maintenanceMessageEn)} placeholder="Explain the maintenance, restart, or update currently underway." /></Field>}<Field label="Detailed overview" wide error={errors.descriptionEn} changed={isChanged("descriptionEn")}><textarea rows={7} value={form.descriptionEn} maxLength={4000} onChange={(event) => set("descriptionEn", event.target.value)} aria-invalid={Boolean(errors.descriptionEn)} /></Field></div></fieldset>
    <fieldset><legend>Contenido en español</legend><div className="form-grid"><Field label="Nombre público del proyecto (Español)" error={errors.titleEs} changed={isChanged("titleEs")}><input value={form.titleEs} maxLength={120} onChange={(event) => set("titleEs", event.target.value)} aria-invalid={Boolean(errors.titleEs)} /></Field><Field label="Resumen" error={errors.summaryEs} changed={isChanged("summaryEs")}><textarea rows={3} value={form.summaryEs} maxLength={280} onChange={(event) => set("summaryEs", event.target.value)} aria-invalid={Boolean(errors.summaryEs)} /></Field>{form.operationalNoticeType !== "none" && <Field label="Mensaje del aviso operativo" wide error={errors.maintenanceMessageEs} changed={isChanged("maintenanceMessageEs")}><textarea rows={2} value={form.maintenanceMessageEs} maxLength={280} onChange={(event) => set("maintenanceMessageEs", event.target.value)} aria-invalid={Boolean(errors.maintenanceMessageEs)} placeholder="Explica el mantenimiento, reinicio o actualización en curso." /></Field>}<Field label="Descripción detallada" wide error={errors.descriptionEs} changed={isChanged("descriptionEs")}><textarea rows={7} value={form.descriptionEs} maxLength={4000} onChange={(event) => set("descriptionEs", event.target.value)} aria-invalid={Boolean(errors.descriptionEs)} /></Field></div></fieldset>
    <fieldset><legend>Links and technology</legend><div className="form-grid"><Field label="Live application URL" error={errors.liveUrl} changed={isChanged("liveUrl")}><input type="url" value={form.liveUrl} onChange={(event) => set("liveUrl", event.target.value)} aria-invalid={Boolean(errors.liveUrl)} /></Field><Field label="Repository URL" error={errors.repositoryUrl} changed={isChanged("repositoryUrl")}><input type="url" value={form.repositoryUrl ?? ""} onChange={(event) => set("repositoryUrl", event.target.value)} aria-invalid={Boolean(errors.repositoryUrl)} /></Field><Field label="External case study URL" error={errors.caseStudyUrl} changed={isChanged("caseStudyUrl")}><input type="url" value={form.caseStudyUrl ?? ""} onChange={(event) => set("caseStudyUrl", event.target.value)} aria-invalid={Boolean(errors.caseStudyUrl)} /></Field><Field label="Technologies (comma separated)" error={errors.technologyNames} changed={isChanged("technologyNames")}><input value={technologyText} onChange={(event) => { const value = event.target.value; setTechnologyText(value); set("technologyNames", value.split(",").map((item) => item.trim()).filter(Boolean)); }} aria-invalid={Boolean(errors.technologyNames)} placeholder="Next.js, TypeScript, SQLite" /></Field></div></fieldset>
    <fieldset><legend>Cover art</legend><div className="cover-editor"><div className={`cover-preview ${errors.cover ? "has-error" : ""}`}>{project.large_path ? <img src={`/media/${project.large_path}`} alt="" /> : <span><ImagePlus size={32} />No cover uploaded</span>}</div><div className="cover-fields"><Field label="English alt text" error={errors.coverAltEn} changed={isChanged("coverAltEn")}><input value={form.coverAltEn} onChange={(event) => set("coverAltEn", event.target.value)} aria-invalid={Boolean(errors.coverAltEn)} /></Field><Field label="Texto alternativo en español" error={errors.coverAltEs} changed={isChanged("coverAltEs")}><input value={form.coverAltEs} onChange={(event) => set("coverAltEs", event.target.value)} aria-invalid={Boolean(errors.coverAltEs)} /></Field>{errors.cover && <p className="field-error" role="alert">{errors.cover}</p>}<button className="upload-button" type="button" onClick={() => coverInputRef.current?.click()} disabled={saving}><ImagePlus size={16} />Upload and optimize</button><input ref={coverInputRef} className="file-input-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => { const file = event.target.files?.[0]; if (file) { clearError("cover"); void onUpload(file); event.currentTarget.value = ""; } }} /><small>JPEG, PNG, WebP, or AVIF up to 10 MB. One 1600px AVIF and 800px WebP are generated.</small></div></div></fieldset>
    <fieldset><legend>Project carousel</legend><p className="fieldset-intro">These are the real slides shown in the expanded project panel, after the cover image. Animated GIFs remain animated.</p><div className="gallery-editor">{project.gallery?.length ? <div className="gallery-list">{project.gallery.map((image, index) => <article key={image.id} className="gallery-item"><img src={`/media/${image.file_path}`} alt="" /><div><strong>{image.alt_en}</strong><small>{image.alt_es}</small><span>{image.mime_type.replace("image/", "").toUpperCase()}</span></div><div className="gallery-actions"><button type="button" onClick={() => onGalleryMove(image.id, -1)} disabled={index === 0} aria-label="Move carousel image left"><ArrowUp size={15} /></button><button type="button" onClick={() => onGalleryMove(image.id, 1)} disabled={index === project.gallery.length - 1} aria-label="Move carousel image right"><ArrowDown size={15} /></button><button type="button" onClick={() => onGalleryDelete(image.id)} aria-label="Remove carousel image"><Trash2 size={15} /></button></div></article>)}</div> : <p className="muted-copy">No extra carousel images yet. The cover remains the first slide.</p>}<div className="gallery-upload"><Field label="English alt text" error={galleryErrors.en}><input value={galleryAltEn} maxLength={180} onChange={(event) => { setGalleryAltEn(event.target.value); setGalleryErrors((current) => ({ ...current, en: undefined })); }} aria-invalid={Boolean(galleryErrors.en)} /></Field><Field label="Texto alternativo en español" error={galleryErrors.es}><input value={galleryAltEs} maxLength={180} onChange={(event) => { setGalleryAltEs(event.target.value); setGalleryErrors((current) => ({ ...current, es: undefined })); }} aria-invalid={Boolean(galleryErrors.es)} /></Field><button className="upload-button" type="button" onClick={() => galleryInputRef.current?.click()} disabled={saving}><ImagePlus size={16} />Choose carousel image</button><input ref={galleryInputRef} className="file-input-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" onChange={(event) => { const file = event.target.files?.[0] ?? null; setGalleryFile(file); setGalleryErrors((current) => ({ ...current, file: undefined })); event.currentTarget.value = ""; }} />{galleryFile && <div className="selected-upload"><span><strong>{galleryFile.name}</strong><small>{Math.max(1, Math.round(galleryFile.size / 1024))} KB</small></span><button type="button" onClick={() => setGalleryFile(null)} aria-label="Clear selected carousel image">×</button></div>}{galleryErrors.file && <p className="field-error gallery-file-error" role="alert">{galleryErrors.file}</p>}<button className="primary-button gallery-submit" type="button" onClick={() => void uploadGalleryImage()} disabled={saving}><ImagePlus size={16} />Upload selected image</button><small>JPEG, PNG, WebP, AVIF, or animated GIF up to 15 MB. Up to 12 additional slides.</small></div></div></fieldset>
    <fieldset><legend>Availability monitoring</legend><div className="form-grid three"><div className="toggle-stack"><Toggle label="Monitoring enabled" checked={form.monitoringEnabled} changed={isChanged("monitoringEnabled")} onChange={(value) => set("monitoringEnabled", value)} /></div><Field label="Uptime start date" error={errors.uptimeStartDate} changed={isChanged("uptimeStartDate")}><input type="date" value={form.uptimeStartDate} onChange={(event) => set("uptimeStartDate", event.target.value)} aria-invalid={Boolean(errors.uptimeStartDate)} /></Field><Field label="Health-check URL" error={errors.healthUrl} changed={isChanged("healthUrl")}><input type="url" value={form.healthUrl ?? ""} onChange={(event) => set("healthUrl", event.target.value)} aria-invalid={Boolean(errors.healthUrl)} /></Field><Field label="Method" error={errors.healthMethod} changed={isChanged("healthMethod")}><select value={form.healthMethod} onChange={(event) => set("healthMethod", event.target.value as "GET" | "HEAD")} aria-invalid={Boolean(errors.healthMethod)}><option>GET</option><option>HEAD</option></select></Field><Field label="Timeout (ms)" error={errors.healthTimeoutMs} changed={isChanged("healthTimeoutMs")}><input type="number" min="1000" max="30000" step="500" value={form.healthTimeoutMs} onChange={(event) => set("healthTimeoutMs", Number(event.target.value))} aria-invalid={Boolean(errors.healthTimeoutMs)} /></Field><Field label="Minimum success status" error={errors.expectedStatusMin} changed={isChanged("expectedStatusMin")}><input type="number" min="100" max="599" value={form.expectedStatusMin} onChange={(event) => set("expectedStatusMin", Number(event.target.value))} aria-invalid={Boolean(errors.expectedStatusMin)} /></Field><Field label="Maximum success status" error={errors.expectedStatusMax} changed={isChanged("expectedStatusMax")}><input type="number" min="100" max="599" value={form.expectedStatusMax} onChange={(event) => set("expectedStatusMax", Number(event.target.value))} aria-invalid={Boolean(errors.expectedStatusMax)} /></Field></div><p className="form-help"><CheckCircle2 size={15} />Before the first measurement, the selected date is counted as assumed-perfect uptime. Three consecutive failures confirm an incident; one successful response recovers it.</p></fieldset>
  </form>;
}

function Field({ label, wide, error, changed = false, children }: { label: string; wide?: boolean; error?: string; changed?: boolean; children: React.ReactNode }) { return <label className={`admin-field ${wide ? "wide" : ""} ${changed ? "has-unsaved-changes" : ""} ${error ? "has-error" : ""}`}><span>{label}{changed && <em>Edited</em>}</span>{children}{error && <small className="field-error" role="alert">{error}</small>}</label>; }
function Toggle({ label, checked, changed = false, onChange }: { label: string; checked: boolean; changed?: boolean; onChange: (value: boolean) => void }) { return <label className={`admin-toggle ${changed ? "has-unsaved-changes" : ""}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track"><i /></span><strong>{label}</strong>{changed && <em>Edited</em>}</label>; }
function AccentPicker({ value, onChange }: { value: ProjectInput["accentColor"]; onChange: (value: ProjectInput["accentColor"]) => void }) { return <div className="accent-picker" role="radiogroup" aria-label="Project accent color">{projectAccents.map((accent) => <button key={accent.value} type="button" role="radio" aria-checked={value === accent.value} className={value === accent.value ? "selected" : ""} onClick={() => onChange(accent.value)}><span style={{ background: accent.hex }} /><strong>{accent.label}</strong>{value === accent.value && <CheckCircle2 size={16} />}</button>)}</div>; }
function AdminCentered({ children }: { children: React.ReactNode }) { return <main className="admin-centered">{children}</main>; }

function PasswordLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSubmitting(true); setError(null);
    try {
      const response = await fetch("/api/v1/auth/password", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(payload?.error?.message ?? "Sign-in failed."); }
      location.reload();
    } catch (loginError) { setError(loginError instanceof Error ? loginError.message : "Sign-in failed."); setSubmitting(false); }
  }
  return <form className="password-login" onSubmit={(event) => void submit(event)}><label><span>Username</span><input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required autoFocus /></label><label><span>Password</span><input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button></form>;
}

function validateForm(form: ProjectInput, setErrors: React.Dispatch<React.SetStateAction<FormErrors>>, setMessage: (message: string | null) => void, requirePublishable: boolean) {
  const result = projectInputSchema.safeParse(form);
  const errors: FormErrors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "") as keyof ProjectInput;
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  if (requirePublishable && form.published) Object.assign(errors, getMissingPublicationFields(form));
  if (Object.keys(errors).length === 0) { setErrors({}); return true; }
  setErrors(errors);
  setMessage(`Please correct ${Object.keys(errors).length} highlighted ${Object.keys(errors).length === 1 ? "field" : "fields"} before saving.`);
  focusFirstError();
  return false;
}

function showFormError(error: unknown, form: ProjectInput, setErrors: React.Dispatch<React.SetStateAction<FormErrors>>, setMessage: (message: string | null) => void) {
  const next: FormErrors = {};
  if (error instanceof ApiMutationError && Array.isArray(error.details)) {
    for (const issue of error.details as { path?: unknown[]; message?: string }[]) {
      const key = String(issue.path?.[0] ?? "") as keyof ProjectInput;
      if (key && !next[key]) next[key] = issue.message ?? "Check this value.";
    }
  }
  if (error instanceof ApiMutationError && error.code === "INVALID_STATUS_RANGE") {
    next.expectedStatusMin = "The minimum status cannot be greater than the maximum.";
    next.expectedStatusMax = "The maximum status must be at least the minimum.";
  }
  if (error instanceof ApiMutationError && error.code === "INCOMPLETE_TRANSLATIONS") {
    Object.assign(next, getMissingPublicationFields(form));
  }
  if (error instanceof ApiMutationError && error.code === "INCOMPLETE_MAINTENANCE_TRANSLATIONS") {
    if (!form.maintenanceMessageEn.trim()) next.maintenanceMessageEn = "Add the English notice before publishing.";
    if (!form.maintenanceMessageEs.trim()) next.maintenanceMessageEs = "Añade el aviso en español antes de publicar.";
  }
  if (error instanceof ApiMutationError && error.code === "COVER_REQUIRED") next.cover = "Upload a cover image before publishing.";
  setErrors(next);
  setMessage(Object.keys(next).length ? "Please correct the highlighted fields before saving." : error instanceof Error ? error.message : "The project could not be saved.");
  if (Object.keys(next).length) focusFirstError();
}

function focusFirstError() {
  requestAnimationFrame(() => {
    const field = document.querySelector<HTMLElement>(".admin-field.has-error, .cover-preview.has-error");
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    field?.querySelector<HTMLElement>("input,textarea,select,button")?.focus({ preventScroll: true });
  });
}

function toForm(project: AdminProject): ProjectInput {
  const string = (key: string) => String(project[key] ?? "");
  const accent = string("accent_color");
  const noticeType = string("operational_notice_type");
  return { slug: string("slug"), titleEn: string("title_en"), titleEs: string("title_es"), summaryEn: string("summary_en"), summaryEs: string("summary_es"), descriptionEn: string("description_en"), descriptionEs: string("description_es"), maintenanceMessageEn: string("maintenance_message_en"), maintenanceMessageEs: string("maintenance_message_es"), operationalNoticeType: (["maintenance", "restart", "update"].includes(noticeType) ? noticeType : "none") as ProjectInput["operationalNoticeType"], liveUrl: string("live_url"), repositoryUrl: string("repository_url"), caseStudyUrl: string("case_study_url"), technologyNames: project.technologies?.map((technology) => technology.name) ?? [], featured: Boolean(project.featured), published: Boolean(project.published), displayOrder: Number(project.display_order ?? 0), accentColor: projectAccents.some((option) => option.value === accent) ? accent as ProjectInput["accentColor"] : "lime", monitoringEnabled: Boolean(project.monitoring_enabled), uptimeStartDate: string("uptime_start_date") || new Date().toISOString().slice(0, 10), healthUrl: string("health_url") || string("live_url"), healthMethod: string("health_method") === "HEAD" ? "HEAD" : "GET", healthTimeoutMs: Number(project.health_timeout_ms ?? 10000), expectedStatusMin: Number(project.expected_status_min ?? 200), expectedStatusMax: Number(project.expected_status_max ?? 399), coverAltEn: string("alt_en"), coverAltEs: string("alt_es") };
}

function formatAdminDate(value: string) {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}
