# MotorMate — ideas backlog

Ideas the team wants **after** the current priority list (CLAUDE.md "Current priority order").
Each entry says what it is, how it would be built, and roughly how big it is, so it can be
picked up as a numbered build step (plan → go-ahead → build, per CLAUDE.md). Nothing here
is scheduled until the team decides. Sizes: **S** ≈ half a day, **M** ≈ 1–2 days, **L** ≈ 3+ days.

Code freeze is Nov 10, 2026. Items that have been built are removed from this file; their
design and decisions are in CLAUDE.md and the step plans in `docs/`.

---

## Hourly labour with estimates — **L**

The second half of the price list (the fixed-price half is built — Step 12, CLAUDE.md
"Labour lines").

- Price-list entries get `type: FIXED | HOURLY` (price, or standard hours); a shop hourly
  rate in Settings.
- Unpredictable repairs (diagnostics, electrical faults, leaks, suspension) entered as an
  **estimate** (hours × rate) the customer approves before work starts; actual hours
  recorded; re-approval if it runs over. Often with a fixed diagnostic fee.
- Would replace most custom lines; the QC review of mechanics' custom lines stays for the
  rest.

## Not planned

- **Customer "My visits" page** (CLOUDAPPG3-135): customers already see their history in My
  Invoices and on each vehicle's page; staff have the Visits list per customer.
