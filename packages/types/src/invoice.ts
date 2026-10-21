import { z } from "zod";
import { ListQuerySchema } from "./common";
import type { WorkOrderLabourLine, WorkOrderPartLine } from "./work-order";

/** Same rate as work-order totals; kept under this name for the seed script. */
export const VAT_RATE = 0.07;

export const InvoiceStatusSchema = z.enum(["UNPAID", "PAID", "VOID"]);

export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid",
  VOID: "Void",
};

/** Display helper: 7 → "INV-0007". */
export function formatInvoiceNumber(number: number): string {
  return `INV-${String(number).padStart(4, "0")}`;
}

/** "INV-0007", "inv7", "7" → 7; anything else → null. */
export function parseInvoiceNumber(input: string): number | null {
  const match = input.trim().match(/^(?:inv-?)?0*(\d{1,9})$/i);
  return match ? Number(match[1]) : null;
}

/** ?status=UNPAID|PAID&q= — q matches invoice/job number, plate or customer name. */
export const InvoiceListQuerySchema = ListQuerySchema.extend({
  status: z.enum(["UNPAID", "PAID"]).optional(),
});

export type InvoiceListQuery = z.output<typeof InvoiceListQuerySchema>;

// ── Responses ─────────────────────────────────────────────────────────────────

export type InvoiceSummary = {
  id: string;
  number: number;
  status: InvoiceStatus;
  total: number;
  issuedAt: string;
  paidAt: string | null;
  workOrder: { id: string; number: number };
  customer: { id: string; name: string };
  vehicle: { id: string; plate: string; province: string; make: string; model: string; year: number };
};

/** Everything printed on the invoice. Amounts are THB; lines are frozen once completed. */
export type InvoiceDetail = InvoiceSummary & {
  customer: InvoiceSummary["customer"] & { phone: string; email: string | null };
  vehicle: InvoiceSummary["vehicle"] & { vin: string };
  mileageIn: number;
  workPerformed: string | null;
  labour: WorkOrderLabourLine[];
  parts: WorkOrderPartLine[];
  subtotal: number;
  vatRate: number;
  vat: number;
  /** Who marked it paid (from the audit log), if paid. */
  paidBy: string | null;
};
