# DEPLOY.md

Production deployment of FeedMe to a single Azure VM behind Caddy + auto-SSL.

## Target

- VM: **ai-kiss-me** (`4.193.106.142`, Singapore, Ubuntu 24.04, 8 vCPU / 32 GB)
- Public URL: **https://feedm.carrickcheah.com**
- DNS: Cloudflare A record `feedm.carrickcheah.com → 4.193.106.142` (proxy OFF — Caddy needs direct ACME challenge)

## What runs in production

| Container | Internal port | Notes |
|---|---|---|
| caddy | :80, :443 (host) | Reverse proxy, auto Let's Encrypt SSL |
| app | :8002 | Bun main app (chat API + dashboard stats) |
| mcp | :4001-4014 | All 4 MCP servers in one container via `concurrently` |
| memgc | :8003 | Python FastAPI sidecar (PRISM retrieval) |
| redis | :6379 | MemGC answer cache, TTL 300s |

**Kafka is intentionally omitted** — the in-process fallback handles single-VM event delivery identically from the user's POV. Saves 500 MB RAM + JVM setup.

## First-time setup (one-off)

### 1. DNS (Cloudflare)

Add an A record:
```
Name:  feedm
Type:  A
IPv4:  4.193.106.142
Proxy: OFF (DNS only)
TTL:   Auto
```

`Proxy: OFF` is critical — Cloudflare's proxy intercepts port 80 and breaks Caddy's ACME HTTP-01 challenge. Once SSL is established and stable, you can flip Proxy ON for DDoS protection if you want.

### 2. Bootstrap the VM

SSH in:
```bash
ssh feedme@4.193.106.142
```

Run the bootstrap script (downloaded via curl):
```bash
curl -fsSL https://raw.githubusercontent.com/carrickcheah/ai-feedme/main/deploy/setup-vm.sh | bash
```

This installs Docker + Compose plugin, clones the repo to `~/ai-feedme`.

### 3. Create `.env` on the VM

```bash
cd ~/ai-feedme
cp .env.example .env
nano .env
```

Set production values:
- `AZURE_OPENAI_API_KEY` — your real key
- `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` — production keys
- `INTERNAL_SERVICE_SECRET` — rotate from dev default
- Leave `MCP_*_URL` and `REDIS_URL` blank or default — docker-compose.prod.yml overrides them with container service names

### 4. First deploy

```bash
newgrp docker            # so feedme user can use docker without sudo (only this session — relogin fixes for future)
bash deploy/deploy.sh
```

Wait ~60s for first build + SSL cert provisioning. Then:
```bash
curl -fsS https://feedm.carrickcheah.com/api/health
# {"status":"ok","service":"feedme-app",...}
```

## Continuous deployment (GitHub Actions)

After initial setup, every push to `main` automatically deploys via `.github/workflows/deploy.yml`.

### Required GitHub Secrets

In repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `AI_KISS_ME_DEPLOY_KEY` | Contents of the deploy SSH private key (multi-line) |

The deploy key public counterpart is appended to `~/.ssh/authorized_keys` on the VM during initial setup.

### Generate the deploy key (Mac)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/feedme_deploy -C "feedme-ci-deploy" -N ""
cat ~/.ssh/feedme_deploy.pub | ssh feedme@4.193.106.142 'cat >> ~/.ssh/authorized_keys'
cat ~/.ssh/feedme_deploy   # paste this into the GitHub Secret AI_KISS_ME_DEPLOY_KEY
```

### Workflow flow

1. Developer pushes to `main`
2. GitHub Action runs on `ubuntu-latest`
3. Loads `AI_KISS_ME_DEPLOY_KEY` into ssh-agent
4. SSHs to `feedme@4.193.106.142`
5. Runs `bash ~/ai-feedme/deploy/deploy.sh`
6. `deploy.sh` does: `git reset --hard origin/main` + `docker compose up -d --build --remove-orphans`
7. Health check via `curl https://feedm.carrickcheah.com/api/health`
8. Pass → green ✓ in GitHub; Fail → red ✗ + you SSH in to inspect

Total deploy time: ~30–90s (mostly Bun image rebuild when src/ changes).

## Operations

| Task | Command |
|---|---|
| Tail logs (all) | `docker compose -f docker-compose.prod.yml logs -f` |
| Tail one service | `docker compose -f docker-compose.prod.yml logs -f caddy` |
| Restart one service | `docker compose -f docker-compose.prod.yml restart app` |
| Rebuild + restart | `bash deploy/deploy.sh` |
| Full stop | `docker compose -f docker-compose.prod.yml down` |
| Wipe SQLite + start fresh | `docker compose down -v` (destroys feedme_data volume!) |
| SSH session | `ssh feedme@4.193.106.142` |
| Check disk | `df -h && du -sh ~/ai-feedme/data` |

## Cost

VM: Standard_D8s_v3 in southeastasia ≈ **$381/mo** on-demand (covered by Microsoft Azure Sponsorship credits).

Strategies to save credits when not demoing:
- `az vm deallocate -g RG-AI-KISS-ME -n ai-kiss-me` — pauses billing for compute (storage still ~$5/mo)
- Resume: `az vm start -g RG-AI-KISS-ME -n ai-kiss-me`

## Troubleshooting

**SSL cert won't issue.** Check Caddy logs: `docker compose logs caddy`. Common causes: Cloudflare proxy is ON (turn OFF), DNS hasn't propagated (`dig feedm.carrickcheah.com` — should return the VM IP), port 80 blocked at NSG (we opened it; recheck `az vm open-port`).

**`docker compose up` fails on memgc build.** The build context is `../` so the parent directory must contain `memgc/memgc-py/`. On the VM, the repo is at `~/ai-feedme` so `../` is `~/`. Clone memgc to `~/memgc` if you want memgc-service to build there; otherwise comment out the `memgc` service and the app falls back to no-memory mode gracefully.

**Bun image too big.** Switch base image from `oven/bun:1.3.13-alpine` to `oven/bun:1.3.13-distroless` (saves ~80 MB).

**Health check fails after deploy.** SSH in, run `docker compose ps` — check which container is unhealthy. Most common: `app` is up but can't reach `memgc` (memgc takes ~30s to load bge-m3 weights on first start). Usually self-resolves within a minute.
