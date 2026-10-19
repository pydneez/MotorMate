import type { ListQuery, Paginated } from "@motormate/types";

/** Prisma skip/take for a validated ListQuery. */
export function pageArgs({ page, pageSize }: Pick<ListQuery, "page" | "pageSize">) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(items: T[], total: number, { page, pageSize }: Pick<ListQuery, "page" | "pageSize">): Paginated<T> {
  return { items, total, page, pageSize };
}

/**
 * Splits a search box value into words, so "jordan lee" matches first AND last name.
 * A value made only of phone characters ("081 234 5678", "+66 81 234 5678") stays one
 * token, otherwise its digit groups would be searched separately.
 */
export function searchTokens(q: string | undefined): string[] {
  if (!q) return [];
  const trimmed = q.trim();
  if (/^[\d\s()+-]+$/.test(trimmed) && /\d{2,}/.test(trimmed)) return [trimmed];
  return trimmed.split(/\s+/).filter(Boolean);
}
