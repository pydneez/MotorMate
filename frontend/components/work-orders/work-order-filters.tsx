"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MechanicOption } from "@motormate/types";

const TABS = [
  { value: "open", label: "Open" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

/**
 * Open / Completed / Cancelled tabs plus a mechanic filter (staff) or an "Assigned to me"
 * toggle (mechanics), written to the URL like the search box.
 */
export function WorkOrderFilters({ mechanics, isMechanic }: { mechanics: MechanicOption[]; isMechanic: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "open";

  function update(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => update({ status: tab.value === "open" ? null : tab.value })}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              status === tab.value ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {isMechanic ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={searchParams.get("mechanic") !== "all"}
            onChange={(event) => update({ mechanic: event.target.checked ? null : "all" })}
          />
          Assigned to me
        </label>
      ) : (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Mechanic
          <select
            value={searchParams.get("mechanic") ?? ""}
            onChange={(event) => update({ mechanic: event.target.value || null })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            <option value="none">Unassigned</option>
            {mechanics.map((mechanic) => (
              <option key={mechanic.id} value={mechanic.id}>
                {mechanic.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
