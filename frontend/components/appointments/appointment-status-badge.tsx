import { APPOINTMENT_STATUS_LABEL, type AppointmentStatus } from "@motormate/types";
import { Badge } from "@/components/ui";

const TONE: Record<AppointmentStatus, "slate" | "blue" | "green" | "amber" | "red"> = {
  REQUESTED: "amber",
  CONFIRMED: "blue",
  CHECKED_IN: "blue",
  COMPLETED: "green",
  CANCELLED: "slate",
  NO_SHOW: "red",
};

/**
 * Customers see a request as "Waiting for confirmation" — or "Not confirmed" once its time
 * has passed without the shop answering.
 */
export function AppointmentStatusBadge({
  status,
  scheduledAt,
  forCustomer = false,
}: {
  status: AppointmentStatus;
  scheduledAt?: string;
  forCustomer?: boolean;
}) {
  if (forCustomer && status === "REQUESTED") {
    const passed = scheduledAt !== undefined && new Date(scheduledAt).getTime() < Date.now();
    return <Badge tone={passed ? "slate" : "amber"}>{passed ? "Not confirmed" : "Waiting for confirmation"}</Badge>;
  }
  return <Badge tone={TONE[status]}>{APPOINTMENT_STATUS_LABEL[status]}</Badge>;
}
