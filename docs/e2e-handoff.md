# End-to-end tests — hand-off

Jira: **CLOUDAPPG3-161**. Browser tests for the main flows, written by whoever picks this up.
**Tool:** confirm with the professor — **Robot Framework** (SeleniumLibrary or the Browser
library, which drives Playwright) or **Playwright** directly. The scenarios below don't
depend on the tool.

What's already covered, so these tests can focus on the screens: ~350 backend unit tests,
~100 API + real-database integration tests (`npm run test:integration`), and
`infra/scripts/smoke.sh` against a deployed environment.

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

## Finding things on the page

Prefer what a user sees — labels, button text, headings, ARIA roles — over CSS classes
(Tailwind classes change). Useful anchors:

- **Login:** fields labelled `Email` / `Password`, button `Sign in`.
- **Sidebar:** links named after the section (`Work Orders`, `Customers`, `Reports` …).
- **Tabs:** `role="tab"` with `aria-selected` (work orders, appointments).
- **Dialogs:** `role="dialog"`; the confirm button is the last button in it.
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

## Notes

- Times are Bangkok (UTC+7); booking rules use the shop's hours (`SHOP.hours`).
- Emails aren't sent locally (they're written to the backend log), so don't assert on them.
- Run against a production build (`docker compose --profile app up --build`) if dev-mode
  page compiles make the first visits slow.
