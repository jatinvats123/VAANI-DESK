# syntax=docker/dockerfile:1
# Build from the REPO ROOT:  docker build -f apps/api/Dockerfile .
# Workspace packages ship TS source (ADR-0001); tsx runs it in production —
# no build step means no stale-dist class of bugs, at ~50ms extra startup.

FROM node:22-alpine AS base
RUN npm install -g pnpm@10.14.0
WORKDIR /app

# Dependency layer: manifests only, so code edits don't bust the install cache.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @vaanidesk/api...

FROM deps AS runtime
COPY packages/shared packages/shared
COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/api apps/api
ENV NODE_ENV=production
EXPOSE 4000
USER node
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["pnpm", "--filter", "@vaanidesk/api", "start"]
