#!/usr/bin/env bash
# Запуск индексера через docker. Вызывается systemd таймером.
# Может также вызываться вручную:
#   SOURCE=gutenberg PAGES=20 START_PAGE=1 ./run-indexer.sh

set -euo pipefail

cd "$(dirname "$0")/.."  # backend root

# подгружаем секреты из .env
set -a
# shellcheck disable=SC1091
. ./.env
set +a

SOURCE_ARG="${SOURCE:-gutenberg}"
PAGES_ARG="${PAGES:-20}"
START_PAGE_ARG="${START_PAGE:-1}"

echo "[indexer] $(date -Is) — source=${SOURCE_ARG} pages=${PAGES_ARG} start=${START_PAGE_ARG}"

sudo -n docker run --rm \
  --network backend_aziral-books-internal \
  -v "$(pwd)":/app -w /app \
  -e DATABASE_URL="postgres://aziral:${POSTGRES_PASSWORD}@aziral-books-postgres:5432/aziral_books" \
  -e MEILI_HOST="http://aziral-books-meili:7700" \
  -e MEILI_MASTER_KEY="${MEILI_MASTER_KEY}" \
  -e JWT_SECRET="${JWT_SECRET}" \
  -e SOURCE="${SOURCE_ARG}" \
  -e PAGES="${PAGES_ARG}" \
  -e START_PAGE="${START_PAGE_ARG}" \
  node:22-alpine sh -c '
    corepack enable >/dev/null 2>&1
    corepack prepare pnpm@11.1.1 --activate >/dev/null 2>&1
    pnpm install --ignore-scripts --silent
    pnpm index:sync
  '

echo "[indexer] $(date -Is) — done"
