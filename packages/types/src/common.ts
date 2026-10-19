import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Query string shared by every list endpoint: ?q=&page=&pageSize= */
export const ListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type ListQuery = z.output<typeof ListQuerySchema>;

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * A whole number from a form field or JSON. Unlike z.coerce.number(), an empty field is
 * "required" instead of silently becoming 0.
 */
export function wholeNumber(label: string, constrain: (n: z.ZodNumber) => z.ZodNumber = (n) => n) {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
    constrain(
      z
        .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
        .int(`${label} must be a whole number`),
    ),
  );
}

/** Optional query-string boolean: "true"/"false" → boolean, missing → undefined. */
export const QueryBooleanSchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));
