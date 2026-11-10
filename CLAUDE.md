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
| Hosting | Both apps as Docker containers on AWS ECS Fargate behind **one** Application Load Balancer (`/v1/*` → backend, 2 tasks; everything else → frontend, 2 tasks), images in ECR. HTTPS from **CloudFront**; the ALB only answers CloudFront — see AWS deployment |
| File storage | Amazon S3 (invoice PDFs, vehicle photos) |
| Customer emails | Amazon SNS email subscriptions — SES is sandbox-only in the demo account (see Reminders below) |
| Scheduled jobs | Amazon EventBridge Scheduler (09:00 and 18:30 Bangkok) → AWS Lambda → the API's job endpoints |
| Logging / monitoring | Amazon CloudWatch (ECS `awslogs` driver) |
| CI | GitHub Actions (`.github/workflows/ci.yml`): typecheck + lint + unit tests, and integration tests against a Postgres service, on every PR and push to main |
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
  infra/              AWS deployment: CloudFormation templates + scripts (see infra/README.md)
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
   `JWT_SECRET`, claims `{ sub, email, role, shopId }`, 8h expiry (`JwtClaimsSchema` in
   `packages/types`). `shopId` is the shop the token works in (null for the platform admin).
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

Role (`PLATFORM_ADMIN` | `ADMIN` | `ADVISOR` | `MECHANIC` | `CUSTOMER`) is stored on `User`. There is no
Cognito (dropped from the kickoff design — explain in the final project document);
RBAC is entirely our own code.

