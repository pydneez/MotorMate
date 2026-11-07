# End-to-end tests — hand-off

Jira: **CLOUDAPPG3-161**. Browser tests for the main flows, written by whoever picks this up.
**Tool:** confirm with the professor — **Robot Framework** (SeleniumLibrary or the Browser
library, which drives Playwright) or **Playwright** directly. The scenarios below don't
depend on the tool.

What's already covered, so these tests can focus on the screens: 385 unit tests (backend
376, frontend 9), 133 API + real-database integration tests in 10 suites
(`npm run test:integration`, including `shops.int-spec.ts` for isolation between shops), and
`infra/scripts/smoke.sh` against a deployed environment.

**What the final report needs from this task** (section 13.2, a placeholder until then):
for each scenario, the test script and a screenshot of its result (for Robot Framework the
`log.html` / `report.html` summary; for Playwright the HTML report), plus one line on how
to run them. Scenarios 1, 2, 4 and 9 are the minimum; the example report from an earlier
year (QikVid) used login/logout, sign-up and two main flows.

## Running the app for the tests

Follow `README.md` → Getting started, then:

```bash
docker compose up -d          # Postgres
npm run db:migrate            # schema (first time)
npm run db:seed               # logins + a small sample
npm run db:seed:demo          # ~6 months of demo history (optional, recommended)
npm run dev:backend           # API on http://localhost:8080/v1
npm run dev:frontend          # site on http://localhost:3000
```

- Tests that **change** data (check-in, status moves, bookings, mark as paid) should create
  their own customer/vehicle first, or run against a database you can reset:
  `pnpm --filter backend exec prisma migrate reset` (drops everything, re-seeds).
- Against AWS: the site is the `SiteUrl` output of `motormate-app` (`bash infra/scripts/status.sh`).

### Logins (password `password123` for all)

| Role | Email | Notes |
|---|---|---|
| Admin | `admin@motormate.example` | Everything, incl. Reports and Staff |
| Advisor | `advisor@motormate.example` | Customers, work orders, appointments, invoices, reminders |
| Mechanic | `mechanic@motormate.example` | Only jobs assigned to them; no Pass QC / Cancel |
| Mechanic 2 | `mechanic2@motormate.example` | Demo data only |
| Customer | `jordan.lee@example.com` | Own vehicles, appointments, invoices |
| Customer | `ploy.s@example.com`, `anan.r@example.com` | Demo data only, with history |
| Platform admin | `platform@motormate.example` | Only the Shops page: every shop, Suspend / Reactivate |
| Admin, 2nd shop | `admin@siamgarage.example` | Demo data only: Siam Garage, whose records the first shop must never see |

Jordan is linked to both shops in the demo data: the shop name in the top bar is a menu to
switch. Shops register at `/register-shop`; customers pick their shop when signing up.

## Finding things on the page

Prefer what a user sees — labels, button text, headings, ARIA roles — over CSS classes
(Tailwind classes change). Useful anchors:

- **Login:** fields labelled `Email` / `Password`, button `Sign in`.
- **Sidebar:** links named after the section (`Work Orders`, `Customers`, `Reports` …).
- **Tabs:** `role="tab"` with `aria-selected` (work orders, appointments).
- **Dialogs:** `role="dialog"`; the confirm button is the last button in it.
- **Shop menu (customers):** the shop name in the top bar is a `button` with
  `aria-haspopup="menu"`; the menu shows "Your shops", one item per shop (the current one
  has a tick, `aria-label="Current shop"`) and the link `Link another shop`. Staff see the
  shop name as plain text.
- **Sign-up:** the shop picker is the select labelled `Your garage`; leaving it empty shows
  "Choose your shop".
- **Register your shop** (`/register-shop`): fields `Shop name`, `Address (up to 4 lines)`,
  `Phone`, `Email (optional)`, `Tax ID`, `First name`, `Last name`, `Email`, `Password`,
  `Confirm password`; button `Register shop`.
- **Platform shops** (`/app/platform`): one table row per shop; `Suspend` opens a dialog
  whose confirm button is `Suspend shop`; a suspended row has the badge `Suspended` and a
  `Reactivate` button.
