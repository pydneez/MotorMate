import Link from "next/link";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * A table header that sorts the list through ?sort=&dir= (the API does the sorting, so it
 * works across pages). A new column starts ascending; clicking it again flips the order.
 * Keeps the other filters and goes back to page 1.
 */
export function SortHeader({
  column,
  label,
  basePath,
  searchParams,
  align = "left",
}: {
  column: string;
  label: string;
  basePath: string;
  searchParams: SearchParams;
  align?: "left" | "right";
}) {
  const active = searchParams.sort === column;
  const dir = active && searchParams.dir === "desc" ? "desc" : "asc";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string" && value && !["page", "sort", "dir"].includes(key)) params.set(key, value);
  }
  params.set("sort", column);
  params.set("dir", active && dir === "asc" ? "desc" : "asc");

  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : ""}`} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={`${basePath}?${params.toString()}`}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${active ? "text-slate-900" : ""}`}
      >
        {label}
        <span aria-hidden className={active ? "" : "text-slate-300"}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
}
