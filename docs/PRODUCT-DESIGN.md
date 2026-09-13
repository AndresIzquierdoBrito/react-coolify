# Izbri Projects — Product and Design Reference

This document is the living reference for product, identity, interaction, and design decisions for `projects.izbri.com`. Any future directive that changes these areas must be recorded here in the same change that implements it.

`DESIGN-sentry.md` is the authoritative aesthetic philosophy and token source. The Excalidraw frames are functional layout references, not instructions to create a hand-drawn visual style.

## Product purpose

Izbri Projects is a public, bilingual portfolio and reliability dashboard. Visitors can discover live applications and services, understand their technology and purpose, see independently measured availability, and open the live product or an external case study. A private owner interface curates Coolify resources without controlling their deployment lifecycle.

Primary audience: potential collaborators, clients, employers, and technically curious visitors. The experience should communicate craft, transparency, operational care, and personality without reading like an infrastructure console.

## Visual identity

- Light mode uses warm-white project surfaces with deep-purple ink and the original Sentry-inspired accents.
- Dark mode is a deliberately neutral black and charcoal canvas paired with lemon green. Purple is not used as a dark-mode surface or emphasis color.
- Rubik is the primary UI and display family; JetBrains Mono is reserved for metric values and technical microcopy. Both are self-hosted at build time through `next/font` with system fallbacks.
- Cards use confident outlines, generous rounded corners, subtle offset shadows, diagonal media boundaries, and restrained decorative marks.
- Status must never rely on color alone. Every state includes text and an icon or shape.
- Motion is brief and purposeful; reduced-motion users receive immediate state changes.

## Public interaction model

- Public locale routes are `/en` and `/es`; `/` redirects from preference or browser language.
- The header contains four compact controls: filter, sort, language, and theme.
- Default project order is curated in admin. Alternative sorts are name, uptime, and newest.
- Filters cover health status, technology, and Coolify resource type.
- Desktop cards are horizontal: identity/stack, operational summary, then project art separated by a diagonal edge.
- Selecting a card keeps the list visible and opens a sticky detail card on the right. The selected slug lives in the query string.
- On narrow screens cards stack their regions and project details open as a full-screen sheet.
- Project art opens the live application. Case-study and repository actions are explicit external links.

## Monitoring semantics

- Availability is measured independently from Coolify once per minute.
- One or two consecutive failures are `degraded`; three are `offline`; one success recovers the project.
- `collecting` means monitoring has begun but insufficient history exists. `unknown` means monitoring is disabled or has never completed.
- Consecutive uptime begins with the first success after the most recent confirmed incident. No uptime is claimed before this dashboard started monitoring.
- First-release public time-series metrics are uptime and response latency. Safe Sentinel capability, timing, and last-pulse metadata may be synchronized through Coolify, but raw CPU/RAM history remains private until Coolify provides a stable read API.

## Admin and content rules

- Coolify applications and services may be imported, but all Coolify access is read-only.
- Imports start as drafts. Coolify synchronization never overwrites authored content.
- Published projects require English and Spanish titles, summaries, descriptions, cover alt text, one cover image, and a valid live URL.
- Images are uploaded to the persistent application volume and optimized into responsive variants. The cover remains a distinct required publishing asset; the expanded carousel uses the cover followed by up to 12 separately uploaded bilingual gallery images.
- External case studies are optional. Internal case-study authoring is outside the first release.

## Responsive and accessibility rules

- Support 320px phones through wide desktop layouts without horizontal page overflow.
- Interactive targets are at least 44px. Focus is always visible. Dialogs trap focus and restore it when closed.
- Browser Back closes URL-driven project details. Escape closes popovers and sheets.
- Both themes meet WCAG AA contrast for body text and controls. Charts include readable summaries.

## Decision log

### 2026-08-15 — Foundation

- Adopted the Sentry-inspired design philosophy in `DESIGN-sentry.md`.
- Chose English/Spanish prefixed public routes and persistent light/dark themes.
- Chose independent uptime/latency monitoring with a three-failure outage threshold.
- Chose SQLite plus volume-backed media, GitHub OAuth allowlisting, Coolify applications and services, external case-study links, and curated default ordering.

### 2026-08-15 — Header, dark palette, and temporary access

- Removed the public “Live portfolio” eyebrow and moved the Izbri Projects identity closer to the top edge.
- Replaced dark-mode purple surfaces with a black, charcoal, and lemon-green palette. Light mode retains the original Sentry-inspired interpretation.
- Added temporary environment-configured username/password access to `/admin` while retaining GitHub OAuth as an optional future login method.

### 2026-08-16 — Empty catalog preview and resilient Coolify sync

