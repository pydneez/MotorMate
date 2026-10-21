import { WORK_ORDER_STATUS_LABEL, type WorkOrderStatus } from "@motormate/types";
import { Badge } from "@/components/ui";

const TONE: Record<WorkOrderStatus, "slate" | "blue" | "green" | "amber" | "red"> = {
  CHECKED_IN: "slate",
  DIAGNOSING: "blue",
  AWAITING_PARTS: "amber",
  IN_PROGRESS: "blue",
  QUALITY_CHECK: "amber",
  COMPLETED: "green",
  CANCELLED: "red",
};

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return <Badge tone={TONE[status]}>{WORK_ORDER_STATUS_LABEL[status]}</Badge>;
}