**Multi-shop (Step 15).** One deployment serves many garages ("shops"). Staff belong to one
shop (`User.shopId`), and their token carries it. A customer's login belongs to no shop: it
has one `Customer` record **per shop** it's linked to, and the token carries the shop they're
working in (`User.lastShopId` remembers it for the next sign-in). Customers switch with
`POST /auth/switch-shop` and link another shop with `POST /auth/shops` — both return a new
token; the frontend swaps it in NextAuth's jwt callback (`useSession().update({ shopId,
link })`), so the browser never handles the token itself. `JwtStrategy` re-checks on every
request that the shop is still active (staff) or still linked (customers) — a suspended shop
cuts off existing tokens at once. The `PLATFORM_ADMIN` (`platform@motormate.example` in the
seed) is in no shop and only sees `/app/platform`.

Customer self-registration (`POST /auth/register`, with the `shopId` picked on the form)
creates a `CUSTOMER` user in that shop. If a
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
`API_INTERNAL_URL` (the Cloud Map private DNS name, read at runtime) when set. One frontend image
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
  invoices/             invoice list/detail (customers scoped), mark as paid, PDF (S3)
  notifications/        NotifierService (global): SNS subscriptions + sending, NotificationLog;
                        the email texts (email-text.ts)
  reminders/            Reminders page API, "Run daily jobs now", POST /jobs/:job (job token)
  appointments/         "Lite" booking: request, confirm, reschedule, cancel, no-show
                        (check-in itself is POST /work-orders with appointmentId)
  reports/              admin-only summary, revenue totals, CSV exports (csv.ts)
  settings/             SettingsService (global): the current shop's details (GET any login, PATCH admin)
  shops/                GET /shops + POST /shops/register (public); /platform/shops (PLATFORM_ADMIN)
  services/             the price list: GET /services (what you see depends on the role), admin CRUD
  common/
    tenancy/             request shop context, the Prisma shop filter, requireShop/nextShopNumber
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
  - **Date ranges** (invoices: issue date; work orders: check-in date) are optional
    `?from=&to=` Bangkok days: `...dateRangeFields` + `.superRefine(checkDateRange)` in the
    query schema, `bangkokDayFilter()` (`backend/src/common/utils/dates.ts`) in the service.
    No length limit on lists (reports keep 12 months).
  - **Sorting** happens in the API (lists are paged): a fixed `sort` enum + `dir`, with
    tie-breakers so paging is stable (inventory: `listOrder()`). Pages use `SortHeader` (and
    `SortSelect` on phones) from `frontend/components/data`.
  - **On screen, lists filter by month and year**, not free dates: `MonthYearFilter` (Year:
    All years / this year back to 2022; Month: Whole year / Jan–Dec; "This month" / "Last
    month" shortcuts) writes `?year=&month=`, and `readMonthYear()` (`frontend/lib/date-range.ts`)
    turns them into the API's `from`/`to` — invalid values are dropped with a message, never
    a 400. Work orders show it on the Completed / Cancelled tabs only (labelled "Checked in").
    Reports keep a range, picked as whole months (From [month][year] To [month][year],
    `monthSpan()`), next to the This month / Last month / Last 3 months / This year buttons;
    the URL stays `?from=&to=`, so an exact-day link still works.
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
- **Shop** — a garage on MotorMate: name, address, phone, email, tax ID (what invoices print),
  `isActive` (the platform admin suspends), and the per-shop counters `lastWorkOrderNumber` /
  `lastInvoiceNumber`. Customer, Vehicle, WorkOrder, Invoice, InventoryItem and
  ServiceCatalogItem carry `shopId`; their children are a shop's through their parent.
- **Vehicle** — VIN (unique per shop), plate + province, make/model/year/color, current mileage.
- **WorkOrder** — one shop visit: human number (`WO-0001`, per shop), mileage at check-in,
  complaint, diagnosis, work performed, assigned mechanic, status.
- **WorkOrderStatusChange** — every status transition with who/when; doubles as the audit
  trail and the vehicle service timeline.
- **ServiceItem** — labor lines on a WorkOrder: from the price list (`catalogItemId`) or
  custom (null); `addedById` is who added it.
- **ServiceCatalogItem** — the price list: routine jobs at a fixed price (name unique,
  category, price excl. VAT, `bookable` = customers can pick it, `isActive`; never deleted).
- **AppointmentService** — a service picked when booking, with name + price snapshot.
- **InventoryItem** — part catalog (SKU, category, qty on hand, cost, price, supplier,
  reorder level).
- **PartUsed** — InventoryItem consumed on a WorkOrder, with price snapshot.
- **StockMovement** — every stock change (+/−) with reason and user — per-part usage history.
- **Invoice** — generated on WorkOrder completion: subtotal, VAT 7%, total, paid status,
  S3 key for the PDF.
- **ServiceRecommendation** — "brake inspection due at 55,000 km": due mileage and/or
  date; the morning job emails them when due (replaces the earlier "Reminder" entity).
- **Appointment** — "Lite" booking: customer requests a time, advisor confirms /
  reschedules / cancels, "Check in" creates the WorkOrder. No slot/capacity management.
- **NotificationLog** — every email sent or failed (reminders, appointment notices), per
  customer; prevents double-sends. Customer also stores its SNS subscription
  (`notifySubscriptionArn`, `notifyEmail`, `notifyConfirmed`).
- **AuditLog** — who changed what, when, for important records.

### Domain rules (decided — don't re-litigate)

- **Work order statuses:** `CHECKED_IN → DIAGNOSING → AWAITING_PARTS → IN_PROGRESS →
  QUALITY_CHECK → COMPLETED`, plus `CANCELLED`. Allowed moves and who may make them live in
  `allowedNextStatuses()` (`packages/types/src/work-order.ts`), shared by the API and the
  buttons:
  - CHECKED_IN → DIAGNOSING; DIAGNOSING → AWAITING_PARTS / IN_PROGRESS; AWAITING_PARTS →
    IN_PROGRESS; IN_PROGRESS → AWAITING_PARTS / QUALITY_CHECK; QUALITY_CHECK → IN_PROGRESS
    (failed QC) / COMPLETED; any open status → CANCELLED.
  - **On screen:** a 5-step progress bar (`StatusStepper`; Awaiting parts = an amber pause on
    In progress, Cancelled = greyed out) and buttons named for the action — `statusActions()`
    / `statusHint()` next to `allowedNextStatuses()`: Start diagnosis · Start repair ·
    Waiting for parts · Parts arrived — resume · Send to quality check · Pass QC & invoice
    (green) · Fail QC — back to repair (amber) · Cancel job (red), normal next step first,
    Cancel last, plus a one-line "Next: …" hint.
  - Advisors/admins can make any move. A mechanic can only change jobs **assigned to them**
    (notes, labour, parts, status) and never makes the COMPLETED (QC sign-off) or CANCELLED
    moves. Other mechanics can view. Customers see status on their vehicle page only.
  - **Finding the car at the counter:** vehicle and work-order search also match the owner's
    phone (`phoneSearchFragment`). A phone-like search with no car offers the walk-in form
    with the number filled in (`?phone=`); the walk-in form, on a phone match, lists that
    customer's cars with "Check in this car" (`?vehicleId=`). Checking in a booking for another
    day shows a warning; Back returns to the appointments tab it came from (`&from=`).
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
  - **Labour lines** come from the **price list** (Settings → Services & prices) or are
    **custom** ("middle way", Step 12): picking a service fills its name and today's price.
    Advisors/admins may change a list price on the line with a **required reason** (400 on
    `priceReason` without one); the line keeps `listPrice` + `priceReason` (shown as "changed
    from ฿X — reason") and so does the audit entry. A mechanic can't change one (400) but may
    add custom lines on their own job. The **Pass QC & invoice** dialog lists the mechanic's
    custom lines and every changed list price, so the advisor checks them before invoicing.
    Invoices show only the final price. A deactivated service can't be picked. Lines show "Price list" or
    "Custom · added by …".
  - **Recommendations** ("Brake pads check at 80,000 km") are added by staff or the assigned
    mechanic while the job is open: due mileage must be above this visit's, due date after
    today (Bangkok); at least one of the two. Stored at UTC midnight so `yyyy-mm-dd`
    round-trips. They show on the vehicle's service history; the reminder job reads them.
- **Appointments** (`backend/src/appointments`; rules in `packages/types/src/appointment.ts`,
  shared by the API and the buttons via `appointmentActions()`):
  - Times are Bangkok, within `SHOP.hours` (Mon–Sat 08:00–18:00, 30-minute slots, last one 17:30), at least
    **2 hours** ahead and at most 60 days ahead (`bookingTimeError()`).
  - A customer books for their **own** vehicle → `REQUESTED`; staff book for anyone (phone
    bookings) → `CONFIRMED`. One upcoming (requested/confirmed) appointment per vehicle.
  - **Services:** the booking form lists the price list (customers: bookable ones only,
    "from ฿X", an estimate excl. VAT, "final price after inspection"); pick services, write a
    note, or both. Picked services are snapshotted (`AppointmentService`, price at booking);
    with no note the reason becomes the services' names. **Check-in** turns them into the
    job's first labour lines at the quoted price, in the same transaction.
  - Staff: confirm, reschedule, cancel, check in (any time before), no-show (confirmed and
    past its time). Customers: cancel, and move a still-`REQUESTED` one — only until **2
    hours before**; after that the page tells them to call the shop.
  - **Check-in** = the normal check-in form prefilled (`/app/work-orders/new?appointment=…`,
    mileage required): `POST /work-orders` with `appointmentId` creates the job and sets the
    appointment `CHECKED_IN` + `workOrderId` in one transaction. The job's completion →
    `COMPLETED`; its cancellation → `CANCELLED`.
  - Customers see only their own (others → 404); mechanics none (403). For customers,
    "upcoming" means still in the future — a request whose time passed unconfirmed shows
    under Past as "Not confirmed"; staff still see it under Upcoming to resolve it.
  - **Staff list:** Requests / Today / Upcoming / Past are presets; the **All** tab (newest
    first) has filters — status tick boxes (`?status=A,B`), Booked by (`?bookedBy=customer|
    staff`: staff = made by a staff login, i.e. a phone booking) and the scheduled month/year.
    The filters only narrow a tab (AND); leaving All drops them.
  - Every change is a conditional update + audit entry; the cancel reason lives in the audit
    log.
  - **Emails:** when staff confirm, book (phone), move or cancel one, the customer is emailed
    after the change is saved (a failed email never undoes it); customers' own changes send
    nothing. Confirmed appointments get a reminder at 09:00 the day before — so one confirmed
    after 09:00 for the next day (or the same day) only gets the confirmation email.
  - **End of the shop day** (18:30 job, day ends at 18:00): `CONFIRMED` but not checked in →
    `NO_SHOW`; `REQUESTED` never confirmed → `CANCELLED` ("Not confirmed in time"). Audit
    entries with `actorId` null and `by: "system"`.
- **Reminders** (`backend/src/reminders`, rules in `packages/types/src/reminder.ts`):
  - An open recommendation is **due** 7 days before its due date (Bangkok calendar days) or
    when the estimated odometer is within 1,000 km of its due mileage; **overdue** past
    either. The estimate is the last reading + the average km/day between the vehicle's
    visits (≥ 30 days apart), else 40 km/day (`estimateMileage()`).
  - **Morning job (09:00):** one email per customer listing everything newly due (item →
    `REMINDED`), plus **one** follow-up 30 days after the first if it's still open. Items are
    only marked when the email went out — a customer who hasn't confirmed yet is tried again
    the next day. Also the day-before appointment emails.
  - Staff close items as **Done** or **Dismiss** (audited); there's no automatic closing.
  - `/app/reminders` (admin/advisor): Due now / Overdue / Coming up / Sent emails, the
    customer's email status, and **Run daily jobs now** (runs both jobs; safe any time).
    Staff dashboards show "Due for service"; customers see "Service coming up".
  - The jobs run as `POST /v1/jobs/morning|close-day` with header `x-job-token: $JOB_TOKEN`
    (`@Public`; without `JOB_TOKEN` the endpoint is off). An inline Node Lambda calls it,
    started by two EventBridge Scheduler schedules (`infra/cloudformation/app.yml`).
- **Emails go through SNS, not SES** — SES is sandbox-only in the demo account and we have no
  domain to verify. One topic
  (`motormate-notifications`, base stack); every email address gets **one subscription
  filtered on that address** (lower-cased), made automatically when the email is added
  (sign-up, staff create/edit) and by the morning job's catch-up. AWS emails a confirmation
  link once per address; until it's clicked, nothing reaches them (staff see "Email not
  confirmed"). Keyed on the address, not the customer id, so a confirmed address stays
  confirmed across database rebuilds and re-sign-ups. The morning job re-checks every
  subscription, so one the customer unsubscribed from (AWS's link) goes back to "not
  confirmed". Messages are plain text from "AWS Notifications" with AWS's unsubscribe link;
  subjects start with `[MOTORMATE]` and are ASCII (plates only in the body). Delivery isn't
  confirmed — only Sent/Failed. **Appointment emails that can't go out** (no email, or not
  confirmed) are recorded as `SKIPPED` and show as "Not sent — call the customer" under
  Sent emails; skipped service reminders aren't recorded, the next morning retries them.
  Locally (no `NOTIFY_TOPIC_ARN`) emails are written to the backend log. SES with a
  verified domain is the production plan (no per-address confirmation).
- **Invoices** (`backend/src/invoices`): `INV-0001`, VAT 7%, amounts frozen at completion.
  - Advisors/admins see all; customers only their own (others → 404); mechanics none (403).
  - "Mark as paid" is just a flag (advisor/admin, once, conditional update) — who paid it
    comes from the `invoice.paid` audit entry, so there is no extra column. No payment
    integration, no un-paying, `VOID` unused for now.
  - Printing uses the browser's print dialog; the app shell is hidden with `print:hidden`.
    Shop details (name, address, phone, email, tax ID) come from **Settings → Shop
    details** (`SettingsService.shop()`: the current shop's row, given at registration) — the
    page, the PDF, the email signature and "call us on …" messages. Opening hours stay in
    `SHOP.hours` (booking rules use them). A PDF already stored in S3 keeps the details it
    was made with.
  - **PDF** (`GET /invoices/:id/pdf` → `{ url, filename }`, same access as the invoice;
    `InvoicePdfService` + `renderInvoicePdf()` in `backend/src/invoices`): pdfkit with the
    embedded Sarabun Thai font (`backend/assets/fonts`, OFL). It's the invoice **as issued
    — no paid stamp**, so a stored copy never goes stale. With `INVOICE_BUCKET` (AWS) it's
    generated on first download, stored at `invoices/<invoiceId>/INV-0001.pdf` (key in
    `Invoice.pdfKey`, set once) and served as a 5-minute presigned S3 link; regenerated if
    the object is missing. Without a bucket (local) it's returned inline as a `data:` URL.
- **Reports** (`backend/src/reports`, range rules in `packages/types/src/report.ts`), **admin
  only** (others 403):
  - `GET /reports/summary?from=&to=` — every number on `/app/reports`; `GET /reports/revenue`
    — just invoiced / paid / unpaid (3 queries; the dashboard's "Revenue this month" card);
    `GET /reports/export/invoices|work-orders|parts` — CSV.
  - Ranges are Bangkok calendar days, end ≥ start, at most 366 days. The chart groups by day
    up to 31 days, by week (Monday) up to 92, then by month.
  - Revenue counts by **invoice date** (VOID excluded), with paid and unpaid beside it.
    Revenue only — no profit: parts used keep the price charged, not the cost at the time.
  - **Repeat customers:** of the customers with a job completed in the period, those with at
    least two completed jobs by its end (by the vehicle's current owner).
  - **Most performed services:** price-list lines counted per service (by its current name),
    with count and amount, then all custom lines as one "Other (custom lines)" row.
  - **Inventory turnover** for the period = parts used at today's unit cost ÷ stock value at
    cost today (no cost snapshot on parts used); the parts tables show used vs on hand.
  - CSVs are UTF-8 with BOM (Thai text in Excel), CRLF; cells starting `= + - @` get a `'` so
    Excel won't run them. The page downloads with the bearer token (fetch → blob).
  - `/app` (admin) shows six stat cards — open work orders, today's appointments, requests to
    confirm, revenue this month (→ `/app/reports`), low stock, due for service; the full
    report is `/app/reports`.
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
- **Duplicates:** VIN is a hard unique constraint within a shop. Same phone (customer) or same
  plate+province (vehicle) only raises a "possible duplicate" warning.
