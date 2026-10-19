"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ROLE_LABELS } from "@/lib/nav";

/** Role dropdown + "Show deactivated" toggle, written to the URL like the search box. */
export function StaffFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        Role
        <select
          value={searchParams.get("role") ?? ""}
          onChange={(event) => update("role", event.target.value || null)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All</option>
          {(["ADMIN", "ADVISOR", "MECHANIC"] as const).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={searchParams.get("includeInactive") === "true"}
          onChange={(event) => update("includeInactive", event.target.checked ? "true" : null)}
        />
        Show deactivated
      </label>
    </div>
  );
}
