import Link from "next/link";
import type { Paginated } from "@motormate/types";

/** "Showing 1–20 of 53  ‹ Prev  Next ›" — keeps every other query parameter. */
export function Pagination({
  data,
  basePath,
  searchParams,
}: {
  data: Paginated<unknown>;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { page, pageSize, total } = data;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function hrefFor(target: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && value && key !== "page") params.set(key, value);
    }
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  const linkClass = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50";
  const disabledClass = "rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-300";

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <span>{total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={linkClass}>
            ‹ Prev
          </Link>
        ) : (
          <span className={disabledClass}>‹ Prev</span>
        )}
        {page < lastPage ? (
          <Link href={hrefFor(page + 1)} className={linkClass}>
            Next ›
          </Link>
        ) : (
          <span className={disabledClass}>Next ›</span>
        )}
      </div>
    </div>
  );
}