- When no real project is published, show three clearly identified sample cards with localized summaries, varied health states, uptime history, technologies, and complete expanded details. Sample cards disappear automatically after the first real project is published.
- Synchronize Coolify applications and services independently. A failure from one catalog endpoint must not discard resources returned by the other or erase the last successful local snapshot.
- Admin synchronization errors must identify configuration, authorization, permission, network, timeout, or untrusted-certificate causes without revealing tokens or infrastructure response bodies.

### 2026-08-16 — Card actions, motion, carousel, and missing routes

- The diagonal project-art cutout must reveal the uptime section color beneath it, with no mismatched wedge between metrics and artwork.
- Clicking the card body opens project details; the arrow icon is a separate accessible link that opens the live application directly.
- Expanded project artwork is an automatic uploaded-media carousel with previous/next arrows, direct slide controls, hover/focus pausing, a five-second interval, and no autoplay under reduced-motion preferences.
- Use GSAP for restrained card-entry, panel-opening, backdrop, and carousel transitions. Motion must remain short, subtle, interruptible, and disabled when reduced motion is requested.
- Unknown routes use a designed bilingual 404 experience with an obvious route back to the project dashboard.
- Safe Coolify context may include build type, branch, short commit SHA, resource update time, catalog sync time, and the raw Coolify runtime label. Never present the raw runtime label as independently measured public health.

### 2026-08-16 — Curated names, project accents, and mobile controls

- Coolify resource names are immutable source references only. English and Spanish public project names are explicitly editable in admin and are never overwritten by synchronization.
- Every project has one curated accent from the approved fourteen-color bright palette recorded below.
- Project accents may color media, selection rings, carousel art, metadata highlights, and decorative details. Operational health colors retain their universal meanings and never inherit project accents.
- On phones, center all four header controls as a group and present the language control as a centered `EN` or `ES` label without the language glyph.
- Sentinel keeps its initial `10s` sampling, `7 day` history, and `60s` push settings while the feature remains experimental. Sentinel CPU/RAM data remains outside public cards until a stable, bounded adapter exists.

### 2026-08-16 — Izbri identity, uploaded galleries, metric clarity, and expanded accents

- The footer carries the `izbri.com™` identity, current copyright year, Canary Islands signature, and 44px icon links to `izbri.com`, Andrés Izquierdo Brito's LinkedIn profile, and GitHub account.
- The sort popover aligns its left edge to the sort trigger so it opens toward the right when viewport space allows.
- Remove the 90-day reliability summary. Details retain 24-hour, 7-day, 30-day, and all-time views.
- Response-time charts use a near-black plot surface, light labels, a stronger accent stroke, and a subtle baseline so every project accent remains legible in both themes.
- The diagonal card artwork must not draw a border beyond its clipped polygon. Color may meet the uptime surface at the diagonal, but no black sliver may bleed from its bottom-left corner.
- Expanded carousels display actual owner-uploaded media rather than generated status/technology slides. The required cover is first; optional uploaded images follow in curated order. JPEG, PNG, WebP, and AVIF uploads are normalized to AVIF, while validated GIF uploads preserve animation. Every gallery item requires English and Spanish alternative text.
- Expand the approved accent palette from seven to fourteen colors while retaining the lemon-neon family: electric lime, volt chartreuse, laser mint, plasma aqua, acid cyan, digital turquoise, signal blue, electric periwinkle, lemon flash, solar amber, neon tangerine, hot coral, laser raspberry, and neon pink.
- Confirmed incidents report start time, open/recovered state, end time and duration when recovered, plus the triggering HTTP status or monitor error. One or two failures remain a degraded signal and never become incidents; the third consecutive failure opens one, and the next success closes it.
- Synchronize only non-secret Sentinel status: enabled state, metrics-enabled state, refresh rate, retention days, push interval, and last reported pulse. Never persist or expose the Sentinel token, custom internal URL, server IP, or raw infrastructure payloads.

### 2026-08-16 — Maintenance, deployments, incident emphasis, and preview behavior

- Response-time charts follow the active theme: light mode uses a softly tinted light surface with dark labels, while dark mode retains the near-black plotting surface. The project-colored trend line is thicker and mixed with dark ink in light mode to preserve contrast.
- Every project may carry an optional maintenance message. If used for a published project, the message must be complete in both English and Spanish and appears on both the list card and expanded detail.
- Coolify applications expose a compact deployment-in-progress signal and the timestamp of the most recent successful deployment. These values are synchronized from deployment history and remain separate from independently measured health.
- An active confirmed monitor incident receives a deliberately high-salience yellow-and-black hazard banner. The banner supplements, rather than replaces, semantic status text and incident details.
- Project-list cards animate only when the list first appears. Opening the detail panel and switching between projects animate the expanded content independently without replaying the list entrance.
- Admin preview means “save and preview.” It persists the current form, then opens an authenticated English public-rendered preview that works for drafts as well as published projects; it does not bypass normal publication validation.
- Sentinel metrics-enabled state and latest pulse are synchronized and displayed after an admin catalog sync. Raw CPU/RAM history is still withheld until Coolify offers a stable, read-only external interface for it.

