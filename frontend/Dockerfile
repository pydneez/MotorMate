# MotorMate frontend (Next.js + NextAuth) — production image for ECS Fargate.
#
# Build from the REPO ROOT (the frontend depends on packages/types in the pnpm workspace):
#   docker build -f frontend/Dockerfile -t motormate-frontend .
#
# Build argument (baked into the browser bundle):
#   NEXT_PUBLIC_API_URL  defaults to /v1 — on AWS the site and the API share one address
# Runtime environment (set by the ECS task definition; never baked into the image):
#   NEXTAUTH_URL      the site's public address, e.g. https://xxxx.execute-api.us-east-1.amazonaws.com
#   NEXTAUTH_SECRET   encrypts NextAuth's session cookie
#   API_INTERNAL_URL  how the Next.js server reaches the backend, e.g. http://<load balancer>/v1

# ── 1. Build: install the workspace, compile types, build the standalone server ──
FROM node:22-alpine AS build
# Next.js's recommended compatibility layer for its native SWC compiler on Alpine (build only).
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

# Manifests first so the dependency layer is cached until they change.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/types/package.json packages/types/
COPY frontend/package.json frontend/
# The root postinstall builds packages/types, so its sources must be present for install.
COPY packages/types/tsconfig.json packages/types/
COPY packages/types/src packages/types/src
RUN pnpm install --frozen-lockfile --filter frontend...

COPY frontend frontend
ARG NEXT_PUBLIC_API_URL=/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @motormate/types build && pnpm --filter frontend build

# ── 2. Runtime: only the standalone server and static assets, non-root user ──
FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# The standalone output mirrors the repo layout (traced from the root), so the server is
# frontend/server.js; static assets aren't part of it and are copied next to it.
COPY --from=build --chown=node:node /repo/frontend/.next/standalone ./
COPY --from=build --chown=node:node /repo/frontend/.next/static ./frontend/.next/static

USER node
EXPOSE 3000

# ECS and the load balancer use their own health checks; this one helps `docker ps` locally.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "frontend/server.js"]
