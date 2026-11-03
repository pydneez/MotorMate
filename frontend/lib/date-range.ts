import { DateRangeQuerySchema, type DateRangeQuery } from "@motormate/types";

/**
 * ?from=&to= from a list page's URL, checked with the API's own rules. Invalid dates are
 * dropped (the list shows all dates) and `error` says why, so the page never hits a 400.
 */
export function readDateRange(searchParams: Record<string, string | string[] | undefined>): DateRangeQuery & { error: string | null } {
  const from = typeof searchParams.from === "string" ? searchParams.from : undefined;
  const to = typeof searchParams.to === "string" ? searchParams.to : undefined;
  const parsed = DateRangeQuerySchema.safeParse({ from, to });
  if (parsed.success) return { ...parsed.data, error: null };
  return { error: `${parsed.error.issues[0].message} — showing all dates.` };
}
