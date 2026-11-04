import { z } from "zod";
import { checkDateRange, clearableText, dateRangeFields, ListQuerySchema, numberInput, textWithLetters, wholeNumber } from "./common";
import { CreateCustomerSchema } from "./customer";
import { money } from "./inventory";
import { CreateVehicleSchema } from "./vehicle";
import type { InvoiceStatus } from "./invoice";
import type { Role } from "./role";

/** Shop-visit lifecycle from the kickoff report, plus CANCELLED. */
export const WorkOrderStatusSchema = z.enum([
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_PARTS",
  "IN_PROGRESS",
  "QUALITY_CHECK",
  "COMPLETED",
  "CANCELLED",
]);

export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  CHECKED_IN: "Checked in",
  DIAGNOSING: "Diagnosing",
  AWAITING_PARTS: "Awaiting parts",
  IN_PROGRESS: "In progress",
  QUALITY_CHECK: "Quality check",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** A work order can't change any more once it's completed or cancelled. */
export function isClosedStatus(status: WorkOrderStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

/**
 * Allowed status moves (CLAUDE.md "Domain rules"). Quality check can send a job back to
 * In progress if it fails. Any open job can be cancelled.
 */
const NEXT_STATUSES: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  CHECKED_IN: ["DIAGNOSING", "CANCELLED"],
  DIAGNOSING: ["AWAITING_PARTS", "IN_PROGRESS", "CANCELLED"],
  AWAITING_PARTS: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["AWAITING_PARTS", "QUALITY_CHECK", "CANCELLED"],
  QUALITY_CHECK: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Moves only an advisor/admin may make: the QC sign-off and cancelling. */
const STAFF_ONLY_TARGETS: WorkOrderStatus[] = ["COMPLETED", "CANCELLED"];

/**
 * The status moves this user may make right now. Mechanics may only move jobs assigned to
 * them, and never to Completed or Cancelled. Shared so the API and the buttons agree.
 */
export function allowedNextStatuses(
  current: WorkOrderStatus,
  user: { role: Role; isAssignedMechanic: boolean },
): WorkOrderStatus[] {
  const next = NEXT_STATUSES[current];
  if (user.role === "ADMIN" || user.role === "ADVISOR") return next;
  if (user.role === "MECHANIC" && user.isAssignedMechanic) return next.filter((s) => !STAFF_ONLY_TARGETS.includes(s));
  return [];
}

// ── Status buttons and progress ───────────────────────────────────────────────

/** The five steps of the normal path, for the progress bar ("Awaiting parts" is a pause). */
export const WORK_ORDER_STEPS: WorkOrderStatus[] = ["CHECKED_IN", "DIAGNOSING", "IN_PROGRESS", "QUALITY_CHECK", "COMPLETED"];

/** The usual next step from each open status — shown first and emphasised. */
const NORMAL_NEXT: Partial<Record<WorkOrderStatus, WorkOrderStatus>> = {
  CHECKED_IN: "DIAGNOSING",
  DIAGNOSING: "IN_PROGRESS",
  AWAITING_PARTS: "IN_PROGRESS",
  IN_PROGRESS: "QUALITY_CHECK",
  QUALITY_CHECK: "COMPLETED",
};

/** What a button does, by meaning: next step, done/forward, going back or pausing, stopping. */
export type ActionTone = "primary" | "success" | "warning" | "danger";

export type StatusAction = { to: WorkOrderStatus; label: string; tone: ActionTone; normal: boolean };

/** Button text and colour for a move, phrased as the action (not "→ Status"). */
export function statusActionFor(from: WorkOrderStatus, to: WorkOrderStatus): Omit<StatusAction, "normal"> {
  if (to === "CANCELLED") return { to, label: "Cancel job", tone: "danger" };
  if (to === "COMPLETED") return { to, label: "Pass QC & invoice", tone: "success" };
  if (to === "AWAITING_PARTS") return { to, label: "Waiting for parts", tone: "warning" };
  if (to === "DIAGNOSING") return { to, label: "Start diagnosis", tone: "primary" };
  if (to === "QUALITY_CHECK") return { to, label: "Send to quality check", tone: "primary" };
  // To In progress: from diagnosis, back from parts, or back from a failed QC.
  if (from === "AWAITING_PARTS") return { to, label: "Parts arrived — resume", tone: "primary" };
  if (from === "QUALITY_CHECK") return { to, label: "Fail QC — back to repair", tone: "warning" };
  return { to, label: "Start repair", tone: "primary" };
}

/**
 * The buttons this user gets on a job, in order: the normal next step first, Cancel last.
 * Same moves as `allowedNextStatuses()` — this only names, colours and orders them.
 */
export function statusActions(current: WorkOrderStatus, user: { role: Role; isAssignedMechanic: boolean }): StatusAction[] {
  const rank = (to: WorkOrderStatus) => (to === NORMAL_NEXT[current] ? 0 : to === "CANCELLED" ? 2 : 1);
  return allowedNextStatuses(current, user)
    .map((to) => ({ ...statusActionFor(current, to), normal: to === NORMAL_NEXT[current] }))
    .sort((a, b) => rank(a.to) - rank(b.to));
}

/** One line under the buttons: what happens next. Mechanics can't do the QC sign-off. */
export function statusHint(status: WorkOrderStatus, role: Role): string | null {
  switch (status) {
    case "CHECKED_IN":
      return "Next: start the diagnosis when a mechanic looks at the car.";
    case "DIAGNOSING":
      return "Next: start the repair, or mark it as waiting for parts.";
    case "AWAITING_PARTS":
      return "Paused: resume the repair when the parts arrive.";
    case "IN_PROGRESS":
      return "Next: send to quality check when the repair is done.";
    case "QUALITY_CHECK":
      return role === "MECHANIC"
        ? "Waiting for an advisor's quality check."
        : "Next: check the work — pass to issue the invoice, or fail to send it back.";
    default:
      return null;
  }
}

/** Display helper: 7 → "WO-0007". */
export function formatWorkOrderNumber(number: number): string {
  return `WO-${String(number).padStart(4, "0")}`;
}

/** "WO-0007", "wo7", "7" → 7; anything else → null. */
export function parseWorkOrderNumber(input: string): number | null {
  const match = input.trim().match(/^(?:wo-?)?0*(\d{1,9})$/i);
  return match ? Number(match[1]) : null;
}

// ── Requests ──────────────────────────────────────────────────────────────────

/** Check-in: a car arrives. */
export const CreateWorkOrderSchema = z.object({
  vehicleId: z.string().min(1, "Choose a vehicle"),
  mileageIn: wholeNumber("Mileage", (n) => n.nonnegative("Mileage can't be negative")),
  complaint: textWithLetters("Complaint", { max: 1000, required: "Describe the reason for the visit" }),
  mechanicId: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  /** Checking in a booked appointment: it's linked to the new job in the same transaction. */
  appointmentId: z
    .string()
    .optional()
    .transform((value) => value || undefined),
});

export type CreateWorkOrderInput = z.input<typeof CreateWorkOrderSchema>;

const walkInCustomerFields = CreateCustomerSchema.partial().omit({ notes: true }).shape;
const walkInVehicleFields = CreateVehicleSchema.omit({ customerId: true, mileage: true }).shape;

/**
 * Walk-in check-in on one screen: an existing customer (`customerId`) or a new one (name +
 * phone required), a new vehicle, and the visit. Flat, so form field errors map 1:1 and the
 * parsed result can be sent and re-parsed by the API. The vehicle's mileage is `mileageIn`.
 */
const WALK_IN_CUSTOMER_KEYS = ["firstName", "lastName", "phone", "email", "lineId"] as const;

/** With an existing customer picked, the (hidden) new-customer fields are ignored. */
function dropNewCustomerFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || !(value as { customerId?: unknown }).customerId) return value;
  const rest: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of WALK_IN_CUSTOMER_KEYS) delete rest[key];
  return rest;
}

