# MotorMate backend (NestJS + Prisma) — production image for ECS Fargate.
#
# Build from the REPO ROOT (the backend depends on packages/types in the pnpm workspace):
#   docker build -f backend/Dockerfile -t motormate-backend .
#
# Runtime environment (set by the ECS task definition; never baked into the image):
#   DATABASE_URL  postgresql://user:pass@host:5432/motormate   (RDS)
#   JWT_SECRET    signs/verifies the API access token
#   CORS_ORIGIN   the frontend's origin, e.g. https://main.xxxx.amplifyapp.com
#   PORT          defaults to 8080
# On start the container applies pending Prisma migrations, then starts the API.

# ── 1. Build: install the workspace, compile types + backend, make a prod-only bundle ──
FROM node:22-bookworm-slim AS build
# Prisma needs OpenSSL to detect the platform.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

# Manifests first so the dependency layer is cached until they change.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/types/package.json packages/types/
COPY backend/package.json backend/
# The root postinstall builds packages/types, so its sources must be present for install.
COPY packages/types/tsconfig.json packages/types/
COPY packages/types/src packages/types/src
RUN pnpm install --frozen-lockfile --filter backend...

COPY backend backend
# prisma.config.ts requires DATABASE_URL to be set, but generate never connects: a
# placeholder for these build steps only (not an ENV, so it isn't kept in the image).
ARG BUILD_DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @motormate/types build \
 && DATABASE_URL=$BUILD_DATABASE_URL pnpm --filter backend exec prisma generate \
 && pnpm --filter backend build

# A self-contained copy of the backend with production dependencies only
# (workspace packages like @motormate/types are copied in, not symlinked).
RUN pnpm --filter backend deploy --prod --legacy /prod/backend \
 && cd /prod/backend && DATABASE_URL=$BUILD_DATABASE_URL npx prisma generate

# ── 2. Runtime: small image, non-root user ──────────────────────────────────
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# NO_COLOR keeps CloudWatch logs free of terminal colour codes; dotenv has no .env to load here.
ENV NODE_ENV=production PORT=8080 NO_COLOR=1 DOTENV_CONFIG_QUIET=true
WORKDIR /app

COPY --from=build --chown=node:node /prod/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/backend/package.json ./package.json
COPY --from=build --chown=node:node /repo/backend/dist ./dist
COPY --from=build --chown=node:node /repo/backend/prisma ./prisma
COPY --from=build --chown=node:node /repo/backend/prisma.config.ts ./prisma.config.ts

USER node
EXPOSE 8080

# ECS and the load balancer use their own health checks; this one helps `docker ps` locally.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080)).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Migrations take a database lock, so two tasks starting together is safe.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main"]
