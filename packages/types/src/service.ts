import { z } from "zod";
import { wholeNumber } from "./common";

export const ServiceItemSchema = z.object({
  id: z.string(),
  workOrderId: z.string(),
  description: z.string().min(1),
  laborCost: z.number().nonnegative(),
});

export type ServiceItem = z.infer<typeof ServiceItemSchema>;

export const CreateServiceItemSchema = ServiceItemSchema.omit({ id: true });

export type CreateServiceItemInput = z.infer<typeof CreateServiceItemSchema>;

/** A catalog part consumed on a work order; stock is deducted when it is logged. */
export const PartUsedSchema = z.object({
  id: z.string(),
  workOrderId: z.string(),
  inventoryItemId: z.string(),
  quantity: z.number().int().positive(),
  /** Price snapshot at the time of use. */
  unitPrice: z.number().nonnegative(),
});

export type PartUsed = z.infer<typeof PartUsedSchema>;

export const CreatePartUsedSchema = z.object({
  inventoryItemId: z.string().min(1),
  quantity: wholeNumber("Quantity", (n) => n.positive("Quantity must be at least 1")),
});

export type CreatePartUsedInput = z.input<typeof CreatePartUsedSchema>;
