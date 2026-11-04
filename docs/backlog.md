# MotorMate — ideas backlog

Ideas the team wants **after** the current priority list (CLAUDE.md "Current priority order").
Each entry says what it is, how it would be built, and roughly how big it is, so it can be
picked up as a numbered build step (plan → go-ahead → build, per CLAUDE.md). Nothing here
is scheduled until the team decides. Sizes: **S** ≈ half a day, **M** ≈ 1–2 days, **L** ≈ 3+ days.

Code freeze is Nov 10, 2026. Items that have been built are removed from this file; their
design and decisions are in CLAUDE.md and the step plans in `docs/`.

---

## Fixed prices for routine services (price list) — **L**

Jira: CLOUDAPPG3-136 (catalogue + admin API), CLOUDAPPG3-137 (admin page), CLOUDAPPG3-138
(labour lines from the list), CLOUDAPPG3-139 (pick services when booking), CLOUDAPPG3-140
(booked services + check-in prefill).

Extends the parked **Labour price list** in CLAUDE.md, adding the customer side.

**Data (migration):**
- `ServiceCatalogItem`: name ("Engine oil change"), category, `type: FIXED | HOURLY`,
  price (THB excl. VAT) or standard hours, `isActive`, `bookable` (shown to customers).
- Shop setting: hourly rate (for HOURLY items, later).
- `AppointmentService`: appointment ↔ catalogue item, with name + price **snapshot**.
- `ServiceItem` (labour line) gets an optional `catalogItemId` + the snapshot it was priced at.

**Admin:** add/edit/deactivate items (never delete; audited).

**Customer booking:** "What do you need?" — tick one or more bookable services (shows
"from ฿X") **plus** the free-text note for anything else; at least one of the two. The
booking shows an estimated total (excl. VAT). The appointment keeps the snapshot.

**Check-in from an appointment:** labour lines are pre-filled from the booked services
(snapshot prices); staff can remove or add.

**Work order — adding labour:**
- Pick from the list → price filled in. Mechanics can only pick from the list.
- Advisors/admins can also add a **custom line** or **override** a price, with a required
  reason (audited) — the current free-typed lines become this.
- Existing free-typed lines stay as they are.

**Also:** Reports can then show revenue per service (replacing today's "most common labour
lines", which groups free-typed lines by wording). Hourly items (estimate + customer
approval) are a second phase.

**Open questions for the team:** which services and prices go in the first list; can
mechanics add custom lines at all; do customers see prices before booking (recommended:
yes, "from ฿X, final price after inspection").

## Not planned

- **Customer "My visits" page** (CLOUDAPPG3-135): customers already see their history in My
  Invoices and on each vehicle's page; staff have the Visits list per customer.
