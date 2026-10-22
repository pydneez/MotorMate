# Step 6 plan — reporting dashboard + CSV export

Status: **planned, not started.** Proposed Oct 23, 2026. Per the working agreement in
CLAUDE.md, confirm the open decisions below with the team (and get a go-ahead) before
building. Branch: `feat/reports` from `main`. Jira epic: 105 Reporting & Analytics — match
its tickets to this plan and move them to In Progress when the step starts.

## What this step covers

- **In:** a **Reports** page for the shop owner (`/app/reports`, already in the menu as
  admin-only). It covers:
  - revenue, jobs and mechanics, parts, and bookings;
  - any date range;
  - CSV downloads for Excel;
  - the admin dashboard's "Revenue this month" card, which is currently a placeholder.
- **Out:** profit and margins (decision 3), PDF reports, emailed or scheduled reports,
  saved report filters, and customer portal views (the last stretch item).

## Backend: new `reports/` module (admin only)

| Endpoint | Returns |
|---|---|
| `GET /reports/summary?from=&to=` | Every number on the page for that date range (Bangkok calendar days) |
| `GET /reports/export/invoices?from=&to=` | CSV: one row per invoice |
| `GET /reports/export/work-orders?from=&to=` | CSV: one row per completed or cancelled job |
| `GET /reports/export/parts?from=&to=` | CSV: one row per part used |

**What the summary contains:**
- **Revenue:** invoiced (before VAT, VAT, total), paid vs still unpaid, labour vs parts, and a
  chart of invoiced amount by day, week or month.
- **Jobs:** completed and cancelled counts, average time from check-in to completion, jobs
  open right now by status, and per mechanic: jobs completed and labour billed.
- **Parts:** top 10 parts by quantity and by revenue; stock value at cost (as of today) and
  the low-stock count.
- **Bookings and reminders:** appointments by outcome (completed / no-show / cancelled),
  no-show rate, new customers, and reminder emails sent.

**Rules:**
- The date range is shared in `packages/types` (`ReportQuerySchema`): end not before start,
  at most 12 months, both Bangkok days.
- Totals are added up in the database (`prisma` aggregates / `$queryRaw`); the chart's
  grouping by day, week or month uses Bangkok time (`AT TIME ZONE 'Asia/Bangkok'`).
- CSVs open correctly in Excel with Thai text (UTF-8 with BOM). Cells starting with `=`,
  `+`, `-` or `@` are escaped so Excel can't run them as formulas. File names look like
  `motormate-invoices-2026-10-01_2026-10-31.csv`. The page downloads them with the API
  token (fetch → blob), since the API uses a bearer token, not cookies.
- Advisors, mechanics and customers get **403**.

**Tests:**
- Unit: date-range checks, CSV escaping (commas, quotes, Thai, formula cells), the summary
  arithmetic.
- Integration: known invoices, jobs and parts in the test database checked against exact
  totals; role checks; CSV header and rows.

## Frontend

- **`/app/reports`:**
  - **Date range:** quick buttons (This month, Last month, Last 3 months, This year,
    Custom from–to), kept in the URL.
  - **Content:** number tiles, a bar chart and tables for each section above.
  - **Downloads:** three CSV buttons.
- **Admin dashboard:** "Revenue this month" becomes real and links to the Reports page.

## Wireframe

```
Reports                                   [This month][Last month][3 months][This year][Custom]
                                          From [2026-10-01]  To [2026-10-31]
┌ Invoiced ──────┐┌ Paid ─────────┐┌ Unpaid ───────┐┌ Jobs completed ┐
│ ฿48,200.00     ││ ฿41,000.00    ││ ฿7,200.00 (3) ││ 27  avg 1.8 d  │
│ excl. VAT ฿45k ││               ││               ││ 2 cancelled    │
└────────────────┘└───────────────┘└───────────────┘└────────────────┘
Revenue by day                                   Labour ฿21,300 · Parts ฿23,700
 █ ▆ ▂ █ ▇ ▃ ▅ ...  (bars, hover = amount)
┌ Mechanics ───────────────────────┐ ┌ Top parts ────────────────────────┐
│ Sam P.     12 jobs  ฿9,800 labour │ │ Oil 5W-30 4L   18 × · ฿12,600     │
│ Niran K.    9 jobs  ฿7,100 labour │ │ Oil filter Hon 15 × · ฿2,250      │
└───────────────────────────────────┘ └───────────────────────────────────┘
┌ Bookings ────────────────────────┐ ┌ Now ──────────────────────────────┐
│ 31 booked · 25 done · 2 no-show  │ │ 5 open jobs · 3 low-stock parts    │
│ No-show rate 6% · 8 new customers│ │ Stock value at cost ฿84,500        │
└───────────────────────────────────┘ └───────────────────────────────────┘
Download CSV:  [Invoices]  [Work orders]  [Parts used]
```

## Open decisions (recommendation first)

1. **Who sees Reports?** **Admin only** (matches the existing menu; revenue is owner
   information) — or admin + advisor.
2. **Which date counts for revenue?** **The invoice date** (when the job was completed),
   with Paid and Unpaid shown next to it (matches the Invoices page) — or the date it was
   paid (cash-based; unpaid jobs vanish from the totals).
3. **Profit?** **No — revenue only.** Parts used keep the price charged but not the cost at
   the time, so a margin on past jobs would be a guess. Alternatives: an "estimated" margin
   using today's cost; or start saving the cost on each part used (migration; only new jobs).
4. **Charts:** **simple bars built into the page** (no new library, server-rendered, prints
   cleanly) — or add Recharts for interactive charts.
5. **CSV downloads:** **invoices, work orders, parts used** — or also customers and
   appointments.
6. **Date ranges:** **quick buttons + custom, at most 12 months**; the chart groups by day up
   to 31 days, by week up to about 3 months, by month beyond.
