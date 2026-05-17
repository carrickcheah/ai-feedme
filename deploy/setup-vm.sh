#!/usr/bin/env bash
# One-time VM bootstrap. Run on a fresh Ubuntu 24.04 VM as the `feedme` user.
# Installs Docker + Compose plugin, clones the repo to ~/ai-feedme.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/carrickcheah/ai-feedme.git}"
REPO_PATH="${HOME}/ai-feedme"

echo "==> apt-get update + base packages"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git gnupg

echo "==> install Docker (official repo)"
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "==> add $USER to docker group (re-login or newgrp to take effect)"
sudo usermod -aG docker "$USER"

echo "==> clone ai-feedme to $REPO_PATH"
if [ ! -d "$REPO_PATH" ]; then
  git clone "$REPO_URL" "$REPO_PATH"
else
  cd "$REPO_PATH" && git pull
fi

MEMGC_PATH="${HOME}/memgc"
MEMGC_URL="${MEMGC_URL:-https://github.com/carrickcheah/memgc.git}"
echo "==> clone memgc to $MEMGC_PATH (bind-mounted into memgc-service container)"
if [ ! -d "$MEMGC_PATH" ]; then
  git clone "$MEMGC_URL" "$MEMGC_PATH" || echo "    (memgc clone failed — service will fall back to no-memory mode)"
else
  cd "$MEMGC_PATH" && git pull || true
fi

echo ""
echo "==> NEXT MANUAL STEPS:"
echo "  1. Create $REPO_PATH/.env from .env.example with production values"
echo "     (Azure key, Langfuse keys, etc — DO NOT commit)"
echo "  2. Re-login or run 'newgrp docker' so $USER can use docker without sudo"
echo "  3. cd $REPO_PATH && bash deploy/deploy.sh"
echo ""
echo "VM bootstrap complete."
