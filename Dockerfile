# Outreach Engine — one image for the website (next start) and the worker (tsx src/worker/index.ts).
# docker-compose.yml starts the same image twice with a different command.

ARG NODE_VERSION=24-alpine

# ---- 1. All dependencies (needed to build) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# mongodb-memory-server (tests only) would otherwise download a ~600 MB MongoDB binary.
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. Production build of the website ----
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No secrets needed here: env is validated on first use at runtime, not at build time.
# .next/cache is only the build cache (~110 MB) — not needed to run.
RUN npm run build && rm -rf .next/cache

# ---- 3. Runtime dependencies only (tsx included: the worker and scripts run with it) ----
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- 4. Final image ----
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

COPY --chown=node:node package.json package-lock.json next.config.ts tsconfig.json ./
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/.next ./.next
# The worker and the maintenance scripts run from source with tsx.
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Website by default; docker-compose.yml overrides this for the worker and the setup step.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
