#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

day="${1:-}"

if [[ ! "$day" =~ ^[1-5]$ ]]; then
  echo "Usage: $0 {1|2|3|4|5}" >&2
  exit 2
fi

git reset --quiet

case "$day" in
  1)
    git add -- \
      .gitignore \
      frontend/eslint.config.mjs \
      frontend/next.config.ts \
      frontend/package-lock.json \
      frontend/package.json \
      frontend/playwright.config.ts \
      frontend/tsconfig.json \
      backend/package-lock.json \
      backend/package.json \
      backend/tsconfig.json \
      package-lock.json \
      package.json \
      packages/contracts/package.json \
      packages/contracts/src/index.ts \
      packages/contracts/tsconfig.json \
      docs/COMMIT-PLAN.md \
      scripts/commit-progress.sh
    message="build: migrate to workspace monorepo"
    ;;
  2)
    git add -- \
      backend/src/app.ts \
      backend/src/auth/index.test.ts \
      backend/src/auth/index.ts \
      backend/src/auth/session-store.ts \
      backend/src/config.ts \
      backend/src/db/index.ts \
      backend/src/db/schema.ts \
      backend/src/http/routes.ts \
      backend/src/index.ts \
      backend/src/projects/repository.test.ts \
      backend/src/projects/repository.ts
    message="feat: add project persistence and admin API"
    ;;
  3)
    git add -- \
      backend/src/coolify/client.test.ts \
      backend/src/coolify/client.ts \
      backend/src/media/service.test.ts \
      backend/src/media/service.ts \
      backend/src/monitoring/monitor.test.ts \
      backend/src/monitoring/monitor.ts
    message="feat: integrate Coolify sync and monitoring"
    ;;
  4)
    git add -- \
      frontend/e2e/dashboard.e2e.ts \
      'frontend/src/app/[locale]/layout.tsx' \
      'frontend/src/app/[locale]/page.tsx' \
      frontend/src/app/admin/page.tsx \
      frontend/src/app/globals.css \
      frontend/src/app/layout.tsx \
      frontend/src/app/not-found.tsx \
      frontend/src/app/page.tsx \
      frontend/src/app/sitemap.ts \
      frontend/src/components/dashboard/dashboard.tsx \
      frontend/src/components/providers.tsx \
      frontend/src/lib/admin-form.test.ts \
      frontend/src/lib/admin-form.ts \
      frontend/src/lib/api.test.ts \
      frontend/src/lib/api.ts \
      frontend/src/lib/demo-projects.test.ts \
      frontend/src/lib/demo-projects.ts \
      frontend/src/lib/messages.test.ts \
      frontend/src/lib/messages.ts \
      frontend/src/lib/project-accents.test.ts \
      frontend/src/lib/project-accents.ts \
      frontend/src/proxy.ts
    message="feat: add bilingual project dashboard"
    ;;
  5)
    git add -- \
      .dockerignore \
      .env.example \
      DESIGN-sentry.md \
      Dockerfile \
      README.md \
      backend/Dockerfile \
      compose.yml \
      docs/PRODUCT-DESIGN.md \
      frontend/AGENTS.md \
      frontend/CLAUDE.md
    message="chore: add deployment configuration and documentation"
    ;;
esac

if git diff --cached --quiet; then
  echo "No files are available for day $day."
  exit 1
fi

echo "Staged for day $day:"
git diff --cached --stat
git commit -m "$message"
