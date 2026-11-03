# Step 7 plan — list filters + sorting (and finishing Step 6)

Status: **built** (Nov 3, 2026) on `feat/list-filters`. Decisions taken:
1. invoice presets This month / Last month / All time + custom, no 12-month limit;
2. the invoice date filter is for staff only;
3. work orders filter on the check-in date;
4. inventory sorts by SKU, Name, On hand and Price;
5. phones get a "Sort by" dropdown;
6. appointment filters are not in this step.

**Changed after the first build (Nov 3, team decision):** the screens filter by **month and
year** instead of From/To dates.
- Two dropdowns (Year: All years, then this year back to 2022, Gregorian; Month: Whole year,
  then Jan–Dec), plus "This month" / "Last month" shortcuts.
- The URL is `?year=&month=`, and the page turns it into the API's `from`/`to`, so the API
  and its tests are unchanged.
- Why: shops review invoices and jobs by month (bookkeeping, VAT), dropdowns are quicker
  than typing dates, and the browser's own date box followed the browser language
  (`วว/ดด/ปปปป`).
- Work orders show the filter only on the Completed / Cancelled tabs. Open jobs are all
  current, and switching back to Open clears it.
- The Reports page keeps a range, but the custom one is picked as whole months:
  From [month][year] To [month][year], from the 1st of the start month to the end of the
  end month. The same 12-month limit applies. The URL and API are unchanged (`?from=&to=`),
  so the CSVs and the dashboard card didn't change, and an exact-day link still loads.

Changes from the plan:
- `dir` is optional (missing = ascending), so existing callers didn't change.
- The date filter sits under the filter bar on both pages rather than inside
  `WorkOrderFilters`.
- An invalid `?sort=` in the URL falls back to the default order, like invalid dates do.

## Part A — finish Step 6 (reports) before it merges

