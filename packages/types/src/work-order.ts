import { z } from "zod";
import { clearableText, ListQuerySchema, wholeNumber } from "./common";
import { CreateCustomerSchema } from "./customer";
import { money } from "./inventory";
import { CreateVehicleSchema } from "./vehicle";
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
  complaint: z.string().trim().min(1, "Describe the reason for the visit").max(1000),
  mechanicId: z
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
export const AddLabourSchema = z.object({
  description: z.string().trim().min(1, "Describe the work").max(200),
  laborCost: money("Labour cost"),
});

export type AddLabourInput = z.input<typeof AddLabourSchema>;

/** A catalogue part used on the job; stock is deducted immediately. */
export const AddPartSchema = z.object({
  inventoryItemId: z.string().min(1, "Choose a part"),
  quantity: wholeNumber("Quantity", (n) => n.positive("Quantity must be at least 1").max(1000, "Quantity is too large")),
});

export type AddPartInput = z.input<typeof AddPartSchema>;

/** ?status=open|completed|cancelled|<STATUS>&mechanic=me|<id>&vehicleId=&from=&to=&q= */
export const WorkOrderListQuerySchema = ListQuerySchema.extend({
  status: z
    .union([z.enum(["open", "closed"]), WorkOrderStatusSchema])
    .optional(),
  mechanic: z.string().trim().optional(),
  vehicleId: z.string().trim().optional(),
  /** yyyy-mm-dd, inclusive, on the check-in date. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd").optional(),
});

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

export type WorkOrderLabourLine = { id: string; description: string; laborCost: number };

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
  /** Running totals while open; the invoice amounts once completed. */
  totals: WorkOrderTotals;
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
