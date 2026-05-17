#!/usr/bin/env bash
# Idempotent deploy script. Called by:
#   - human manually on the VM
#   - .github/workflows/deploy.yml via SSH on every push to main
set -euo pipefail

REPO_PATH="${REPO_PATH:-${HOME}/ai-feedme}"
COMPOSE_FILE="docker-compose.prod.yml"

cd "$REPO_PATH"

echo "==> git fetch + reset to origin/main"
git fetch origin main
git reset --hard origin/main

if [ ! -f .env ]; then
  echo "ERROR: $REPO_PATH/.env not found. Create it from .env.example first." >&2
  exit 1
fi

echo "==> docker compose up (rebuilding changed images)"
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

echo "==> sleeping 5s for containers to settle"
sleep 5

echo "==> health checks"
echo "    /api/health (via container network)"
docker compose -f "$COMPOSE_FILE" exec -T app sh -c 'wget -qO- http://localhost:8002/health' || true
echo ""
echo "    container status"
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "==> deploy done. visit https://feedme.carrickcheah.com"
