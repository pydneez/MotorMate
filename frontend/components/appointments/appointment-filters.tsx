"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUSES, type AppointmentBookedBy, type AppointmentStatus } from "@motormate/types";
import { MonthYearFilter } from "@/components/data/month-year-filter";
import type { MonthYear } from "@/lib/date-range";

/** URL keys the All tab's filters use (the tabs clear them when leaving All). */
export const APPOINTMENT_FILTER_PARAMS = ["status", "bookedBy", "year", "month"] as const;

/**
 * The All tab's filter bar: a tick box per status (all ticked = no filter, at least one stays
 * ticked), who booked it, and the scheduled month/year. Everything lives in the URL.
 */
export function AppointmentFilters({
  statuses,
  bookedBy,
  period,
}: {
  statuses: AppointmentStatus[] | undefined;
  bookedBy: AppointmentBookedBy | undefined;
  period: MonthYear;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = statuses ?? [...APPOINTMENT_STATUSES];

  function update(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  function toggle(status: AppointmentStatus, on: boolean) {
    const next = APPOINTMENT_STATUSES.filter((item) => (item === status ? on : selected.includes(item)));
    if (next.length === 0) return;
    update("status", next.length === APPOINTMENT_STATUSES.length ? null : next.join(","));
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="sr-only">Status</legend>
        <span className="text-sm font-medium text-slate-700" aria-hidden>
          Status
        </span>
        {APPOINTMENT_STATUSES.map((status) => (
          <label key={status} className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={selected.includes(status)}
              disabled={selected.length === 1 && selected.includes(status)}
              onChange={(event) => toggle(status, event.target.checked)}
            />
            {APPOINTMENT_STATUS_LABEL[status]}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <span className="font-medium">Booked by</span>
          <select
            value={bookedBy ?? ""}
            onChange={(event) => update("bookedBy", event.target.value || null)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">Anyone</option>
            <option value="customer">Customer online</option>
            <option value="staff">Staff (phone)</option>
          </select>
        </label>
        <MonthYearFilter label="Scheduled" value={period} />
      </div>
    </div>
  );
}
