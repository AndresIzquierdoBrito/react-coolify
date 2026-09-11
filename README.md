# Izbri Projects

A bilingual public portfolio and independent uptime dashboard for the applications and services running in Izbri's Coolify installation.

## Architecture

- `frontend`: Next.js visitor dashboard and owner interface.
- `backend`: Express API, temporary credential sessions with optional GitHub OAuth, Coolify catalog adapter, SQLite persistence, media processing, and availability worker.
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

The web app runs at `http://localhost:3000` and the API at `http://localhost:3001`. Configure `ADMIN_USERNAME` and a long, unique `ADMIN_PASSWORD` to use the temporary `/admin` login. GitHub OAuth remains optional; for local OAuth, use callback `http://localhost:3000/api/v1/auth/github/callback` and set `APP_ORIGIN=http://localhost:3000`.

The default development database is `backend/data/projects.sqlite`. Set `DATABASE_PATH` and `UPLOADS_PATH` to override it.

## Coolify deployment

1. Create a Git-based **Docker Compose** application, select this repository and branch, and set the Compose location to `/compose.yml`.
2. Create a Coolify team API token with read-only permissions. In the application's environment variables, set `COOLIFY_API_URL`, `COOLIFY_API_KEY`, `APP_ORIGIN`, a random `SESSION_SECRET` of at least 24 characters, and `OWNER_CONTACT_URL`. Keep secrets runtime-only. Coolify recognizes the `:?` declarations in `compose.yml` and will block a deploy if a required value is empty.
3. Choose at least one owner login method: set `ADMIN_USERNAME` plus a long, unique `ADMIN_PASSWORD`, or configure all three GitHub values. The GitHub OAuth callback is `<APP_ORIGIN>/api/v1/auth/github/callback`.
4. Assign the public domain to the `frontend` service's internal port `3000`. Do not assign a domain or publish a host port for `backend`; Next proxies `/api`, `/media`, and `/healthz` over the private Compose network.
5. Deploy and wait for both Compose health checks to pass. Verify `https://your-domain.example/healthz`, `/en`, and `/admin`. The health endpoint should return `{"ok":true}`.
6. Keep the backend at one replica because SQLite and uploaded media share the automatically managed `project_data` volume. Back up that volume before upgrades or migrations.

The default monitor and catalog-sync intervals are exposed as `MONITOR_INTERVAL_MS` and `COOLIFY_SYNC_INTERVAL_MS`. Change them only after measuring the load. See Coolify's [Docker Compose deployment guide](https://coolify.io/docs/applications/builds/docker-compose) for how the platform handles domains, required variables, health checks, internal networking, and persistent volumes.

The first catalog synchronization runs at startup and repeats every five minutes. Imports remain drafts until both locales and a cover image are complete.

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
docker compose -f compose.yml config
```