### 2026-08-16 — Operational strips, owner contact, flags, and admin feedback

- Operational notices occupy a full-width yellow-and-black hazard strip across the top of the project card and expanded panel. Confirmed monitor incidents take priority; an owner may also publish a bilingual maintenance, restart, or update notice. Automatic Coolify deployments appear as update activity when no higher-priority notice is active.
- Every project provides a persistent “Report a problem” action, whether or not an incident is active. Active operational strips explicitly ask affected users to contact the owner. Reports use the configured `OWNER_CONTACT_URL`, include project context, and fall back to `izbri.com`.
- Expanded deployment metadata uses “Last synchronized” as the sixth baseline fact so the common grid has an even number of cells. Resource update time, monitoring start time, and Sentinel pulse remain valid future alternatives when their meaning is more useful for a particular view.
- Replace the `EN`/`ES` language text with compact Spain and United Kingdom SVG flags from the locally bundled `country-flag-icons` package. The accessible label continues to name the language-switch action; flags are decorative and never the only accessible meaning.
- Admin project forms preserve free typing in comma-separated technology lists. File pickers use explicit buttons rather than hidden-label behavior, and missing gallery alternative text produces a visible explanation instead of silently disabling upload.
- Client and server validation issues map to their specific form controls. Invalid controls receive a red border, an inline message, focus, and scroll positioning; the global toast summarizes the action instead of replacing field-level guidance.

### 2026-08-16 — Deterministic details, local preview, and monitoring clarity

- The Spanish product title is “Izbri Proyectos.”
- Project titles must wrap inside their assigned identity region at every viewport and must never overlap metrics, artwork, panel controls, or neighboring grid cells.
- The detail close action removes its URL state deterministically and restores focus. Its 44px target is visually unframed, using a heavier X stroke without a circular background or border.
- Admin Preview is a non-persistent, browser-local rendering of the current form. It never updates the database or public dashboard and includes a persistent route back to the same editor. Save is the only project-form action that mutates the real project.
- A published save must be visible on the next public dashboard load; the project feed is not held behind a client-side revalidation window.
- “Collecting data” means monitoring is enabled but no health-check result exists yet. A published project normally receives its first result within one monitoring interval (one minute plus bounded jitter and request time); availability and latency become progressively more representative as minute-level checks accumulate.

### 2026-08-16 — Precise publishing feedback and edit awareness

- Publication validation highlights only the fields that are actually missing or invalid. A complete English or Spanish value must never inherit a generic bilingual error caused by a different empty field.
- Every unsaved admin form value uses a distinct lime-tinted field surface, inset marker, and “Edited” label compared with its last saved value. The sticky editor header also reports the total number of unsaved fields, and all indicators clear after a successful save or when a value is restored.

### 2026-08-16 — Notice hierarchy and durable editing

- Operational notices have a severity hierarchy rather than sharing one hazard treatment: confirmed incidents retain the high-salience yellow-and-black danger strip; maintenance uses a related but calmer amber service treatment; restarts use a distinct blue technical-status treatment; and updates use a compact lime informational strip.
- Restart and update notices do not repeat an intrusive contact action because every card already retains its persistent problem-report action. Incident and maintenance notices may surface owner contact directly.
- Published notice type and bilingual notice copy refresh when the dashboard regains focus and at a 30-second interval, without relying on a stale public response cache.
- Cover uploads, carousel uploads/deletions/reordering, and failed ordering refreshes must preserve every unrelated unsaved form value. Returning from a local preview restores that preview form in the editor. Switching projects with unsaved changes requires explicit confirmation, and closing the browser receives the native unsaved-change warning.

### 2026-09-13 — Multi-team Coolify catalog

- Coolify connections are team-scoped, read-only, independently enabled, and labeled with a human-readable team name. Managed tokens are encrypted at rest and are write-only in the admin interface; the existing environment URL/token remain the backward-compatible deployment-managed default.
- Applications, services, and Sentinel servers are namespaced by team so identical Coolify UUIDs cannot collide. Public projects display their owning team and expose a team filter alongside status, technology, and resource type.
- Synchronization runs each enabled team independently. Successful teams remain visible when another team is unavailable; partial and failed teams retain their previous local snapshot. The admin control room shows each team's status, last attempt, last full success, and sanitized warnings.
- Disabling a team hides its projects and pauses their independent monitoring without deleting authored project data, media, or historical measurements.
