import { z } from "zod";

export const InvoiceSchema = z.object({
  id: z.string(),
  workOrderId: z.string(),
  subtotal: z.number().nonnegative(),
  total: z.number().nonnegative(),
  generatedAt: z.coerce.date(),
});

export type Invoice = z.infer<typeof InvoiceSchema>;
