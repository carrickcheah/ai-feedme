# FeedMe Bun app — multi-stage build
# (Used for deployment; local dev runs `bun run dev` directly on host.)

FROM oven/bun:1-alpine AS base
WORKDIR /app

# ----- Dependencies -----
FROM base AS deps
COPY package.json bun.lock* ./
# Include devDeps — runtime needs `concurrently` (devDep) for `bun run mcp:all`.
# Image stays small; concurrently + TS types are <5 MB.
RUN bun install --frozen-lockfile

# ----- Builder -----
FROM base AS builder
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run typecheck

# ----- Runtime -----
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8002
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock* ./
COPY src ./src
COPY mcp-servers ./mcp-servers
COPY scripts ./scripts
COPY tsconfig.json bunfig.toml ./

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8002/health || exit 1

CMD ["bun", "src/index.ts"]
