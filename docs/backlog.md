# MotorMate — ideas backlog

Ideas the team wants **after** the current priority list (CLAUDE.md "Current priority order").
Each entry says what it is, how it would be built, and roughly how big it is, so it can be
picked up as a numbered build step (plan → go-ahead → build, per CLAUDE.md). Nothing here
is scheduled until the team decides. Sizes: **S** ≈ half a day, **M** ≈ 1–2 days, **L** ≈ 3+ days.

Feature-complete target is Nov 1, 2026; code freeze Nov 10.

---

## 1. Work-order status: clearer order, clearer buttons — **S**

Jira: CLOUDAPPG3-129.

**Problem.** The rules are right, but the page doesn't show the order, and the buttons all
read "→ Status", so it's hard to tell the normal next step from a detour.

**The order (unchanged):**

```
Normal path:   Checked in → Diagnosing → In progress → Quality check → Completed (invoice)
Detour:                      Diagnosing ─┐            ┌─ In progress
                                         └→ Awaiting parts ─→ In progress   (parts arrived)
               In progress ──→ Awaiting parts ──→ In progress
QC failed:     Quality check ──→ In progress   (fix, then back to Quality check)
Any open step  ──→ Cancelled   (advisor/admin; parts go back to stock)
```

- *Checked in*: car is at the shop. *Diagnosing*: mechanic is finding the problem.
  *Awaiting parts*: work is blocked on a part. *In progress*: repair work.
  *Quality check*: advisor/admin checks the job. *Completed*: QC passed, invoice issued.

**Build:**
- A **progress stepper** at the top of the work order (5 steps of the normal path, current
  one highlighted; "Awaiting parts" shown as a pause badge on the current step, not a step).
- **Action-named buttons** instead of "→ Status", with the normal next step first and
  emphasised: Start diagnosis · Start repair · Waiting for parts · Parts arrived — resume ·
  Send to quality check · Pass QC & invoice · Fail QC — back to repair · Cancel job.
- One-line hint under the buttons for the current step ("Next: send to quality check when
  the repair is done").
- Only frontend + labels in `packages/types` (a `STATUS_ACTION_LABEL` map next to
  `allowedNextStatuses()`); no API or rule changes.

## 2. Button colours by meaning — **S** (do together with 1)

Jira: CLOUDAPPG3-130.

**Build:** add a `success` (green) variant to `Button`/`LinkButton` in
`frontend/components/ui.tsx`, and one shared map from action → colour so every page agrees:

| Colour | Meaning | Examples |
|---|---|---|
| Green | moves things forward / done | Confirm appointment, Check in, Pass QC & invoice, Mark as paid, Reminder **Done** |
| Blue | normal next step | Start diagnosis, Start repair, Send to QC, Book |
| Amber / outline | going back or pausing | Waiting for parts, Fail QC — back to repair, Reschedule |
| Red | stops or removes | Cancel appointment, Cancel job, No-show, Deactivate, **Dismiss** |
| Grey outline | secondary | Edit, Back, Close |

Keep text on every button (colour is never the only signal — accessibility).

## 3. Appointment filters — **S/M**

Jira: CLOUDAPPG3-131 (backend), CLOUDAPPG3-132 (frontend).

**Today:** tabs Requests / Today / Upcoming / Past + text search.

**Build:**
- Staff list gets a filter bar like the work-order filters: **status** (multi-select:
  Requested, Confirmed, Checked in, Completed, No-show, Cancelled), **date range**
  (from/to, Bangkok days), **booked by** (customer online / staff phone), kept in the URL.
- Tabs stay as quick presets that set these filters.
- API: extend the appointments list query (`packages/types/src/appointment.ts`) with
  `status[]`, `from`, `to`, `source`; `AppointmentsService.list()` adds them to `where`.
  Customers keep only their own (no change to scoping).
- Tests: query schema (bad dates, from > to), service `where`, one integration test.

## 4. Visit history on the customer page — and for the customer — **M**

Jira: CLOUDAPPG3-133 (backend), CLOUDAPPG3-134 (customer page), CLOUDAPPG3-135 (My visits).

**Today:** each **vehicle** page shows its service history (customers see it on their own
vehicles, without work-order links). The customer page only lists vehicles.

**Build:**
- **Staff — customer page:** a "Visits" section: every work order across the customer's
  vehicles, newest first — date, WO number, vehicle, complaint, status, invoice total and
  paid/unpaid (links to the work order and invoice) — plus their appointments (with
  outcome: completed / no-show / cancelled). Paged.
- **Customer — "My visits"** (`/app/visits`, nav item for customers): the same list for
  themselves, read-only, with invoice links; no internal notes or mechanic names.
- API: `GET /customers/:id/visits` (admin/advisor) and `GET /me/visits` (customer, scoped —
  never another customer's, 404 rule), both `Paginated<VisitSummary>` built from the
  existing vehicle-history mapper.
- Overlaps the "customer portal views" stretch item — build them as one step.

## 5. Fixed prices for routine services (price list) — **L**

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

**Admin:** `/app/services` — add/edit/deactivate items (never delete; audited).

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

**Also:** Reports can then show revenue per service. Hourly items (estimate + customer
approval) are a second phase.

**Open questions for the team:** which services and prices go in the first list; can
mechanics add custom lines at all; do customers see prices before booking (recommended:
yes, "from ฿X, final price after inspection").

---

### Suggested order (after Step 6 reports)

1. **1 + 2** together — small, makes the demo clearer, no schema change.
2. **3** — small, staff-only.
3. **4** — together with "customer portal views" (the last stretch item).
4. **5** — the largest (schema, booking, check-in, work order, admin page); only if there's
   time before Nov 1, otherwise it's a strong "future work" item for the final document.
