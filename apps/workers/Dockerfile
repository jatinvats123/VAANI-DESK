# syntax=docker/dockerfile:1
# Build from the REPO ROOT:  docker build -f apps/workers/Dockerfile .
# SIGTERM waits for in-flight jobs (BullMQ worker.close()) — safe to roll.

FROM node:22-alpine AS base
RUN npm install -g pnpm@10.14.0
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/workers/package.json apps/workers/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @vaanidesk/workers...

FROM deps AS runtime
COPY packages/shared packages/shared
COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/workers apps/workers
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@vaanidesk/workers", "start"]