**Done on `feat/reports` (Nov 3).** A1, A2, A4, A5 and A7 are fixed. A3 needed nothing:
`main` had already moved to those action versions (PR #20). A6: Rachapol's "Dashboard"
commit is kept as it is, and the fixes are separate commits on top of it.

The `Pal` branch (commit `bedbfeb "Dashboard"`) builds the reports from `docs/step-6-plan.md`:
`backend/src/reports` (summary + 3 CSV exports, admin only), `packages/types/src/report.ts`,
and the report widgets on the **admin dashboard**. Typecheck and the 315 unit tests pass.
Before it can merge:

| # | Problem | Fix |
|---|---|---|
| A1 | `pnpm lint` fails: 17 unused imports in `frontend/app/app/page.tsx` (CI's lint job will be red) | Remove them |
| A2 | `backend/.env.example` is garbled — the JWT comment, `JWT_SECRET` and `PORT=8080` got pasted into the middle of the SNS comment (`PORT=8080ad of sent.`) | Restore it from `main` (no change was intended) |
| A3 | CI action versions bumped (`checkout@v7`, `setup-node@v7`, `pnpm/action-setup@v6`) inside a reports commit | Revert unless intended; if intended, its own `ci:` commit after checking those tags exist |
| A4 | Sidebar **Reports** still opens "Reports is coming soon" | Decision 1 below |
| A5 | No tests for reports (the plan promised unit + integration tests) | Unit: `csvCell` escaping, `ReportQuerySchema`, `reportBuckets`, `fillSeries`, `noShowRate`. Integration: exact totals on known invoices, 403 for advisor/mechanic/customer, CSV header + BOM |
| A6 | One commit "Dashboard" across types/backend/frontend/ci; branch `Pal` | Split into single-module Conventional Commits on `feat/reports` |
| A7 | CLAUDE.md still says Step 6 is "next"; `step-6-plan.md` says "not started" | Update both; record the decisions taken |

## Part B — filters and sorting

### What's worth doing (and what isn't)

Lists are **paged on the server** (20 per page), so sorting must happen in the API — sorting
in the browser would only reorder the 20 rows on screen.

| Page | Today | Proposal | Why |
|---|---|---|---|
| **Invoices** | search + Paid/Unpaid | **Issued date range** with quick buttons (This month, Last month, Custom) | Monthly bookkeeping / VAT filing is the real use; reuses the report presets |
| **Inventory** | search, category, low stock | **Click-to-sort columns**: SKU, Name, On hand, Price | Stocktakes go by SKU; "lowest on hand" is a common question |
| **Work orders** | Open/Completed/Cancelled, mechanic, search | **Check-in date range** in the filter bar | The API already supports `from`/`to` — only the UI is missing |
| Appointments | tabs + search | Already in `docs/backlog.md` #3 — leave there unless time remains | Tabs cover the daily use |
| Customers, Vehicles, Staff, Reminders | search | **No change** | Search by phone / plate / name is how staff find records; sorting a 20-row page by name adds little |

### Backend

- `packages/types`:
  - `DateRangeQuery` fields (`from`, `to`, yyyy-mm-dd Bangkok days, `to` ≥ `from`) shared by
    invoices and work orders — reuse the day check from `report.ts`.
  - `InvoiceListQuerySchema` + `from`, `to` (on `issuedAt`).
  - `InventoryListQuerySchema` + `sort: "sku" | "name" | "quantity" | "price"` and
    `dir: "asc" | "desc"` — a **whitelist**, never a raw column name. Default stays as today
    (active first, category, name).
- `InvoicesService.list()` adds `issuedAt: { gte, lt }` (Bangkok midnight, like
  `reportPeriod()`); customers stay scoped to their own invoices.
- `InventoryService.list()` maps `sort`/`dir` to `orderBy`, with `name` as the tie-breaker so
  paging is stable.
- `WorkOrdersService`: already done; switch its `from`/`to` to the shared schema so a bad
  date gives a 400 with a message.
- Tests: schema unit tests (bad dates, `to` before `from`, unknown sort → 400); one
  integration test each for the invoice range and inventory sort.

### Frontend

- Shared `SortHeader` (`frontend/components/ui.tsx`): a `<th>` link that toggles
  `?sort=&dir=` in the URL (keeps the other params, resets `page`), with ▲/▼ and
  `aria-sort`.
- Shared `DateRangeFilter`: quick buttons + from/to inputs, written to the URL (same pattern
  as `ReportRange`, which can then use it too).
- Invoices page: range filter above the table; the empty state says "No invoices in this
  period". Customers get the same filter.
- Inventory page: SKU / Name / On hand / Price headers become `SortHeader`.
- Work orders page: date range added to `WorkOrderFilters`.

### Wireframes

```
Invoices
[Search invoice, plate, customer…]  [All][Unpaid][Paid]
Issued: [This month][Last month][All time]  From [2026-10-01] To [2026-10-31]
┌ Invoice ─┬ Vehicle ─┬ Customer ─┬ Issued ─────┬ Total ──┬ Status ┐
│ INV-0042 │ 1กข 1234 │ J. Lee    │ 31 Oct 2026 │ ฿4,815  │ Paid   │
```

```
Inventory
[Search…] [Category ▾] [☐ Low stock]
┌ SKU ▲ ──┬ Name ────────┬ Category ┬ On hand ┬ Price ──┐
│ OIL-001 │ Oil 5W-30 4L │ Fluids   │     12  │ ฿700.00 │
   (click a header: ascending → descending; ▲/▼ shows the current order)
```

## Open decisions (recommendation first)

Decided Nov 3: reports live on `/app/reports`, admin only.

1. **Invoice range presets:** **This month / Last month / All time + custom** (no 12-month
   cap on a list) — or reuse the report presets exactly.
2. **Inventory sort columns:** **SKU, Name, On hand, Price** — or also Category / Cost.
3. **Appointments filters (backlog #3):** **not in this step** — or add them if Part A+B
   finish early.

## Out of scope

Saved filters, multi-column sort, sorting on Customers/Vehicles/Staff, CSV export of filtered
lists (admins already have the report CSVs), appointment filters (backlog #3).

## Jira

Part A (epic 105), as of Nov 3:
- In Review: CLOUDAPPG3-47 (revenue), -49 (inventory usage), -119 (CSV export).
- In Progress: CLOUDAPPG3-36 (API) and -48 (service stats). Still missing: a repeat-customer
  rate and "most-performed services" (labour lines are free text until the price list,
  CLOUDAPPG3-136).
- To Do: CLOUDAPPG3-50 (repeat-customer report, not built).

Part B:
- CLOUDAPPG3-149 / -150: invoice date range, backend / frontend (epic 91).
- CLOUDAPPG3-151 / -152: inventory sorting, backend / frontend (epic 92).
- CLOUDAPPG3-153: work-order date range filter (epic 91).
- Appointment filters already have tickets: CLOUDAPPG3-131 / -132.
