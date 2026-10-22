# MotorMate backend (NestJS + Prisma) — production images for ECS Fargate.
#
# Build from the REPO ROOT (the backend depends on packages/types in the pnpm workspace):
#   docker build -f backend/Dockerfile -t motormate-backend .                    # the API
#   docker build -f backend/Dockerfile --target migrate -t motormate-migrate .   # migrations
#
# Two images from one Dockerfile, so the API doesn't carry the Prisma CLI (~250 MB with
# its dependencies) just to run migrations:
#   runtime (default)  the API; also runs the seed: `node dist-seed/prisma/seed.js`
#   migrate            `prisma migrate deploy`, run once per deploy before the API rolls out
#
# Runtime environment (set by the ECS task definition; never baked into the image):
#   DATABASE_URL     postgresql://user:pass@host:5432/motormate   (both images)
#   JWT_SECRET       signs/verifies the API access token
#   CORS_ORIGIN      the frontend's origin
#   PORT             defaults to 8080
#   DATABASE_SSL_CA  /app/rds-global-bundle.pem on AWS (RDS requires SSL); unset locally

# ── 1. Build: install the workspace, compile types + backend, make a prod-only bundle ──
FROM node:22-alpine AS build
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
 && pnpm --filter backend build \
 && pnpm --filter backend exec tsc -p tsconfig.seed.json

# A self-contained copy of the backend with production dependencies only. Then:
# - drop the Prisma CLI and TypeScript: optional peers of @prisma/client that pnpm links
#   anyway, never loaded by the API (~200 MB with their dependencies);
# - copy in the Prisma client generated above (generating needs the CLI);
# - delete the query compilers for databases we don't use (~50 MB; PostgreSQL is kept).
RUN pnpm --filter backend deploy --prod --legacy /prod/backend \
 && node backend/scripts/prune-optional-peers.cjs /prod/backend prisma typescript \
 && client_dir="$(ls -d /prod/backend/node_modules/.pnpm/@prisma+client@*/node_modules)" \
 && cp -r /repo/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma "$client_dir/" \
 && find "$client_dir/@prisma/client/runtime" -type f \
      \( -name '*.sqlserver.*' -o -name '*.cockroachdb.*' -o -name '*.mysql.*' -o -name '*.sqlite.*' \) -delete \
 && node -p "require('/repo/backend/package.json').devDependencies.prisma" > /prod/prisma-version

# ── 2. Migrate: just the Prisma CLI, the schema and the migrations ──────────────────
FROM node:22-alpine AS migrate
# Prisma's schema engine needs OpenSSL.
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=build /prod/prisma-version ./
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund "prisma@$(cat prisma-version)" dotenv \
 && npm cache clean --force
COPY --from=build /repo/backend/prisma ./prisma
COPY --from=build /repo/backend/prisma.config.ts ./prisma.config.ts
ENV NO_COLOR=1 DOTENV_CONFIG_QUIET=true
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ── 3. Runtime (default): the API ─────────────────────────────────────────────────
FROM node:22-alpine AS runtime
# NO_COLOR keeps CloudWatch logs free of terminal colour codes; dotenv has no .env to load here.
ENV NODE_ENV=production PORT=8080 NO_COLOR=1 DOTENV_CONFIG_QUIET=true
WORKDIR /app

COPY --from=build --chown=node:node /prod/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/backend/package.json ./package.json
COPY --from=build --chown=node:node /repo/backend/dist ./dist
# The seed, compiled to JS (the image has no ts-node). Run it as a one-off task with the
# command override `node dist-seed/prisma/seed.js`; it upserts, so re-running is safe.
COPY --from=build --chown=node:node /repo/backend/dist-seed ./dist-seed
# AWS's certificate bundle for RDS, which requires SSL. ECS sets DATABASE_SSL_CA to this
# path so the server's certificate is verified (see src/prisma/pg-config.ts).
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem ./rds-global-bundle.pem

USER node
EXPOSE 8080

# ECS and the load balancer use their own health checks; this one helps `docker ps` locally.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/v1').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main"]
