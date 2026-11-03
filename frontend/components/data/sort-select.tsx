"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Phone-size stand-in for sortable headers: one dropdown writing ?sort=&dir= to the URL. */
export function SortSelect({ options }: { options: { sort: string; dir: "asc" | "desc"; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("sort") ? `${searchParams.get("sort")}:${searchParams.get("dir") ?? "asc"}` : "";

  function change(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    const [sort, dir] = value.split(":");
    if (sort) {
      params.set("sort", sort);
      params.set("dir", dir);
    } else {
      params.delete("sort");
      params.delete("dir");
    }
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <label className="flex items-center gap-2 text-sm text-slate-700 md:hidden">
      Sort by
      <select value={current} onChange={(event) => change(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
        <option value="">Default order</option>
        {options.map((option) => (
          <option key={`${option.sort}:${option.dir}`} value={`${option.sort}:${option.dir}`}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
