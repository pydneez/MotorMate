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
 * Turns a form field or JSON value into a number for z.number(): blank → undefined
 * ("required"), plain decimal text → its number, anything else → NaN ("must be a number").
 * Number() alone would accept "1e5" and "0x1F" and turn "  " into 0.
 */
export function numberInput(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const text = value.trim();
  if (text === "") return undefined;
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

/**
 * A whole number from a form field or JSON. Unlike z.coerce.number(), an empty field is
 * "required" instead of silently becoming 0, and letters are rejected.
 */
export function wholeNumber(label: string, constrain: (n: z.ZodNumber) => z.ZodNumber = (n) => n) {
  return z.preprocess(
    numberInput,
    constrain(
      z
        .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
        .int(`${label} must be a whole number`),
    ),
  );
}

/**
 * An optional text field on an EDIT form: an emptied field means "clear it" (null).
 *
 * Accepts null as well as text because forms validate in the browser and then send the
 * parsed result, so the API sees null for a cleared field. Every schema must accept its own
 * output — the round-trip test in backend/src/common/pipes/validation.spec.ts enforces this.
 */
export function clearableText(maxLength?: number) {
  const text = maxLength ? z.string().trim().max(maxLength) : z.string().trim();
  return text
    .nullable()
    .transform((value) => value || null)
    .optional();
}

/** Like clearableText, for an email: "" or null clears it, anything else must be valid. */
export function clearableEmail() {
  return z
    .union([z.literal(""), z.null(), z.string().trim().toLowerCase().email("Enter a valid email")])
    .transform((value) => value || null)
    .optional();
}

/** Optional query-string boolean: "true"/"false" → boolean, missing → undefined. */
export const QueryBooleanSchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));

// ── Text fields ───────────────────────────────────────────────────────────────

/** Letters in any script; Thai vowels and tone marks are combining marks (\p{M}). */
const LETTER = /\p{L}/u;

/** Person names: letters, spaces, hyphens, apostrophes and dots — no digits. */
export const NAME_CHARS = /^[\p{L}\p{M}\s.'-]+$/u;

export type TextRule = {
  max: number;
  /** Shorter than this (after trimming) gets the `required` message; default 1. */
  min?: number;
  /** Message for an empty or too-short field; default "<label> is required". */
  required?: string;
  /** What the text must contain somewhere; default a letter. */
  contains?: { pattern: RegExp; message: string };
  /** The whole value must match, e.g. NAME_CHARS. */
  allowed?: RegExp;
  /** Shown when `allowed` fails: "Color can only contain <allowedHint>". */
  allowedHint?: string;
};

/**
 * Required text that must contain at least one letter, so "13000" or "!!!" can't be a
 * colour, name or description. Checks stop at the first failure, so a field gets one
 * clear message (zod's chained checks would report every one that fails).
 */
export function textWithLetters(label: string, rule: TextRule) {
  const min = rule.min ?? 1;
  const contains = rule.contains ?? { pattern: LETTER, message: `${label} must contain letters, not only numbers or symbols` };
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      if (value.length < min) return fail(rule.required ?? `${label} is required`);
      if (!contains.pattern.test(value)) return fail(contains.message);
      if (value.length > rule.max) return fail(`${label} is too long (at most ${rule.max} characters)`);
      if (rule.allowed && !rule.allowed.test(value)) fail(`${label} can only contain ${rule.allowedHint}`);
    });
}

/** A first or last name. */
export function personName(label: string) {
  return textWithLetters(label, { max: 60, allowed: NAME_CHARS, allowedHint: "letters, spaces, - ' and ." });
}

/** An optional text field on a CREATE form: blank means "not given" (undefined). */
export function blankAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .pipe(schema.optional());
}

/** Like clearableText, but the value must pass `schema`: blank or null clears it (null). */
export function blankAsNull<T extends z.ZodTypeAny>(schema: T) {
  return z
    .string()
    .nullable()
    .transform((value) => value?.trim() || null)
    .pipe(schema.nullable())
    .optional();
}

/** LINE's own rule: 4–20 of a–z, 0–9, ".", "-", "_". All digits is fine — many people use their phone number. */
export const LineIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{4,20}$/, "LINE ID: 4–20 letters, digits, . - or _");