const WalkInCheckInObject = z
  .object({
    customerId: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    ...walkInCustomerFields,
    ...walkInVehicleFields,
    mileageIn: CreateWorkOrderSchema.shape.mileageIn,
    complaint: CreateWorkOrderSchema.shape.complaint,
    mechanicId: CreateWorkOrderSchema.shape.mechanicId,
  })
  .superRefine((data, ctx) => {
    if (data.customerId) return;
    const required: [keyof typeof data, string][] = [
      ["firstName", "First name is required"],
      ["lastName", "Last name is required"],
      ["phone", "Phone number is required"],
    ];
    for (const [field, message] of required) {
      if (!data[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [field] });
    }
  });

export const WalkInCheckInSchema = z.preprocess(dropNewCustomerFields, WalkInCheckInObject);

export type WalkInCheckInInput = z.input<typeof WalkInCheckInObject>;

/** Notes the assigned mechanic or staff keep up to date while the job is open. */
export const UpdateWorkOrderDetailsSchema = z
  .object({
    diagnosis: clearableText(2000),
    workPerformed: clearableText(2000),
    notes: clearableText(2000),
  })
  .strict();

export type UpdateWorkOrderDetailsInput = z.input<typeof UpdateWorkOrderDetailsSchema>;

/** Assign (or unassign with null) a mechanic. Staff only. */
export const AssignMechanicSchema = z.object({
  mechanicId: z
    .string()
    .nullable()
    .transform((value) => value || null),
});

