# MotorMate — Project Context

This file is read by Claude Code at the start of every session. Keep it accurate as
decisions change — it is the single source of truth for architecture and conventions,
so update it in the same PR as any decision it documents.

## What this project is

MotorMate is a cloud-based Car Maintenance & Service Management System for small/medium
auto shops. It centralizes customer and vehicle records, tracks full service history,
manages the work-order lifecycle (check-in → diagnosis → repair → invoice), tracks parts
inventory, and sends mileage/date-based maintenance reminders to bring customers back.

Course project: DES424 Cloud-based Application Development, Thammasat SIIT.
Deadline: code freeze **Nov 10, 2026**, final presentation **Nov 17, 2026**.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS |
| Auth | NextAuth.js (Credentials provider), issues a JWT |
| Backend | NestJS, TypeScript |
| ORM | Prisma |
| Database | PostgreSQL — Docker locally, Amazon RDS in staging/prod |
| Frontend hosting | AWS Amplify Hosting (native Next.js SSR support) |
| Backend hosting | AWS ECS Fargate behind an Application Load Balancer |
| File storage | Amazon S3 (invoice PDFs, vehicle photos) |
| Email reminders | Amazon SES |
| Scheduled jobs | Amazon EventBridge Scheduler + AWS Lambda (daily due-reminder check) |
| CI | GitHub Actions (lint, typecheck, test on PR) |

Everything is TypeScript — frontend, backend, and the reminder Lambda — so types can be
shared via `packages/types` instead of re-declared per app.

## Repository structure

```
MotorMate/
  frontend/           Next.js frontend
  backend/             NestJS backend
  packages/
    types/           Shared TS interfaces / zod schemas used by both apps
    config/           Shared eslint/tsconfig base
  docker-compose.yml  Local Postgres for development
  .env.example
  pnpm-workspace.yaml
  package.json         Root workspace config
  README.md            Human-facing setup guide
  CLAUDE.md             This file
```

pnpm workspaces, not Turborepo/Nx — the project is small enough that the extra tooling
isn't worth it. Run per-app commands with `pnpm --filter frontend <cmd>` / `pnpm --filter backend <cmd>`
(`--filter` matches the package name in `package.json`, not the directory name).

## Auth architecture (important — don't re-derive this)

NextAuth.js in `frontend` handles login and issues a signed JWT (`NEXTAUTH_SECRET`).
NestJS in `backend` does **not** run NextAuth — it validates the same JWT on incoming
requests via a Passport JWT strategy, using a shared secret (`JWT_SECRET`, same value as
`NEXTAUTH_SECRET` across both apps' env files). Role (`ADMIN` | `ADVISOR` | `MECHANIC` |
`CUSTOMER`) is stored on the `User` table and embedded as a claim in the JWT. There is no
Cognito — role-based access control is entirely our own code (a NestJS guard checking the
`role` claim per route).

Frontend is hosted on Amplify (not static S3/CloudFront) specifically because NextAuth's
`/api/auth/*` routes need a server runtime, which a static export can't provide.

## Backend module structure

`backend/src` is organized **feature-based**, one folder per domain module — this is
NestJS's own idiomatic convention (what `nest g resource` scaffolds), not a layer-based
split into top-level `controllers/`/`services/` folders. Each feature folder holds its own
controller, service, module, and `dto/`:

```
backend/src/
  health/
    health.controller.ts
    health.service.ts
    health.module.ts
  customers/            (once built)
    customers.controller.ts
    customers.service.ts
    customers.module.ts
    dto/
  common/                (once needed — guards, filters, interceptors shared across modules)
  app.module.ts           composition root — imports each feature module
  main.ts
```

Add new features (Customer, Vehicle, WorkOrder, ...) as their own folder under `src/`,
each with its own module imported into `AppModule`, rather than piling files into shared
`controllers/`/`services/` folders.

## Core data entities (Prisma)

- **User** — staff and customer accounts; `role` enum drives access control.
- **Customer** — contact details; has many Vehicles.
- **Vehicle** — VIN, plate, make/model/year, current mileage; belongs to a Customer.
- **WorkOrder** — a single shop visit: status, assigned mechanic, linked Vehicle, complaint/notes.
- **ServiceItem / PartUsed** — services performed and parts consumed on a WorkOrder.
- **InventoryItem** — part catalog with stock level (deferred to Sprint 4, see below).
- **Reminder** — recommended next mileage/date, delivery status, linked Vehicle (deferred to Sprint 4).
- **Invoice** — finalized cost breakdown generated when a WorkOrder is completed.

## Current priority order (do not build out of order without checking in)

Team decided to build the **core workflow first**, then layer on the rest as time allows:

1. **MVP (must ship):** auth + roles, Customer CRUD, Vehicle CRUD, WorkOrder lifecycle
   (check-in → status transitions → parts-used → invoice on completion).
2. **Stretch, in priority order if time remains:** InventoryItem with stock deduction and
   low-stock alerts, Reminder engine (email via SES first — SMS/SNS only if time allows),
   reporting dashboard.

If a feature isn't in the MVP list above, don't build ahead of it — ask the team first,
since scope is intentionally tight against the Nov deadline.

## Conventions

- TypeScript strict mode in both apps.
- Shared ESLint/Prettier config at the repo root (`packages/config`) — don't add
  per-app overrides without a reason.
- Prefer explicit types over `any`; shared DTOs/interfaces for anything crossing the
  frontend/backend boundary live in `packages/types`, not duplicated in both apps.
- Commits: short imperative subject line (`add work order status transitions`, not
  `Added` or `Adding`).
- Tests: Jest for unit tests in both apps, Playwright for end-to-end. New MVP-list
  features should land with at least one test; stretch features can follow up.

## Local development

See `README.md` for full setup steps. Quick reference:

```bash
docker compose up -d          # start local Postgres
pnpm install                  # install all workspace deps
npm run db:migrate             # apply schema to local DB — alias for `pnpm --filter backend exec prisma migrate dev`
npm run db:seed                # populate sample data — alias for `pnpm --filter backend exec prisma db seed`
npm run dev:backend            # run backend (NestJS) — alias for `pnpm --filter backend dev`
npm run dev:frontend           # run frontend (Next.js) — alias for `pnpm --filter frontend dev`
```

## Environment variables

Three separate `.env.example` templates, each scoped to what actually reads it (`.env`
files themselves are gitignored, never committed):

- `.env.example` (repo root) — Postgres/pgAdmin credentials, read by `docker-compose.yml`.
- `backend/.env.example` — `DATABASE_URL` (Prisma), `JWT_SECRET`, `PORT`.
- `frontend/.env.example` — `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.

Two values that must match **across files**, not within one:

- `NEXTAUTH_SECRET` (frontend) and `JWT_SECRET` (backend) — same value, used to sign/verify
  the session JWT.
- `DATABASE_URL`'s embedded credentials (backend) must match `POSTGRES_USER`/
  `POSTGRES_PASSWORD`/`POSTGRES_DB` (root) — same Postgres instance (the frontend never
  talks to the database directly).

## Explicitly out of scope for now

- Multi-branch/multi-location support (mentioned as a future NFR in the kickoff report,
  not part of this build).
- SMS reminders (SNS) — only add if the email (SES) reminder flow is done with time to spare.
- Cognito — replaced by NextAuth.js, don't reintroduce without discussion.