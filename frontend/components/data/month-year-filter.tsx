"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { bangkokYearMonth, filterYears, MONTH_NAMES, previousMonth, type MonthYear } from "@/lib/date-range";

/**
 * "Issued  Year [2026 ▾]  Month [October ▾]  [This month] [Last month]" for a list page.
 * Writes ?year=&month= to the URL (the page turns them into the API's from/to), keeps the
 * other filters, and goes back to page 1. Month needs a year; "Whole year" is no month.
 */
export function MonthYearFilter({ label, value }: { label: string; value: MonthYear }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const thisMonth = bangkokYearMonth();
  const lastMonth = previousMonth(thisMonth);

  function apply({ year, month }: MonthYear) {
    const params = new URLSearchParams(searchParams.toString());
    if (year) params.set("year", String(year));
    else params.delete("year");
    if (year && month) params.set("month", String(month));
    else params.delete("month");
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const isMonth = (target: { year: number; month: number }) => value.year === target.year && value.month === target.month;
  const shortcutClass = (active: boolean) =>
    `rounded px-3 py-1.5 text-sm font-medium ${active ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`;
  const selectClass = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        Year
        <select
          value={value.year ?? ""}
          onChange={(event) => apply({ year: Number(event.target.value) || undefined, month: value.month })}
          className={selectClass}
        >
          <option value="">All years</option>
          {filterYears().map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        Month
        <select
          value={value.month ?? ""}
          disabled={!value.year}
          onChange={(event) => apply({ year: value.year, month: Number(event.target.value) || undefined })}
          className={selectClass}
        >
          <option value="">Whole year</option>
          {MONTH_NAMES.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
        <button type="button" onClick={() => apply(thisMonth)} aria-pressed={isMonth(thisMonth)} className={shortcutClass(isMonth(thisMonth))}>
          This month
        </button>
        <button type="button" onClick={() => apply(lastMonth)} aria-pressed={isMonth(lastMonth)} className={shortcutClass(isMonth(lastMonth))}>
          Last month
        </button>
      </div>
    </div>
  );
}