export type AssignMechanicInput = z.input<typeof AssignMechanicSchema>;

export const ChangeWorkOrderStatusSchema = z.object({
  status: WorkOrderStatusSchema,
  note: clearableText(500),
});

export type ChangeWorkOrderStatusInput = z.input<typeof ChangeWorkOrderStatusSchema>;

/** A labour line on the job. */
/**
 * A labour line: from the price list (catalogItemId — name and price come from the list; staff
 * may change the price for this job), or a custom line (description + price, anyone who can
 * edit the job; a mechanic's custom lines are checked by the advisor at QC).
 */
export const AddLabourSchema = z
  .object({
    catalogItemId: z.string().trim().min(1).optional(),
    description: textWithLetters("Description", { max: 200, required: "Describe the work" }).optional(),
    laborCost: money("Labour cost").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.catalogItemId) return;
    if (!value.description) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["description"], message: "Describe the work" });
    if (value.laborCost === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["laborCost"], message: "Labour cost is required" });
  });

export type AddLabourInput = z.input<typeof AddLabourSchema>;

/** A catalogue part used on the job; stock is deducted immediately. */
export const AddPartSchema = z.object({
  inventoryItemId: z.string().min(1, "Choose a part"),
  quantity: wholeNumber("Quantity", (n) => n.positive("Quantity must be at least 1").max(1000, "Quantity is too large")),
});

export type AddPartInput = z.input<typeof AddPartSchema>;

/** A blank form field → undefined; anything else must be a positive whole number. */
const optionalPositiveNumber = (label: string) =>
  z.preprocess(
    numberInput,
    z
      .number({ invalid_type_error: `${label} must be a number` })
      .int(`${label} must be a whole number`)
      .positive(`${label} must be above 0`)
      .optional(),
  );

/**
 * Future service, e.g. "Brake fluid change at 60,000 km". At least one of due mileage /
 * due date; the reminder job reads these later.
 */
export const AddRecommendationSchema = z
  .object({
    description: textWithLetters("Description", { max: 200, required: "Describe the service" }),
    dueMileage: optionalPositiveNumber("Due mileage"),
    /** yyyy-mm-dd */
    dueDate: z
      .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd")])
      .optional()
      .transform((value) => value || undefined),
  })
  .refine((data) => data.dueMileage !== undefined || data.dueDate !== undefined, {
    message: "Give a due mileage, a due date, or both",
    path: ["dueMileage"],
  });

export type AddRecommendationInput = z.input<typeof AddRecommendationSchema>;

