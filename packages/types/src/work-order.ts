import { z } from "zod";

/** Mirrors the shop-visit lifecycle: check-in -> diagnosis -> repair -> completed (then invoiced). */
export const WorkOrderStatusSchema = z.enum([
  "CHECKED_IN",
  "IN_DIAGNOSIS",
  "IN_REPAIR",
  "COMPLETED",
]);

export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const WorkOrderSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  mechanicId: z.string().nullable(),
  status: WorkOrderStatusSchema,
  complaint: z.string().min(1),
  notes: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type WorkOrder = z.infer<typeof WorkOrderSchema>;

export const CreateWorkOrderSchema = WorkOrderSchema.omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  mechanicId: z.string().nullable().optional(),
});

export type CreateWorkOrderInput = z.infer<typeof CreateWorkOrderSchema>;

export const UpdateWorkOrderStatusSchema = z.object({
  status: WorkOrderStatusSchema,
});

export type UpdateWorkOrderStatusInput = z.infer<typeof UpdateWorkOrderStatusSchema>;