- **Visits** (`GET /customers/:id/visits`, admin/advisor, `VisitSummary`): every job on any of
  the customer's vehicles (cancelled included), newest check-in first, paged 10 on the
  customer page (`?visits=N`), with the invoice and paid/unpaid. No mechanic, notes or lines.
  Customers don't get this list: they have My Invoices and each vehicle's service history.
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
- **Multi-shop isolation** (`backend/src/common/tenancy`) — "lite": shops register
  themselves, customers link to several, a platform admin suspends.
  - **How it's enforced:** every request runs in an AsyncLocalStorage store
    (`TenancyMiddleware`); `JwtStrategy` puts the user's shop in it. A Prisma query extension
    (`shop-scope.extension.ts`) adds `shopId = <current shop>` to every query on a shop's
    tables (and through the parent for child tables), and refuses a create for another shop.
    Services keep writing `prisma.customer.findMany(...)` and can't forget the filter, so
    another shop's record is simply **not found (404)**. Fails closed: a request with no
    shop (public route, platform admin) touching a shop's table gets 403. `runAsShop()` /
    `runUnscoped()` are the explicit exits (sign-up, the daily jobs looping over shops, the
    platform list). Not covered automatically: raw SQL (Reports adds `inShop()` by hand) and
    `User` / `Shop` / `AuditLog` (staff queries filter on `shopId` themselves).
    `backend/test/shops.int-spec.ts` tries every kind of record across shops.
  - **Production plan** (final document): PostgreSQL row-level security as a second wall
    under the app filter — not built.
  - **Per shop:** WO-/INV- numbers (atomic counters on `Shop`), VIN, SKU, service names,
    customer emails, shop details, price list, reports, reminders. Logins (emails) are global.
  - **Registration** (`/register-shop`, public): shop details + first admin in one
    transaction; active at once; the admin is signed in. **Platform admin**
    (`/app/platform`): every shop with staff / customers / jobs in the last 30 days, Suspend
    (confirm dialog) / Reactivate, both audited (`shop.suspended` / `shop.reactivated`). A
    suspended shop's staff can't sign in, its customers can't open it, and it leaves the
    sign-up list; nothing is deleted.
  - **Customers:** pick a shop at sign-up; **My Shops** (`/app/shops`) links more (their
    existing record there is claimed when email and phone match, else one is created from
    their profile); the header's shop menu switches. One online account per phone still
    holds across all shops.
  - **Daily jobs** run once per active shop (`runAsShop`), summed.

