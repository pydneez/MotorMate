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
| Auth | NextAuth.js (Credentials provider) in the frontend; backend issues the API JWT |
| Backend | NestJS, TypeScript |
| ORM | Prisma |
| Database | PostgreSQL — Docker locally, Amazon RDS in staging/prod |
| Hosting | Both apps as Docker containers on AWS ECS Fargate behind **one** Application Load Balancer (`/v1/*` → backend, 2 tasks; everything else → frontend, 1 task), images in ECR. HTTPS from an API Gateway HTTP API in front of the ALB (Amplify is restricted and CloudFront denied in Learner Lab) |
| File storage | Amazon S3 (invoice PDFs, vehicle photos) |
| Email reminders | Amazon SES (sandbox — only verified recipient addresses) |
| Scheduled jobs | Amazon EventBridge Scheduler + AWS Lambda (daily due-reminder check) |
| Logging / monitoring | Amazon CloudWatch (ECS `awslogs` driver) |
| CI | GitHub Actions (lint, typecheck, test on PR) |
| Project management | Jira |

Everything is TypeScript — frontend, backend, and the reminder Lambda — so types can be
shared via `packages/types` instead of re-declared per app.

## Repository structure

```
MotorMate/
  frontend/           Next.js frontend
  backend/             NestJS backend
  packages/
    types/           Shared zod schemas, TS types, and Thai phone/plate helpers used by
                     both apps — compiled to CommonJS in dist/ (`pnpm --filter
                     @motormate/types build`; the root dev/typecheck scripts do it first)
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

The **backend owns credentials and issues the API token**; NextAuth only holds it.

1. The login form calls NextAuth's Credentials provider (`frontend/auth.ts`), whose
   `authorize()` calls `POST /auth/login` on the backend.
2. The backend checks the bcrypt hash, rejects deactivated users (`isActive = false`), and
   returns `{ accessToken, user }`. `accessToken` is an HS256 JWT signed with
   `JWT_SECRET`, claims `{ sub, email, role }`, 8h expiry (`JwtClaimsSchema` in
   `packages/types`).
3. NextAuth stores `accessToken` + user in its own session cookie (encrypted with
   `NEXTAUTH_SECRET`). The frontend sends `Authorization: Bearer <accessToken>` on every
   API call (`frontend/lib/api.ts`).
4. NestJS verifies the token with a Passport JWT strategy. A global `JwtAuthGuard` makes
   **every route require auth by default** — opt out with `@Public()`. A global
   `RolesGuard` enforces `@Roles(...)` per route/controller.

Why not "share NextAuth's JWT with the backend": NextAuth's session token is an
*encrypted* JWE, not a signed JWS, so passport-jwt can't verify it — and the frontend
never touches the database, so password checks have to live in the backend anyway.
`NEXTAUTH_SECRET` and `JWT_SECRET` are therefore **independent** values.

Role (`ADMIN` | `ADVISOR` | `MECHANIC` | `CUSTOMER`) is stored on `User`. There is no
Cognito (dropped from the kickoff design — explain in the final project document);
RBAC is entirely our own code.

Customer self-registration (`POST /auth/register`) creates a `CUSTOMER` user. If a
shop-created `Customer` record with **both** the same email and the same (normalized)
phone exists and has no login yet, the new user is linked to it; otherwise a new
`Customer` is created and staff can merge later. Email verification would be the
production fix for claim-by-email — documented, not built.

**One online account per phone number:** sign-up is refused (409, error on the `phone`
field) when the phone already belongs to a `Customer` that has a login. Shop records
*without* a login don't block sign-up — that's the walk-in case, handled by linking or by
the staff merge tool. Trade-offs, for the final document: a family sharing one phone can
only have one online account (staff can still create shop records for the others), and the
message reveals that *some* account uses that phone, similar to "email already registered".
The check is in the service, not a DB constraint, so two simultaneous sign-ups could still
race — acceptable at this scale.

The frontend runs as a Next.js server (`output: "standalone"`, `frontend/Dockerfile`), not
a static export, because NextAuth's `/api/auth/*` routes need a server runtime.

**API address:** every backend route is under `/v1` (`configureApp()` in
`backend/src/app.setup.ts`, used by `main.ts`; the health check is `GET /v1`). The
frontend picks the base URL in `apiBaseUrl()` (`frontend/lib/api.ts`): the browser uses
`NEXT_PUBLIC_API_URL` (`http://localhost:8080/v1` locally, the relative `/v1` on AWS where
site and API share one address — baked in at build time); the Next.js server uses
`API_INTERNAL_URL` (the load balancer, read at runtime) when set. One frontend image
therefore works in every AWS account.

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
  auth/                 login, register, me, change password; JWT strategy
  users/                staff management (ADMIN only)
  customers/
    customers.controller.ts
    customers.service.ts
    customers.module.ts
  vehicles/             also vehicle.mapper.ts (VehicleSummary / service history shapes)
  inventory/            catalogue + StockService (the only code that changes stock levels)
  work-orders/          check-in (incl. walk-in), status moves, notes, labour, parts used
                        (via StockService), recommendations, completion → invoice
  invoices/             invoice list/detail (customers scoped), mark as paid
  common/
    decorators/          @Public, @Roles, @CurrentUser
    guards/              JwtAuthGuard, RolesGuard (both global)
    pipes/               ZodValidationPipe
    utils/               writeAudit/diffFields, pagination + searchTokens, phoneSearchFragment
  app.module.ts           composition root — imports each feature module
  main.ts
```

Add new features (Customer, Vehicle, WorkOrder, ...) as their own folder under `src/`,
each with its own module imported into `AppModule`, rather than piling files into shared
`controllers/`/`services/` folders. Request bodies are validated with the shared zod
schemas (no `dto/` classes — see Conventions).

Patterns the existing modules follow (copy them for new ones):

- **List endpoints** take `?q=&page=&pageSize=` (`ListQuerySchema`) and return
  `Paginated<T>`; multi-word searches AND their words (`searchTokens`).
- **Every write** that matters runs in `prisma.$transaction` together with `writeAudit(...)`.
- **Customers are scoped in the service**, not just the guard: a customer requesting
  someone else's record gets **404**, never 403, so existence isn't revealed.
- Number fields from forms use `wholeNumber(label)` from `packages/types` (blank = required,
  never silently 0); money uses `money(label)` (≥ 0, at most 2 decimals, THB excl. VAT).

Frontend pages follow the same split: server components fetch with `serverGet()`
(`frontend/lib/server.ts`, token from the session, 404 → not-found page); client forms use
`useApi()` + `useFormSubmit()` (`frontend/lib/client.ts`) and validate with the same zod
schema before calling the API. List search and paging live in the URL.

## Core data entities (Prisma — `backend/prisma/schema.prisma`)

- **User** — staff and customer logins; `role` drives RBAC; `isActive` lets an admin
  deactivate staff without deleting history.
- **Customer** — name, phone, optional email, LINE ID; optional 1:1 link to a `User`
  (customers who have portal access). Has many Vehicles.
- **Vehicle** — VIN (unique), plate + province, make/model/year/color, current mileage.
- **WorkOrder** — one shop visit: human number (`WO-0001`), mileage at check-in,
  complaint, diagnosis, work performed, assigned mechanic, status.
- **WorkOrderStatusChange** — every status transition with who/when; doubles as the audit
  trail and the vehicle service timeline.
- **ServiceItem** — labor lines on a WorkOrder.
- **InventoryItem** — part catalog (SKU, category, qty on hand, cost, price, supplier,
  reorder level).
- **PartUsed** — InventoryItem consumed on a WorkOrder, with price snapshot.
- **StockMovement** — every stock change (+/−) with reason and user — per-part usage history.
- **Invoice** — generated on WorkOrder completion: subtotal, VAT 7%, total, paid status,
  S3 key for the PDF.
- **ServiceRecommendation** — "brake inspection due at 55,000 km": due mileage and/or
  date; the reminder Lambda reads these (replaces the earlier "Reminder" entity).
- **Appointment** — "Lite" booking: customer requests a time, advisor confirms /
  reschedules / cancels, "Check in" creates the WorkOrder. No slot/capacity management.
- **NotificationLog** — every email sent (reminders, appointment notices), prevents
  double-sends.
- **AuditLog** — who changed what, when, for important records.

### Domain rules (decided — don't re-litigate)

- **Work order statuses:** `CHECKED_IN → DIAGNOSING → AWAITING_PARTS → IN_PROGRESS →
  QUALITY_CHECK → COMPLETED`, plus `CANCELLED`. Allowed moves and who may make them live in
  `allowedNextStatuses()` (`packages/types/src/work-order.ts`), shared by the API and the
  buttons:
  - CHECKED_IN → DIAGNOSING; DIAGNOSING → AWAITING_PARTS / IN_PROGRESS; AWAITING_PARTS →
    IN_PROGRESS; IN_PROGRESS → AWAITING_PARTS / QUALITY_CHECK; QUALITY_CHECK → IN_PROGRESS
    (failed QC) / COMPLETED; any open status → CANCELLED.
  - Advisors/admins can make any move. A mechanic can only change jobs **assigned to them**
    (notes, labour, parts, status) and never makes the COMPLETED (QC sign-off) or CANCELLED
    moves. Other mechanics can view. Customers see status on their vehicle page only.
  - Check-in: mileage must be ≥ the vehicle's recorded mileage, and a vehicle can have only
    one open work order. Completed/cancelled jobs can't be changed at all.
  - Walk-in check-in (`POST /work-orders/walk-in`, page `/app/work-orders/new?mode=walk-in`,
    advisor/admin): new or existing customer (found by phone) + new vehicle + work order in
    **one transaction** — a taken VIN or email creates nothing. The new vehicle's mileage is
    the check-in mileage.
  - Parts used take stock immediately (`StockService`, reason `WORK_ORDER`) at the item's
    price at that moment; removing a part or cancelling the job puts the stock back.
  - Totals use `calculateTotals()` in whole satang (VAT 7%, rounded half-up).
  - **Completion** (QUALITY_CHECK → COMPLETED, advisor/admin) runs in one transaction:
    issues the `Invoice` from the job's lines (`calculateTotals`), sets `completedAt`, and
    raises the vehicle's mileage to the check-in reading (conditional update, never lowers
    it). A job with no labour and no parts can't be completed; two completions at once →
    409 (invoice is unique per job).
  - **Recommendations** ("Brake pads check at 80,000 km") are added by staff or the assigned
    mechanic while the job is open: due mileage must be above this visit's, due date after
    today (Bangkok); at least one of the two. Stored at UTC midnight so `yyyy-mm-dd`
    round-trips. They show on the vehicle's service history; the reminder job reads them.
- **Invoices** (`backend/src/invoices`): `INV-0001`, VAT 7%, amounts frozen at completion.
  - Advisors/admins see all; customers only their own (others → 404); mechanics none (403).
  - "Mark as paid" is just a flag (advisor/admin, once, conditional update) — who paid it
    comes from the `invoice.paid` audit entry, so there is no extra column. No payment
    integration, no un-paying, `VOID` unused for now.
  - Printing uses the browser's print dialog; the app shell is hidden with `print:hidden`.
    Shop details on the invoice are placeholders in `frontend/lib/shop.ts`. The PDF-to-S3
    version is stretch ticket CLOUDAPPG3-45.
- **Stock is deducted when a part is logged** on a work order (it reserves the part), and
  returned when the part is removed or the work order is cancelled. Every change writes a
  `StockMovement` in the same DB transaction.
- **All stock changes go through `StockService.change(tx, …)`** (`backend/src/inventory`):
  it uses one conditional UPDATE, so stock can never go negative even under concurrent
  requests, and it writes the `StockMovement` + audit entry. Three reasons only:
  `PURCHASE` (Receive, and opening stock), `ADJUSTMENT` (Stocktake: the user enters the
  counted quantity plus a required reason; guarded against the count changing meanwhile),
  `WORK_ORDER` (parts used, Step 4). Quantity is never editable directly.
- Inventory: admins/advisors manage it; mechanics can view it, and their stock usage is
  recorded through work orders. Items are deactivated, never deleted. Low stock means
  on hand ≤ reorder level. Prices exclude VAT; a price below cost only warns.
- **Mileage never decreases** except by an admin correction (audited).
- **Duplicates:** VIN is a hard unique constraint. Same phone (customer) or same
  plate+province (vehicle) only raises a "possible duplicate" warning.
- **Merging duplicate customers** (`POST /customers/:id/merge`, admin/advisor): the usual
  case is a walk-in record (phone only) plus a later self-registration with the same phone.
  - Only records with the **same phone**; at most **one** may have a portal login, and
    that one is always kept (so the sign-in keeps working).
  - Vehicles (with their whole history) and appointments move to the kept record; kept
    values win, blank email/LINE ID are filled, notes are combined; the emptied record is
    **deleted** (the one exception to "no deleting customers") and a `customer.merged`
    audit entry records what moved. All in one transaction.
  - Two records that both have logins can't be merged. Sign-up allows only one online
    account per phone (see Auth architecture), so this only happens for accounts created
    before that rule existed.
  - The customer dashboard's "ask the advisor to link your history" hint is deliberately
    generic: it never reveals whether a record with that phone exists.
- **Thailand only for now**, stored so other countries can be added later:
  - Phones are stored as E.164 (`+66812345678`), displayed as `081-234-5678`; use
    `normalizeThaiPhone` / `formatThaiPhone` from `packages/types`.
  - Plates are free-ish text (Thai letters, digits, space, dash) plus a required
    `province` (Thai name, from `THAI_PROVINCES`). `plateNormalized` (no spaces/dashes)
    is what search uses.
- Money is `Decimal(10,2)` in THB; VAT 7%.

## Current priority order (do not build out of order without checking in)

Team decided to build the **core workflow first**, then layer on the rest as time allows.
Target: feature-complete by **Nov 1, 2026**; Nov 2–10 is buffer, hardening, and docs.

1. **MVP (must ship):** auth + roles + staff management, Customer CRUD, Vehicle CRUD,
   Inventory CRUD, WorkOrder lifecycle (check-in → status transitions → parts-used with
   stock deduction → invoice on completion).
2. **Stretch, in priority order:** invoice PDF to S3, reminder engine (ServiceRecommendation
   + daily Lambda + SES email + "due for service" dashboard), Lite appointments, customer
   portal views, reporting dashboard + CSV export.

If a feature isn't in the MVP list above, don't build ahead of it — ask the team first,
since scope is intentionally tight against the Nov deadline.

## Conventions

- TypeScript strict mode in both apps.
- Prefer explicit types over `any`; shared DTOs/interfaces for anything crossing the
  frontend/backend boundary live in `packages/types`, not duplicated in both apps.
- Request validation: backend controllers validate bodies with the shared zod schemas
  via `ZodValidationPipe` (`backend/src/common/pipes`) — not class-validator DTOs — so
  the frontend form and the API apply the exact same rules.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): subject` — lowercase imperative subject, no trailing period
  (`feat(work-orders): add status transitions`, not `Added status transitions`).
  - Types: `feat` (new behaviour), `fix` (bug fix), `refactor` (no behaviour change),
    `test`, `docs`, `chore` (deps, config, tooling), `ci`, `build`, `perf`, `style`.
  - Scope (optional): the feature module or package — `auth`, `customers`, `vehicles`,
    `work-orders`, `inventory`, `invoices`, `reminders`, `appointments`, `db`, `types`,
    `frontend`, `backend`, `infra`.
  - Removing code isn't its own type: use the type that describes why (`refactor`,
    `chore`, or `feat!`/`fix!` with a `BREAKING CHANGE:` footer if it breaks an API).
  - Optional body after a blank line: bullet points for what changed and why.
- Branches: `type/short-description`, e.g. `feat/schema-and-auth`, `fix/login-redirect`.
- Tests: Jest for unit tests in both apps, Playwright for end-to-end. New MVP-list
  features should land with at least one test; stretch features can follow up.

## Working agreement with Claude (how each build step runs)

The build is done in numbered steps (Step 1 = schema + auth, Step 2 = ...). For every step:

1. **Plan first, no code.** Before touching any file, Claude posts a step summary:
   - what the step covers and what's explicitly out of it;
   - backend changes (endpoints, roles allowed, rules, tests);
   - frontend changes (pages and components);
   - rough ASCII wireframes for any new or changed screens;
   - open decisions, each with a recommended option.
2. **Wait for feedback.** Claude asks for feedback and only starts once the user has
   answered the open decisions and given an explicit go-ahead. If the plan changes during
   that discussion, Claude restates what changed before starting.
3. **Build and verify** on a `type/short-description` branch: typecheck, tests, and a
   browser check of the new screens. Claude removes any test data it created.
4. **Report.** Claude summarizes what was done, what was verified, and anything that
   deviated from the plan. Then it hands over the `git add` / `git commit` commands with a
   Conventional Commits message. **The user commits and pushes themselves**; Claude does
   not commit unless asked.
5. **PR description.** Every report ends with a ready-to-paste PR title and description
   (in a fenced `markdown` block) for the step's branch: summary, what's included, tests
   and browser checks, what's not included, the base branch if it's stacked, and the Jira
   tickets.

## Local development

See `README.md` for full setup steps. Quick reference:

```bash
docker compose up -d          # start local Postgres
pnpm install                  # install all workspace deps
npm run db:migrate             # apply schema to local DB — alias for `pnpm --filter backend exec prisma migrate dev`
npm run db:seed                # populate sample data — alias for `pnpm --filter backend exec prisma db seed`
npm run dev:backend            # build packages/types, then run backend (NestJS) on :8080/v1
npm run dev:frontend           # build packages/types, then run frontend (Next.js) on :3000
npm run test                   # build packages/types, then Jest unit tests in every package
npm run test:integration       # backend HTTP + real-Postgres tests (see below)
```

- **Integration tests** (`backend/test/*.int-spec.ts`) boot the whole Nest app and hit a
  **separate `motormate_test` database** (derived from `DATABASE_URL`, or set
  `TEST_DATABASE_URL`); the setup refuses any database not ending in `_test`, applies
  migrations, and truncates its tables. Create it once with
  `docker exec motormate-postgres psql -U <user> -d motormate -c "CREATE DATABASE motormate_test"`.
- Unit tests use the Prisma mock in `backend/test/prisma-mock.ts`.
- Don't run `next build` while a frontend dev server is running — it overwrites `.next`
  and the dev server starts serving pages without CSS/JS until restarted. Building the
  Docker images is safe (it builds inside the container).
- Production images, built from the repo root: `docker build -f backend/Dockerfile -t
  motormate-backend .` and `docker build -f frontend/Dockerfile -t motormate-frontend .`
  (each has its own ignore file: root `.dockerignore` / `frontend/Dockerfile.dockerignore`).
  The backend applies migrations on start; the seed is compiled into it and runs with the
  command `node dist-seed/seed.js`.

Seeded logins (password `password123`): `admin@`, `advisor@`, `mechanic@motormate.example`,
customer `jordan.lee@example.com`.

`prisma migrate dev` refuses to run in non-interactive shells (e.g. Claude Code). To add
a migration there: write the SQL with `prisma migrate diff --from-config-datasource
--to-schema prisma/schema.prisma --script` into a new `prisma/migrations/<timestamp>_<name>/`
folder, review it, then apply it with `prisma migrate deploy`.

## Environment variables

Three separate `.env.example` templates, each scoped to what actually reads it (`.env`
files themselves are gitignored, never committed):

- `.env.example` (repo root) — Postgres/pgAdmin credentials, read by `docker-compose.yml`.
- `backend/.env.example` — `DATABASE_URL` (Prisma), `JWT_SECRET`, `PORT`, `CORS_ORIGIN`.
- `frontend/.env.example` — `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_API_URL`
  (includes `/v1`), and `API_INTERNAL_URL` (AWS only — see "API address" above).

Values that must agree **across files**:

- `DATABASE_URL`'s embedded credentials (backend) must match `POSTGRES_USER`/
  `POSTGRES_PASSWORD`/`POSTGRES_DB` (root) — same Postgres instance (the frontend never
  talks to the database directly).
- `NEXT_PUBLIC_API_URL` (frontend) points at the backend; `CORS_ORIGIN` (backend) is the
  frontend's origin.
- `NEXTAUTH_SECRET` and `JWT_SECRET` do **not** need to match (see Auth architecture).

## AWS deployment (AWS Academy Learner Lab)

- Each team member has their own Learner Lab account ($50 budget each); accounts can't be
  shared and IAM users/roles can't be created — every service uses the pre-made
  `LabRole` / `LabInstanceProfile`. Credentials are temporary (expire with the lab
  session), so deploys are run by the account owner, not by long-lived CI secrets.
- Infrastructure lives in the repo as scripts/CloudFormation (no CDK — its bootstrap
  creates IAM roles, which Learner Lab blocks), so any member can recreate the
  environment in their own account.
- **Two accounts:** a dev account that is deployed during work sessions and torn down at
  night, and a separate demo account deployed ~Nov 8–10 and left running through the
  Nov 17 presentation.
- Cost rules: Fargate tasks in public subnets with public IPs — **no NAT Gateway**;
  RDS `db.t3.micro` with automated backups and encryption at rest.
- No custom domain → Route 53 / ACM-with-own-domain are "production plan" items in the
  final document; HTTPS comes from the API Gateway HTTP API's default
  `*.execute-api.amazonaws.com` certificate, which proxies the whole site to the ALB
  (30-second request limit — fine for this app).
- Tested in Learner Lab: **CloudFront is denied**, **Amplify's role is restricted** (so the
  frontend is a container too), API Gateway HTTP APIs are allowed, only us-east-1/us-west-2,
  and resources **keep running and billing after the lab session ends** — tear down nightly.
  An ALB needs its own security group allowing inbound 80 (not the default SG).
- Secrets (`JWT_SECRET`, `NEXTAUTH_SECRET`, DB password) are hidden (`NoEcho`) stack
  parameters; Secrets Manager is the production plan in the final document.
- CloudFormation templates and up/down scripts: Step 2b-2 (`infra/`).

## Parked ideas (nice-to-have, not scheduled)

Agreed as good ideas, deliberately not built so the MVP stays on schedule. Don't build
without the team deciding first.

- **Labour price list (hybrid pricing).** Today labour lines are free-typed amounts entered
  by staff or the assigned mechanic (common in small garages, but anyone can type any
  number; the advisor's QC sign-off is the only check). Proposed model:
  - **Routine maintenance → fixed price per job** from an admin-maintained list (oil/fluid
    changes, brake pads, battery, tyre rotation…). Picking the job fills the price; the
    price is snapshotted on the line like parts.
  - **Unpredictable repairs → hours × shop hourly rate** (engine diagnostics, electrical
    troubleshooting, oil leaks, suspension rebuilds), entered as an **estimate** the
    customer approves before work starts; actual hours recorded; re-approval if it runs
    over. Often with a fixed diagnostic fee.
  - Mechanics can only pick from the list; advisors/admins can add custom lines or override
    a price with a required reason (audited).
  - Data: one price list (`type: FIXED | HOURLY`, price or standard hours), a shop
    hourly-rate setting, and labour lines linking to their price-list entry with
    estimated/actual hours.

## Explicitly out of scope for now

- Multi-branch/multi-location support (mentioned as a future NFR in the kickoff report,
  not part of this build).
- SMS reminders (SNS) — only add if the email (SES) reminder flow is done with time to spare.
- Cognito — replaced by NextAuth.js, don't reintroduce without discussion.
- Appointment slot/capacity management, drag-and-drop calendars — appointments are "Lite".
- Customer email verification — documented as the production plan only.
- Countries other than Thailand for phone numbers and plates.