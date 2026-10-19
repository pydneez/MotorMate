import { z } from "zod";
import { wholeNumber } from "./common";

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

export const WorkOrderSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  vehicleId: z.string(),
  mileageIn: z.number().int(),
  complaint: z.string(),
  diagnosis: z.string().nullable(),
  workPerformed: z.string().nullable(),
  notes: z.string().nullable(),
  status: WorkOrderStatusSchema,
  mechanicId: z.string().nullable(),
  createdById: z.string(),
  completedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type WorkOrder = z.infer<typeof WorkOrderSchema>;

/** Display helper: 7 → "WO-0007". */
export function formatWorkOrderNumber(number: number): string {
  return `WO-${String(number).padStart(4, "0")}`;
}

export const CreateWorkOrderSchema = z.object({
  vehicleId: z.string().min(1),
  mileageIn: wholeNumber("Mileage", (n) => n.nonnegative("Mileage can't be negative")),
  complaint: z.string().trim().min(1, "Describe the reason for the visit"),
  mechanicId: z.string().nullable().optional(),
  appointmentId: z.string().optional(),
});

export type CreateWorkOrderInput = z.input<typeof CreateWorkOrderSchema>;

export const UpdateWorkOrderStatusSchema = z.object({
  status: WorkOrderStatusSchema,
  note: z.string().trim().optional(),
});

export type UpdateWorkOrderStatusInput = z.infer<typeof UpdateWorkOrderStatusSchema>;
