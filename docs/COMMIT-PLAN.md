# Daily commit plan

The current working tree is one large staged change. Use the helper script to turn it into five coherent commits over five days. The script never pushes; push after verifying each commit.

## Day 1 — workspace foundation

```bash
./scripts/commit-progress.sh 1
git push -u origin develop
```

Commit: `build: migrate to workspace monorepo`

This establishes the npm workspace, shared contracts, package configuration, TypeScript configuration, and frontend tooling.

## Day 2 — backend application foundation

```bash
./scripts/commit-progress.sh 2
git push
```

Commit: `feat: add project persistence and admin API`

This adds configuration, SQLite/Drizzle persistence, project repositories, authentication, HTTP routes, and the backend application entrypoint.

## Day 3 — Coolify and operations

```bash
./scripts/commit-progress.sh 3
git push
```

Commit: `feat: integrate Coolify sync and monitoring`

This adds the Coolify client, media processing, availability monitoring, and their tests.

## Day 4 — visitor and admin experience

```bash
./scripts/commit-progress.sh 4
git push
```

Commit: `feat: add bilingual project dashboard`

This adds the localized pages, dashboard, admin UI, API helpers, demo data, messages, styling, and browser test.

## Day 5 — deployment and documentation

```bash
./scripts/commit-progress.sh 5
git push
```

Commit: `chore: add deployment configuration and documentation`

This adds Docker and Compose configuration, environment documentation, product/design references, and project guidance files.

## Before each push

Run the checks relevant to the day. Before the final push, run the complete suite:

```bash
npm run typecheck
npm run lint
npm test
npm run build
docker compose -f compose.yml config
```

The helper resets the index before staging a day’s batch, which preserves file contents but discards existing staging choices. Do not mix unrelated staged work into this sequence.