- **My Shops** (`/app/shops`): `Link this shop` / `Switch to this shop` per shop.
- **Work order:** status buttons are named for the action (`Start diagnosis`, `Start repair`,
  `Waiting for parts`, `Parts arrived — resume`, `Send to quality check`,
  `Pass QC & invoice`, `Fail QC — back to repair`, `Cancel job`); the progress bar is
  `aria-label="Job progress"` with `aria-current="step"` on the current step.
- **Sortable inventory headers:** links with `aria-sort` on the `<th>`.
- **Month/year filters:** selects whose first option is `All years` / `Whole year`.
- If something can't be found reliably, add a `data-testid` in the component (small PR).

## Scenarios (priority order)

1. **Sign-in and roles**
   - Each login lands on its dashboard (admin sees 6 cards incl. "Revenue this month").
   - Wrong password shows an error; signed-out `/app/...` redirects to `/login`.
   - Advisor opening `/app/reports` and mechanic opening `/app/customers` see "You don't have
     access to this page"; the sidebar doesn't show those items.
2. **Walk-in to invoice (the core flow)** — as advisor:
   - Work Orders → Check in vehicle → walk-in mode: new customer + vehicle + complaint.
   - Assign the mechanic; as mechanic: Start diagnosis → Start repair; add a labour line
     and a part (stock on hand drops by the quantity on the inventory page).
   - Send to quality check; as advisor: Pass QC & invoice → lands on the invoice
     (INV-…, VAT 7 %, total = labour + parts + VAT); Mark as paid → badge "Paid".
   - The progress bar shows the current step at each point.
3. **Failed QC and waiting for parts:** Waiting for parts shows the amber pause; Fail QC needs
   a note and returns to In progress; Cancel job returns the parts to stock.
4. **Customer self-service** — sign up at `/register`, add a vehicle, book an appointment
   (Mon–Sat, 30-minute slots, ≥ 2 h ahead), see it as "Requested"; as advisor: Confirm
   (green) → customer sees "Confirmed".
5. **Appointment check-in:** advisor "Check in" on a confirmed booking → prefilled check-in
   form → job created, appointment shows Checked in.
6. **Lists:** inventory header sort (▲/▼, survives paging); invoices Year/Month filter and
   the Paid/Unpaid tabs keep it; work orders Completed tab + month; appointments **All**
   tab with status tick boxes and Booked by.
7. **Reports (admin):** presets change the period; From/To month range; "Choose at most 12
   months" on a 13-month range; CSV download button gives a file.
8. **Customer page (advisor):** Visits list shows the customer's jobs with invoice links.
9. **Register a shop:** fill `/register-shop` (use a unique email, e.g. with a timestamp) →
   lands on `/app` with the new shop's name in the top bar; Customers and Settings →
   Services & prices are empty.
10. **Isolation in the browser:** as `admin@siamgarage.example`, open the URL of a
    MotorMate Auto Service customer or work order (copy it as `admin@motormate.example`
    first) → the 404 page ("This page could not be found"); the Customers list shows only Siam Garage's 3 customers.
11. **Customer in two shops:** as `jordan.lee@example.com`, open the shop menu → choose
    Siam Garage → My Vehicles shows the Honda Jazz only; switch back → the Civic and
    Fortuner. Signing out and in again opens the last shop used.
12. **Platform admin:** as `platform@motormate.example`, `/app` redirects to the Shops page;
    Suspend the shop created in scenario 9 → signing in as its admin shows "This shop has
    been suspended"; Reactivate → sign-in works again. (Suspend only a shop the test made;
    never Siam Garage or MotorMate Auto Service on the demo site.)

## Notes

- Times are Bangkok (UTC+7); booking rules use the shop's hours (`SHOP.hours`).
- Emails aren't sent locally (they're written to the backend log), so don't assert on them.
- Tests that create shops or customers leave them behind: use a database you can reset
  locally, and on the demo site only read, or suspend only what the test itself created.
- Run against a production build (`docker compose --profile app up --build`) if dev-mode
  page compiles make the first visits slow.
