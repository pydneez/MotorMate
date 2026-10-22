import type { NotifyStatus, ReminderState } from "@motormate/types";
import { Badge } from "@/components/ui";
import { formatDate, formatKm } from "@/lib/format";

const STATE: Record<ReminderState, { label: string; tone: "red" | "amber" | "slate" }> = {
  overdue: { label: "Overdue", tone: "red" },
  due: { label: "Due soon", tone: "amber" },
  upcoming: { label: "Coming up", tone: "slate" },
};

export function ReminderStateBadge({ state }: { state: ReminderState }) {
  return <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>;
}

const NOTIFY: Record<NotifyStatus, { label: string; tone: "green" | "amber" | "slate" | "blue"; title: string }> = {
  confirmed: { label: "Email on", tone: "green", title: "The customer confirmed AWS's subscription email" },
  pending: { label: "Email not confirmed", tone: "amber", title: "Waiting for the customer to click the link in AWS's subscription email" },
  none: { label: "No email", tone: "slate", title: "No email address — call the customer" },
  local: { label: "Email (local log)", tone: "blue", title: "Running locally: emails are written to the backend log" },
};

/** Whether this customer can get emails (on AWS they confirm an SNS subscription once). */
export function NotifyBadge({ status }: { status: NotifyStatus }) {
  return (
    <span title={NOTIFY[status].title}>
      <Badge tone={NOTIFY[status].tone}>{NOTIFY[status].label}</Badge>
    </span>
  );
}

/** "at 50,000 km or by 28 Oct 2026" */
export function dueText(item: { dueMileage: number | null; dueDate: string | null }): string {
  return [item.dueMileage !== null ? `at ${formatKm(item.dueMileage)}` : null, item.dueDate ? `by ${formatDate(item.dueDate)}` : null]
    .filter(Boolean)
    .join(" or ");
}
