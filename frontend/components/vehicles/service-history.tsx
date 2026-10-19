import Link from "next/link";
import { formatWorkOrderNumber, type ServiceHistoryEntry, type WorkOrderStatus } from "@motormate/types";
import { Badge, EmptyState } from "@/components/ui";
import { formatDate, formatKm, formatTHB } from "@/lib/format";

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  CHECKED_IN: "Checked in",
  DIAGNOSING: "Diagnosing",
  AWAITING_PARTS: "Awaiting parts",
  IN_PROGRESS: "In progress",
  QUALITY_CHECK: "Quality check",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Vertical timeline of visits, newest first. */
export function ServiceHistory({ history, linkWorkOrders }: { history: ServiceHistoryEntry[]; linkWorkOrders: boolean }) {
  if (history.length === 0) {
    return <EmptyState title="No visits yet">Completed work orders will appear here.</EmptyState>;
  }
  return (
    <ol className="relative space-y-6 border-l border-slate-200 pl-6">
      {history.map((entry) => {
        const completed = entry.status === "COMPLETED";
        const number = formatWorkOrderNumber(entry.number);
        return (
          <li key={entry.workOrderId} className="relative">
            <span
              className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-white ${
                completed ? "bg-green-500" : "bg-amber-400"
              }`}
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium text-slate-900">{formatDate(entry.date)}</span>
              <span className="text-slate-400">·</span>
              {linkWorkOrders ? (
                <Link href={`/app/work-orders/${entry.workOrderId}`} className="font-medium text-blue-700 hover:underline">
                  {number}
                </Link>
              ) : (
                <span className="text-slate-600">{number}</span>
              )}
              <span className="text-slate-400">·</span>
              <span className="text-slate-600">{formatKm(entry.mileageIn)}</span>
              <Badge tone={completed ? "green" : "amber"}>{STATUS_LABEL[entry.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-700">{entry.complaint}</p>
            {entry.workPerformed && <p className="text-sm text-slate-600">Work: {entry.workPerformed}</p>}
            {entry.parts.length > 0 && (
              <p className="text-sm text-slate-600">
                Parts: {entry.parts.map((part) => `${part.name} ×${part.quantity}`).join(", ")}
              </p>
            )}
            <p className="text-xs text-slate-500">
              {entry.mechanicName && `Mechanic: ${entry.mechanicName}`}
              {entry.mechanicName && entry.total !== null && " · "}
              {entry.total !== null && `Total ${formatTHB(entry.total)}`}
            </p>
            {entry.recommendations.map((rec) => (
              <p key={rec.description} className="mt-1 text-sm text-blue-700">
                ↳ Recommended: {rec.description}
                {rec.dueMileage !== null && ` at ${formatKm(rec.dueMileage)}`}
                {rec.dueDate && ` by ${formatDate(rec.dueDate)}`}
              </p>
            ))}
          </li>
        );
      })}
    </ol>
  );
}
