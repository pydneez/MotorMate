import { addDays, bangkokParts } from "@motormate/types";

/** The first year in the dropdown; the list runs from this year back to it. */
export const FIRST_FILTER_YEAR = 2022;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export type MonthYear = { year?: number; month?: number };

/** Today's year and month in Bangkok. */
export function bangkokYearMonth(now: Date = new Date()): { year: number; month: number } {
  const [year, month] = bangkokParts(now).date.split("-").map(Number);
  return { year, month };
}

/** Years for the dropdown, newest first: this year (Bangkok) back to FIRST_FILTER_YEAR. */
export function filterYears(now: Date = new Date()): number[] {
  const { year } = bangkokYearMonth(now);
  return Array.from({ length: year - FIRST_FILTER_YEAR + 1 }, (_, index) => year - index);
}

/** The month before the given one (January → December of the year before). */
export function previousMonth({ year, month }: { year: number; month: number }): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** A whole year, or one month of it, as the API's inclusive yyyy-mm-dd from/to. */
export function monthYearRange({ year, month }: MonthYear): { from?: string; to?: string } {
  if (!year) return {};
  if (!month) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { from: first, to: addDays(next, -1) };
}

/** "2026-10-03" → { year: 2026, month: 10 }. */
export function yearMonthOf(day: string): { year: number; month: number } {
  const [year, month] = day.split("-").map(Number);
  return { year, month };
}

/** From the 1st of the start month to the last day of the end month (Reports' custom range). */
export function monthSpan(start: { year: number; month: number }, end: { year: number; month: number }): { from: string; to: string } {
  return { from: monthYearRange(start).from!, to: monthYearRange(end).to! };
}

/**
 * ?year=&month= from a list page's URL, as the API's from/to. Values that aren't on the
 * dropdowns are dropped (the list shows all dates) and `error` says why — never a 400.
 */
export function readMonthYear(
  searchParams: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): MonthYear & { from?: string; to?: string; error: string | null } {
  const rawYear = typeof searchParams.year === "string" ? searchParams.year : "";
  const rawMonth = typeof searchParams.month === "string" ? searchParams.month : "";
  if (!rawYear && !rawMonth) return { error: null };

  const year = /^\d{4}$/.test(rawYear) ? Number(rawYear) : NaN;
  const month = rawMonth ? (/^\d{1,2}$/.test(rawMonth) ? Number(rawMonth) : NaN) : undefined;
  const validYear = filterYears(now).includes(year);
  const validMonth = month === undefined || (month >= 1 && month <= 12);
  if (!validYear || !validMonth) {
    return { error: `${!validYear ? "Choose a year from the list" : "Choose a month from the list"} — showing all dates.` };
  }
  return { year, month, ...monthYearRange({ year, month }), error: null };
}
