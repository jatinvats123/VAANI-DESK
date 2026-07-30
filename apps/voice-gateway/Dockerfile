# syntax=docker/dockerfile:1
# Build from the REPO ROOT:  docker build -f apps/voice-gateway/Dockerfile .
# Stateful service (ADR-0002): deploy with drain — SIGTERM lets active calls
# finish (DRAIN_TIMEOUT_MS); give the orchestrator a matching grace period.

FROM node:22-alpine AS base
RUN npm install -g pnpm@10.14.0
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/voice-gateway/package.json apps/voice-gateway/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/agent/package.json packages/agent/
RUN pnpm install --frozen-lockfile --filter @vaanidesk/voice-gateway...

FROM deps AS runtime
COPY packages/shared packages/shared
COPY packages/core packages/core
COPY packages/agent packages/agent
COPY apps/voice-gateway apps/voice-gateway
ENV NODE_ENV=production
EXPOSE 4100
USER node
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4100/healthz || exit 1
CMD ["pnpm", "--filter", "@vaanidesk/voice-gateway", "start"]
