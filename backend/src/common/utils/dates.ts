import { addDays } from "@motormate/types";

/** Bangkok midnight at the start of a yyyy-mm-dd day. */
export function bangkokMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+07:00`);
}

/**
 * A Prisma DateTime filter for whole Bangkok days, both ends inclusive: from 00:00 on `from`
 * up to (not including) 00:00 the day after `to`. Undefined when neither is set.
 */
export function bangkokDayFilter(from?: string, to?: string): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: bangkokMidnight(from) } : {}),
    ...(to ? { lt: bangkokMidnight(addDays(to, 1)) } : {}),
  };
}
