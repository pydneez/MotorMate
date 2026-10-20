"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Category dropdown, "Low stock only" and "Show deactivated", written to the URL. */
export function InventoryFilters({ categories }: { categories: string[] }) {
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
        Category
        <select
          value={searchParams.get("category") ?? ""}
          onChange={(event) => update("category", event.target.value || null)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={searchParams.get("lowStock") === "true"}
          onChange={(event) => update("lowStock", event.target.checked ? "true" : null)}
        />
        Low stock only
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
