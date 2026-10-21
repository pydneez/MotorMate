import { INVOICE_STATUS_LABEL, type InvoiceStatus } from "@motormate/types";
import { Badge } from "@/components/ui";

const TONE: Record<InvoiceStatus, "slate" | "green" | "amber"> = {
  UNPAID: "amber",
  PAID: "green",
  VOID: "slate",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Badge>;
}
