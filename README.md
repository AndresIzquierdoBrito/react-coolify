# Izbri Projects

A bilingual public portfolio and independent uptime dashboard for the applications and services running in Izbri's Coolify installation.

## Architecture

- `frontend`: Next.js visitor dashboard and owner interface.
- `backend`: Express API, GitHub OAuth owner sessions, Coolify catalog adapter, SQLite persistence, media processing, and availability worker.
- `packages/contracts`: shared Zod schemas and TypeScript response types.
- `docs/PRODUCT-DESIGN.md`: living product/design reference. Update it whenever identity, product, or interaction directives change.

Coolify is read-only. It supplies resource metadata and safe Sentinel capability/pulse settings; this application owns publication, bilingual content, images, uptime checks, incident history, and latency data.

## Local development

Requirements: Node.js 24 and npm.

```bash
cp .env.example backend/.env
npm install
npm run dev
```

The web app runs at `http://localhost:3000` and the API at `http://localhost:3001`. Production administration uses GitHub OAuth only; local development and tests may use the temporary `/admin` username/password fallback. For local OAuth, use callback `http://localhost:3000/api/v1/auth/github/callback` and set `APP_ORIGIN=http://localhost:3000`.

The default development database is `backend/data/projects.sqlite`. Set `DATABASE_PATH` and `UPLOADS_PATH` to override it.

## Coolify deployment

1. Create a Git-based **Docker Compose** application, select this repository and branch, and set the Compose location to `/compose.yaml`.
2. For the backward-compatible default connection, create a Coolify team API token with read-only permissions. Set `COOLIFY_API_URL` to a complete URL such as `https://coolify.example.com` (the application appends `/api/v1` automatically), `COOLIFY_API_KEY`, and optionally `COOLIFY_TEAM_NAME`. Additional teams are configured from the authenticated `/admin` control room. Set `COOLIFY_CREDENTIALS_KEY` to a base64-encoded 32-byte secret before saving managed teams; it encrypts their tokens at rest and is never returned by the API. Keep all secrets runtime-only.
3. Create a GitHub OAuth App with homepage `<APP_ORIGIN>` and callback `<APP_ORIGIN>/api/v1/auth/github/callback`. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_ADMIN_LOGINS` (production currently authorizes `AndresIzquierdoBrito`). The production container will not expose the password-login route.
4. Assign the public domain to the `frontend` service's internal port `3000`. Do not assign a domain or publish a host port for `backend`; Next proxies `/api`, `/media`, and `/healthz` over the private Compose network.
5. Deploy and wait for both Compose health checks to pass. Verify `https://your-domain.example/healthz`, `/en`, and `/admin`. The health endpoint should return `{"ok":true}`.
6. Keep the backend at one replica because SQLite and uploaded media share the automatically managed `project_data` volume. Back up that volume before upgrades or migrations.

The default monitor and catalog-sync intervals are exposed as `MONITOR_INTERVAL_MS` and `COOLIFY_SYNC_INTERVAL_MS`. Change them only after measuring the load. See Coolify's [Docker Compose deployment guide](https://coolify.io/docs/applications/builds/docker-compose) for how the platform handles domains, required variables, health checks, internal networking, and persistent volumes.

The first catalog synchronization runs at startup and repeats every five minutes. Each enabled Coolify team is synchronized independently; an unavailable team retains its last local snapshot while other teams continue updating. Imports remain drafts until both locales and a cover image are complete.

Team ownership remains internal to Coolify synchronization and catalog management. It is not exposed as a project label or public filter. Disabling a team hides its projects and pauses their independent uptime checks without deleting project content or history. Team sync status and last successful synchronization time are visible only in the admin control room.

Managed-team tokens can be rotated from the admin connection form by entering a replacement token; leaving the field blank keeps the encrypted token already stored. Keep `COOLIFY_CREDENTIALS_KEY` backed up when restoring the SQLite volume, because it is required to decrypt managed tokens.

Each project's Availability section includes an editable **Uptime start date**. New imports default this UTC calendar date from the Coolify resource creation date (or the import date when Coolify does not provide one). Time between that date and the first recorded health check is shown as assumed-perfect history; measurements after monitoring begins remain measured, and missing checks are never counted as successful. Days before the configured date are unknown. The date cannot be moved into the future or past the first real check, so changing it cannot erase monitoring history.

### Sentinel

Keep Sentinel's initial `10` second metrics rate, `7` day history, and `60` second push interval unless host load or storage measurements show a reason to change them. Catalog sync reads the server's non-secret Sentinel state and associates it with projects through their Coolify server UUID. It stores enabled/metrics-enabled state, timing settings, and the last pulse; tokens, internal URLs, IPs, and raw payloads are discarded.

Coolify's own implementation reads CPU/RAM history by executing a request inside the Sentinel container, and the public API does not currently expose those time series. This dashboard therefore does not scrape an undocumented internal endpoint or mislabel server-wide CPU/RAM as per-project availability. Uptime and latency continue to come from the dashboard's independent monitor.

### Project media

The required cover is optimized into AVIF/WebP variants. In `/admin`, add up to 12 bilingual carousel images per project, reorder or remove them, and upload animated GIFs without stripping their animation. The backend validates the decoded image format rather than trusting the filename or browser-provided MIME type.

### Coolify connection troubleshooting

- Use the full HTTPS origin; `/api/v1` is added automatically when omitted.
- Enable API access in Coolify and use the complete `ID|secret` token with `read` permission. The token must belong to the team containing the projects.
- A `401` means the token is invalid; `403` means its permission or the Coolify API IP allowlist rejected the backend.
- Coolify must present a certificate trusted by the backend container. For a private CA, mount its PEM into the backend and set `NODE_EXTRA_CA_CERTS` to that in-container path. Do not disable TLS verification.
- Applications and services synchronize independently. A service endpoint unavailable in a particular Coolify release no longer prevents applications from importing.

## Backup and restore

Pause the backend container before taking a filesystem-level backup so the SQLite database and uploads are consistent. Back up the entire `/data` volume, which contains `projects.sqlite`, its WAL files, and `uploads/`. Restore that directory to a new `project_data` volume with ownership matching the container's `node` user, then start the backend and verify `/readyz`.

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
docker compose -f compose.yaml config
```