/** ?status=open|completed|cancelled|<STATUS>&mechanic=me|<id>&vehicleId=&from=&to=&q= */
export const WorkOrderListQuerySchema = ListQuerySchema.extend({
  status: z
    .union([z.enum(["open", "closed"]), WorkOrderStatusSchema])
    .optional(),
  mechanic: z.string().trim().optional(),
  vehicleId: z.string().trim().optional(),
  /** Bangkok days, inclusive, on the check-in date. */
  ...dateRangeFields,
}).superRefine(checkDateRange);

export type WorkOrderListQuery = z.output<typeof WorkOrderListQuerySchema>;

// ── Responses ─────────────────────────────────────────────────────────────────

export type WorkOrderSummary = {
  id: string;
  number: number;
  status: WorkOrderStatus;
  complaint: string;
  mileageIn: number;
  vehicle: { id: string; plate: string; province: string; make: string; model: string; year: number };
  customer: { id: string; name: string };
  mechanic: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type WorkOrderLabourLine = {
  id: string;
  description: string;
  laborCost: number;
  /** Set when the line came from the price list; null = a custom line. */
  catalogItemId: string | null;
  /** Who added it (null on lines from before this was recorded). */
  addedBy: { id: string; name: string; role: Role } | null;
};

export type WorkOrderPartLine = {
  id: string;
  inventoryItemId: string;
  sku: string;
  name: string;
  quantity: number;
  /** Price at the time the part was added, excluding VAT. */
  unitPrice: number;
  lineTotal: number;
};

export type WorkOrderStatusEntry = {
  fromStatus: WorkOrderStatus | null;
  toStatus: WorkOrderStatus;
  note: string | null;
  createdAt: string;
  changedBy: string;
};

export type WorkOrderTotals = {
  labour: number;
  parts: number;
  subtotal: number;
  vatRate: number;
  vat: number;
  total: number;
};

export type WorkOrderDetail = WorkOrderSummary & {
  diagnosis: string | null;
  workPerformed: string | null;
  notes: string | null;
  createdBy: string;
  labour: WorkOrderLabourLine[];
  parts: WorkOrderPartLine[];
  history: WorkOrderStatusEntry[];
  recommendations: WorkOrderRecommendation[];
  /** Running totals while open; the invoice amounts once completed. */
  totals: WorkOrderTotals;
  /** Set once the job is completed. */
  invoice: { id: string; number: number; status: InvoiceStatus } | null;
};

export type WorkOrderRecommendation = {
  id: string;
  description: string;
  dueMileage: number | null;
  /** yyyy-mm-dd */
  dueDate: string | null;
};

/** Counts for the dashboard cards. */
export type WorkOrderCounts = {
  open: number;
  awaitingParts: number;
  qualityCheck: number;
  /** Open jobs assigned to the signed-in mechanic (0 for other roles). */
  mine: number;
};

export type MechanicOption = { id: string; name: string; openJobs: number };

// ── Money ─────────────────────────────────────────────────────────────────────

export const WORK_ORDER_VAT_RATE = 0.07;

/**
 * Labour + parts → subtotal, VAT (rounded half-up to the satang) and total. Done in whole
 * satang so 0.1 + 0.2 style float errors can't reach an invoice.
 */
export function calculateTotals(
  labourCosts: number[],
  parts: { quantity: number; unitPrice: number }[],
  vatRate = WORK_ORDER_VAT_RATE,
): WorkOrderTotals {
  const satang = (baht: number) => Math.round(baht * 100);
  const labour = labourCosts.reduce((sum, cost) => sum + satang(cost), 0);
  const partsTotal = parts.reduce((sum, part) => sum + satang(part.unitPrice) * part.quantity, 0);
  const subtotal = labour + partsTotal;
  const vat = Math.round(subtotal * vatRate);
  return {
    labour: labour / 100,
    parts: partsTotal / 100,
    subtotal: subtotal / 100,
    vatRate,
    vat: vat / 100,
    total: (subtotal + vat) / 100,
  };
}
