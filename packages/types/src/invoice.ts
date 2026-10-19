import { z } from "zod";

export const VAT_RATE = 0.07;

export const InvoiceStatusSchema = z.enum(["UNPAID", "PAID", "VOID"]);

export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  workOrderId: z.string(),
  subtotal: z.number().nonnegative(),
  vatRate: z.number().nonnegative(),
  vatAmount: z.number().nonnegative(),
  total: z.number().nonnegative(),
  status: InvoiceStatusSchema,
  pdfKey: z.string().nullable(),
  issuedAt: z.coerce.date(),
  paidAt: z.coerce.date().nullable(),
});

export type Invoice = z.infer<typeof InvoiceSchema>;
