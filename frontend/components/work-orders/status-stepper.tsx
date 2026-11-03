import { Check, Pause } from "lucide-react";
import { WORK_ORDER_STATUS_LABEL, WORK_ORDER_STEPS, type WorkOrderStatus } from "@motormate/types";

/**
 * Checked in → Diagnosing → In progress → Quality check → Completed, current step
 * highlighted. "Awaiting parts" is a pause on In progress, not a step of its own; a
 * cancelled job shows the path greyed out with a Cancelled badge.
 */
export function StatusStepper({ status }: { status: WorkOrderStatus }) {
  const cancelled = status === "CANCELLED";
  const paused = status === "AWAITING_PARTS";
  const current = WORK_ORDER_STEPS.indexOf(paused ? "IN_PROGRESS" : status);
  const completed = status === "COMPLETED";

  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${cancelled ? "opacity-60" : ""}`}>
      {cancelled && (
        <p className="mb-3 inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">Cancelled</p>
      )}
      <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0" aria-label="Job progress">
        {WORK_ORDER_STEPS.map((step, index) => {
          const done = !cancelled && (completed || index < current);
          const isCurrent = !cancelled && !completed && index === current;
          return (
            <li key={step} className="flex items-center sm:flex-1" aria-current={isCurrent ? "step" : undefined}>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  done
                    ? "bg-green-600 text-white"
                    : isCurrent
                      ? paused
                        ? "bg-amber-500 text-white"
                        : "bg-blue-600 text-white"
                      : "border border-slate-300 bg-white text-slate-400"
                }`}
              >
                {done ? <Check className="h-4 w-4" aria-hidden /> : isCurrent && paused ? <Pause className="h-3.5 w-3.5" aria-hidden /> : index + 1}
              </span>
              <span className={`ml-2 text-sm ${isCurrent ? "font-semibold text-slate-900" : done ? "text-slate-700" : "text-slate-400"}`}>
                {WORK_ORDER_STATUS_LABEL[step]}
                {isCurrent && paused && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Waiting for parts</span>
                )}
                <span className="sr-only">{done ? " (done)" : isCurrent ? " (current)" : ""}</span>
              </span>
              {index < WORK_ORDER_STEPS.length - 1 && (
                <span aria-hidden className={`mx-3 hidden h-px flex-1 sm:block ${done ? "bg-green-600" : "bg-slate-200"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