## Current priority order (do not build out of order without checking in)

Team decided to build the **core workflow first**, then layer on the rest as time allows.
Target: feature-complete by **Nov 1, 2026**; Nov 2–10 is buffer, hardening, and docs.

1. **MVP (must ship):** auth + roles + staff management, Customer CRUD, Vehicle CRUD,
   Inventory CRUD, WorkOrder lifecycle (check-in → status transitions → parts-used with
   stock deduction → invoice on completion).
2. **Stretch, in priority order** (reordered Oct 22: appointments moved ahead of reminders,
   reporting after them): ~~invoice PDF to S3~~ (done), ~~Lite appointments~~ (done),
   ~~reminder engine~~ (done — SNS email, see Reminders), ~~reporting dashboard + CSV export~~
   (done — see Reports), ~~customer portal views~~ (done as far as planned: customers see
   their vehicles + service history, invoices, appointments and reminders; staff get each
   customer's Visits list — a separate customer "My visits" page was judged redundant).

If a feature isn't in the MVP list above, don't build ahead of it — ask the team first,
since scope is intentionally tight against the Nov deadline.

## Conventions

- TypeScript strict mode in both apps.
- **Button colours** (`Button` / `LinkButton` variants in `frontend/components/ui.tsx`, by
  meaning): blue `primary` = the normal next step; green `success` = forward/done (Confirm,
  Check in, Pass QC, Mark as paid, reminder Done); amber `warning` = going back or pausing
  (Waiting for parts, Fail QC, Reschedule); red `dangerOutline` on list rows and pages
  (Cancel, No-show, Dismiss) with solid `danger` only for the confirm button in a dialog;
  grey `secondary` = Edit/Back/Download. Named actions use the shared `ACTION_VARIANT` map.
  Every button keeps its text.
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
- Tests: Jest for unit tests in both apps; API + real-Postgres integration tests
  (`backend/test`); `infra/scripts/smoke.sh` against a deployed environment. **End-to-end
  browser tests** are a separate team task (CLOUDAPPG3-161): Robot Framework or Playwright,
  to be confirmed with the professor — scenarios and logins in `docs/e2e-handoff.md`. New
  MVP-list features should land with at least one test; stretch features can follow up.

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

## Team workflow (read this when picking up the project)

Several team members build MotorMate, each with their own Claude Code. These are the habits
the build has followed so far — keep them.

**Where things stand (Nov 7, 2026).** Merged: Steps 1–5 (schema + auth, customers / vehicles
/ inventory, work orders + invoices, AWS deployment, invoice PDF, appointments, reminder
engine), reports (PR #21), list filters + sorting (PR #22), status buttons / colours /
appointment filters (PR #23), customer Visits list (PR #24; the customer-side "My visits",
135, was dropped — invoices + vehicle history cover it), Step 10 — demo readiness (demo seed,
wider smoke test, end-to-end hand-off; Jira 158–161), Step 11 — check-in journey fixes +
inventory turnover / labour lines in Reports (162–164; PR #26) and Step 12 — Settings page:
shop details + the price list, used by labour lines, bookings and Reports (136–140, 165;
PR #27) and Step 13 — a required reason for list-price changes, My appointments width,
scrolling tables (166–167; PR #28). Step 14 — the demo account in "full" mode: CloudFront
with the ALB locked to it, least-privilege roles, Secrets Manager, Multi-AZ + a failover
test (168–171; PR #29) and Step 15 — multi-shop "lite" + platform admin (174–177; PRs #30,
#31). **The demo account is deployed** (Nov 7, main at `14c07ca`: smoke test 20/20, scripted
multi-shop checks 22/22) and stays up until the Nov 17 presentation — don't run `down.sh`
there. **Next:** the final document, end-to-end tests (161), code freeze Nov 10.

**Commits and PRs**
- Claude never commits or pushes; it hands over the commands. Several **small,
  single-module commits** (types / db / one backend module / frontend / infra / docs), each
  as its own `git add …` + `git commit …` block — never one big commit.
- **No Claude attribution anywhere**: no `Co-Authored-By: Claude` trailer, no "Generated
  with Claude Code" line in PR descriptions.
- Every step report ends with a paste-ready PR title + description (summary, included,
  tests and browser checks, not included, base branch if stacked, Jira tickets).
- Only commit files the step changed — never someone's unrelated local edits (e.g. to
  `docker-compose.yml` or `.env.example` files).

**Jira** (site `des424-g3.atlassian.net`, project `CLOUDAPPG3`, cloudId
`0320bc05-a2cf-43d7-b1cd-9553e51755fb`; Claude uses it through the Atlassian connector —
connect it with your own Jira login)
- Module epics: 2 Dashboard & App Shell · 3 User Management · 89 Customer & Vehicle ·
  91 Service & Work Order · 92 Inventory · 90 Notification & Reminder · 104 Appointment ·
  105 Reporting & Analytics · 5 / 58 AWS deployment. Leave epics 1, 4, 6, 57, 88 alone.
- Tasks are titled `[Frontend] …` / `[Backend] …` under their module epic; new work gets new
  tickets in the right epic.
- At the **start** of a step move its tickets To Do → In Progress (transition id `4`); at
  the **end** add a short comment (what was built, how it was verified) and move them to
  In Review (transition id `5`, "Done Implementing").
- **Never move a ticket to Done** — the team does that after reviewing the PR.

**Local machine (Windows)**
- Run repo scripts from **Git Bash**, not PowerShell or WSL (`bash` may point at WSL; use
  `"C:\Program Files\Git\bin\bash.exe"` if so).
- The **AWS CLI v2** must be on Git Bash's `PATH`. If `aws --version` says "command not
  found" (the scripts then report "AWS credentials missing or expired"), open a new Git Bash
  window, or add it once:
  `echo 'export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"' >> ~/.bashrc` (per-user
  installs live in `/c/Users/<you>/AppData/Local/Programs/Amazon/AWSCLIV2`).
- Dev servers are often already running on :3000 / :8080 — check before starting new ones.
- Browser tests: note the UTC time first, then delete the rows you created (children first)
  and restore anything you changed; leave the seed data as it was.
- The demo account stays up until the Nov 17 presentation: don't run `down.sh` or `nuke.sh`
  there before then. Afterwards, `bash infra/scripts/nuke.sh --yes` removes everything.

**For the final project document** (graded against the kickoff report): every change of
design needs a one-line "why". So far: no domain → HTTPS from CloudFront's default
certificate; Amplify → frontend as an ECS container (Amplify restricted); Cognito →
NextAuth + our own JWT; private subnets + NAT → public subnets with locked-down security
groups (NAT too expensive); SES → SNS email (SES is sandbox-only and we have no domain);
Multi-AZ (for one shop, single-AZ with point-in-time backups would do; Multi-AZ shows the
design scales); one shop → many shops on one deployment (shared
tables with a `shopId` and an automatic app-level filter; row-level security in PostgreSQL
is the production plan) with self-registration and a platform admin to suspend shops;
reports show revenue, not profit (no cost snapshot on parts used); no customer "My visits"
page (My Invoices + each vehicle's service history already show it; staff get a Visits list
per customer); labour is a fixed-price list plus custom lines ("middle way": mechanics may
add custom lines, the advisor checks them at QC) — hourly estimates with customer approval
are future work.

## Local development

See `README.md` for full setup steps. Quick reference:

```bash
docker compose up -d          # start local Postgres
pnpm install                  # install all workspace deps
npm run db:migrate             # apply schema to local DB (`prisma migrate dev`), then `npm run db:generate`
npm run db:generate            # regenerate the Prisma client — Prisma 7's migrate no longer does it
npm run db:seed                # populate sample data — alias for `pnpm --filter backend exec prisma db seed`
npm run db:seed:demo           # add ~6 months of demo history on top (runs once)
npm run dev:backend            # build packages/types, then run backend (NestJS) on :8080/v1
npm run dev:frontend           # build packages/types, then run frontend (Next.js) on :3000
npm run test                   # build packages/types, then Jest unit tests in every package
npm run test:integration       # backend HTTP + real-Postgres tests (see below)
pnpm lint                      # ESLint: backend (eslint.config.mjs, ESLint 9) + frontend (next lint, ESLint 8)
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
  The API image has no Prisma CLI (that keeps it small): migrations run from a separate
  image, `docker build -f backend/Dockerfile --target migrate`, once per deploy before the
  API rolls out. The seed is compiled into the API image: `node dist-seed/prisma/seed.js`.
  Whole app in containers locally: `docker compose --profile app up --build`.
- **Image size** (unpacked / compressed in ECR): backend 299 / 66 MB, migrate 381 / 91 MB,
  frontend 229 / 58 MB. All three run on a bare `alpine:3.24` with only the `node` binary
  copied from `node:22-alpine3.24` (no npm/yarn/corepack; keep the two Alpine versions in
  step). The migrate image's Prisma CLI is pruned (Studio UI, PGlite, MySQL, other
  databases' compilers — the CLI still requires `@prisma/studio-core` and `@prisma/dev`
  at start-up, so those stay). After a Prisma upgrade, re-check by running the migrate
  image against an empty database.

Seeded logins (password `password123`): `admin@`, `advisor@`, `mechanic@motormate.example`,
customer `jordan.lee@example.com`, platform admin `platform@motormate.example`. All in the
shop `shop_main` (MotorMate Auto Service).

**Demo data** (`backend/prisma/seed-demo.ts`, `npm run db:seed:demo`; on AWS
`bash infra/scripts/seed.sh --demo`): ~6 months of history on top of the seed — 12
customers ([demo] in their notes; `ploy.s@` / `anan.r@example.com` have logins), 15
vehicles, 45 completed jobs with invoices (most paid), one open job per status, a second
mechanic (`mechanic2@`), stock purchases + parts used as movements, routine labour linked to
the price list (`prisma/price-list.ts`, 8 services, also in the plain seed), recommendations in every
reminder state, appointments in every status. Dated relative to today, seeded random (same
every run), sends nothing. The main shop's history and the second shop each run once (each
is added if it's missing, so a database seeded before multi-shop gets the second shop on the
next run). Also a **second shop**,
Siam Garage (`shop_siam`, admin `admin@siamgarage.example`), with its own price list and 3
customers — Jordan is linked to it too, so the shop switcher has something to switch.
`backend/test/seed-demo.int-spec.ts` checks it keeps the app's rules (invoice totals, stock
= movements, one open job per vehicle, mileage up, shop-hour slots).

`prisma migrate dev` refuses to run in non-interactive shells (e.g. Claude Code). To add
a migration there: write the SQL with `prisma migrate diff --from-config-datasource
--to-schema prisma/schema.prisma --script` into a new `prisma/migrations/<timestamp>_<name>/`
folder, review it, then apply it with `prisma migrate deploy`.

## Environment variables

Three separate `.env.example` templates, each scoped to what actually reads it (`.env`
files themselves are gitignored, never committed):

- `.env.example` (repo root) — Postgres/pgAdmin credentials, read by `docker-compose.yml`.
- `backend/.env.example` — `DATABASE_URL` (Prisma), `JWT_SECRET`, `PORT`, `CORS_ORIGIN`.
  On AWS only: `DATABASE_SSL_CA` — RDS requires SSL, so the pg driver verifies the server
  against the RDS certificate bundle baked into the image (`pgConfig()` in
  `backend/src/prisma/pg-config.ts`, used by PrismaService and the seed); `INVOICE_BUCKET`
  — the S3 bucket for invoice PDFs (unset locally → PDFs come back inline);
  `NOTIFY_TOPIC_ARN` — the SNS topic for customer emails (unset locally → logged);
  `JOB_TOKEN` — the secret the daily-jobs Lambda sends (unset → `/jobs` is off).
- `frontend/.env.example` — `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_API_URL`
  (includes `/v1`), and `API_INTERNAL_URL` (AWS only — see "API address" above).

Values that must agree **across files**:

- `DATABASE_URL`'s embedded credentials (backend) must match `POSTGRES_USER`/
  `POSTGRES_PASSWORD`/`POSTGRES_DB` (root) — same Postgres instance (the frontend never
  talks to the database directly).
- `NEXT_PUBLIC_API_URL` (frontend) points at the backend; `CORS_ORIGIN` (backend) is the
  frontend's origin.
- `NEXTAUTH_SECRET` and `JWT_SECRET` do **not** need to match (see Auth architecture).

## AWS deployment (the course's demo account)

- **Demo account (528301714999):** a shared course account (other teams' stacks are there too)
  where our IAM user `des424-126-g03` may do almost anything except manage IAM users/groups.
  Budget ≈ 4,000 baht; everything is deleted after the course. Use it through the
  `motormate-demo` CLI profile (`export AWS_PROFILE=motormate-demo`); the scripts only touch
  `motormate-*` resources. It stays up through the Nov 17 presentation.
- **What runs there:** **CloudFront** (`/_next/static/*` cached, the rest passed through) → ALB
  that only accepts CloudFront's origin-facing prefix list **and** a secret `X-Origin-Verify`
  header (else 403) → ECS Fargate (2 frontend + 2 backend tasks). Five **least-privilege roles**
  in the base stack (execution, backend task: our bucket's `invoices/*` + our SNS topic, a
  no-permission task role, Lambda, Scheduler). **Secrets Manager** (`motormate/app-<stack id>`,
  `motormate/db-<stack id>` — named per stack because a deleted secret keeps its name for 7
  days). The frontend server reaches the API over Cloud Map private DNS
  (`backend.motormate.local:8080`). The stacks also have a `Mode` switch for AWS Academy
  accounts; that mode is described at the top of `infra/cloudformation/app.yml`.
- Infrastructure lives in the repo as scripts/CloudFormation (no CDK).
- Cost rules: Fargate tasks in public subnets with public IPs — **no NAT Gateway**;
  RDS `db.t3.micro`, Multi-AZ, with automated backups and encryption at rest.
- No custom domain → Route 53 / ACM-with-own-domain are "production plan" items in the
  final document; HTTPS comes from CloudFront's default `*.cloudfront.net` certificate.
- Secrets (`JWT_SECRET`, `NEXTAUTH_SECRET`, DB password, `JOB_TOKEN`, `ORIGIN_SECRET`) are
  generated into `infra/.secrets/<account>.env` (gitignored), passed as hidden (`NoEcho`) stack
  parameters and stored in Secrets Manager; the containers and the Lambda read them from there.
- **`infra/`** (guide: `infra/README.md`): three CloudFormation stacks —
  `motormate-base` (VPC, public + isolated subnets, security groups, ECR, ECS cluster, log groups,
  invoice bucket, SNS topic, IAM roles; kept), `motormate-db` (RDS PostgreSQL 16 `db.t3.micro`,
  encrypted, 7-day backups, Multi-AZ) and `motormate-app` (ALB, ECS services, CloudFront,
  daily-jobs Lambda + 2 schedules, the app secret and private DNS).
  Scripts in `infra/scripts/` (Git Bash): `up.sh [--multi-az] [--frontend-count N]`
  (base → db + images in parallel → `migrate.sh` → app → seed; options left out keep their
  deployed value), `smoke.sh` (also checks the ALB refuses direct requests), `status.sh`,
  `seed.sh [--demo]`, `build-push.sh`, `failover-test.sh [--tasks|--all]` (forces an RDS
  failover / stops a task per service while polling the site, reports the outage), `down.sh`
  (deletes app + db) and `nuke.sh --yes` (deletes everything; after the course). Images are
  tagged with the git commit; re-running `up.sh` after a commit rolls out the new version.
  `deploy_stack` passes `CAPABILITY_IAM` (the base stack creates roles).
- Running cost ≈ $0.13/hour (4 tasks, Multi-AZ RDS; CloudFront and Secrets Manager are cents a
  day). Prefer the AWS MCP for ad-hoc AWS checks; the scripts themselves use the AWS CLI.

## Parked ideas (nice-to-have, not scheduled)

Agreed as good ideas, deliberately not built so the MVP stays on schedule. Don't build
without the team deciding first. **`docs/backlog.md`** has the detailed build notes for
what's left: hourly labour with estimates (the second half of the price list below). Built
items are removed from it.

- **Labour price list (hybrid pricing).** The fixed-price half is built (Step 12: routine
  jobs from Settings → Services & prices, custom lines for the rest). Still parked:
  - **Unpredictable repairs → hours × shop hourly rate** (engine diagnostics, electrical
    troubleshooting, oil leaks, suspension rebuilds), entered as an **estimate** the
    customer approves before work starts; actual hours recorded; re-approval if it runs
    over. Often with a fixed diagnostic fee.
  - Data: a `type: FIXED | HOURLY` on the price list (price or standard hours), a shop
    hourly-rate setting, and estimated/actual hours on labour lines.

## Explicitly out of scope for now

- Multi-branch support *within one business* (shared stock, staff across branches). Separate
  shops are supported (Step 15), each fully on its own.
- SMS reminders — email only.
- Cognito — replaced by NextAuth.js, don't reintroduce without discussion.
- Appointment slot/capacity management, drag-and-drop calendars — appointments are "Lite".
- Customer email verification — documented as the production plan only.
- Countries other than Thailand for phone numbers and plates.