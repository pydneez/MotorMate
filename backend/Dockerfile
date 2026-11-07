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
#   INVOICE_BUCKET   S3 bucket for invoice PDFs on AWS; unset locally (PDFs returned inline)

# ── Slim runtime base: Alpine + the node binary only ────────────────────────────────
# node:22-alpine also carries npm, yarn and corepack (~25 MB) that nothing uses at run
# time; deleting them in a later layer wouldn't shrink the image, so start from bare
# Alpine and copy in just the binary. Both tags pin Alpine 3.24 so the binary's musl and
# libstdc++ match. Used by the API and the migrate image.
FROM node:22-alpine3.24 AS node
FROM alpine:3.24 AS slim-node
RUN apk add --no-cache libstdc++ \
 && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# ── 1. Build: install the workspace, compile types + backend, make a prod-only bundle ──
FROM node:22-alpine3.24 AS build
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
# - delete the query compilers for databases we don't use (~50 MB; PostgreSQL is kept),
#   and the generic PostgreSQL ones too (~14 MB): the generated client in .prisma/client
#   carries its own copy;
# - delete source maps and pdfkit's browser bundle, which the API never loads.
RUN pnpm --filter backend deploy --prod --legacy /prod/backend \
 && node backend/scripts/prune-optional-peers.cjs /prod/backend prisma typescript \
 && client_dir="$(ls -d /prod/backend/node_modules/.pnpm/@prisma+client@*/node_modules)" \
 && cp -r /repo/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma "$client_dir/" \
 && find "$client_dir/@prisma/client/runtime" -type f -name 'query_compiler_*' -delete \
 && find "$client_dir/@prisma/client/runtime" -type f \
      \( -name '*.sqlserver.*' -o -name '*.cockroachdb.*' -o -name '*.mysql.*' -o -name '*.sqlite.*' \) -delete \
 && find /prod/backend/node_modules -type f -name '*.map' -delete \
 && find /prod/backend/node_modules -type f -path '*/pdfkit/js/pdfkit.standalone.js' -delete \
 && node -p "require('/repo/backend/package.json').devDependencies.prisma" > /prod/prisma-version

# ── 2. Migrate: just the Prisma CLI, the schema and the migrations ──────────────────
# Installed with npm in a throwaway stage, then pruned (253 → 141 MB). The CLI requires
# @prisma/studio-core and @prisma/dev at start-up, so those stay, but `migrate deploy`
# never loads Studio's UI libraries (React, visx, elkjs) or its ESM build, the MySQL
# driver, `prisma dev`'s embedded Postgres (PGlite), type declarations, source maps, or
# the query compilers for other databases. Checked by applying every migration to an
# empty database with the pruned CLI — re-check after upgrading Prisma.
FROM node:22-alpine3.24 AS migrate-deps
WORKDIR /app
COPY --from=build /prod/prisma-version ./
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund "prisma@$(cat prisma-version)" dotenv \
 && cd node_modules \
 && rm -rf react react-dom @visx elkjs mysql2 @electric-sql \
 && find @prisma/studio-core/dist -type f -name '*.js' -delete \
 && find . -type f \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \) -delete \
 && find prisma/build -type f -name 'query_compiler_*' ! -name '*postgresql*' -delete

FROM slim-node AS migrate
# Prisma's schema engine needs OpenSSL.
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=migrate-deps /app/node_modules ./node_modules
COPY --from=migrate-deps /app/package.json ./package.json
COPY --from=build /repo/backend/prisma ./prisma
COPY --from=build /repo/backend/prisma.config.ts ./prisma.config.ts
ENV NO_COLOR=1 DOTENV_CONFIG_QUIET=true
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ── 3. Runtime (default): the API ─────────────────────────────────────────────────
FROM slim-node AS runtime
# NO_COLOR keeps CloudWatch logs free of terminal colour codes; dotenv has no .env to load here.
ENV NODE_ENV=production PORT=8080 NO_COLOR=1 DOTENV_CONFIG_QUIET=true
WORKDIR /app

COPY --from=build --chown=node:node /prod/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/backend/package.json ./package.json
COPY --from=build --chown=node:node /repo/backend/dist ./dist
# The Thai font for invoice PDFs (read from dist/invoices/../../assets).
COPY --from=build --chown=node:node /repo/backend/assets ./assets
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
