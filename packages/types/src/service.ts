import { z } from "zod";

export const ServiceItemSchema = z.object({
  id: z.string(),
  workOrderId: z.string(),
  description: z.string().min(1),
  laborCost: z.number().nonnegative(),
});

export type ServiceItem = z.infer<typeof ServiceItemSchema>;

export const CreateServiceItemSchema = ServiceItemSchema.omit({ id: true });

export type CreateServiceItemInput = z.infer<typeof CreateServiceItemSchema>;

export const PartUsedSchema = z.object({
  id: z.string(),
  workOrderId: z.string(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCost: z.number().nonnegative(),
});

export type PartUsed = z.infer<typeof PartUsedSchema>;

export const CreatePartUsedSchema = PartUsedSchema.omit({ id: true });

export type CreatePartUsedInput = z.infer<typeof CreatePartUsedSchema>;
