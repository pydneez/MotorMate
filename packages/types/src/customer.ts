import { z } from "zod";
import { ThaiPhoneSchema } from "./thai";
import type { VehicleSummary } from "./vehicle";

export const CustomerSchema = z.object({
  id: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  /** E.164 — display with formatThaiPhone. */
  phone: z.string(),
  email: z.string().email().nullable(),
  lineId: z.string().nullable(),
  notes: z.string().nullable(),
  userId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Customer = z.infer<typeof CustomerSchema>;

/** Row in the customers list. */
export type CustomerSummary = Customer & {
  vehicleCount: number;
  /** Has a portal login. */
  hasPortalAccount: boolean;
};

export type CustomerDetail = CustomerSummary & {
  vehicles: VehicleSummary[];
};

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

/** Empty string from a form field means "no email". */
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const CreateCustomerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: ThaiPhoneSchema,
  email: optionalEmail,
  lineId: optionalText,
  notes: optionalText,
});

export type CreateCustomerInput = z.input<typeof CreateCustomerSchema>;

/** In edit forms an emptied field means "clear it" (null), unlike create where it's just absent. */
const clearableText = z
  .string()
  .trim()
  .transform((value) => value || null)
  .optional();

const clearableEmail = z
  .union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email")])
  .transform((value) => value || null)
  .optional();

export const UpdateCustomerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").optional(),
  lastName: z.string().trim().min(1, "Last name is required").optional(),
  phone: ThaiPhoneSchema.optional(),
  email: clearableEmail,
  lineId: clearableText,
  notes: clearableText,
});

export type UpdateCustomerInput = z.input<typeof UpdateCustomerSchema>;

/**
 * PATCH /customers/me — what a customer may change about themselves. Email is excluded on
 * purpose: it is half of the self-registration matching rule (see CLAUDE.md).
 */
export const UpdateOwnCustomerSchema = z
  .object({
    phone: ThaiPhoneSchema,
    lineId: z
      .string()
      .trim()
      .max(50)
      .transform((value) => value || null),
  })
  .partial()
  .strict();

export type UpdateOwnCustomerInput = z.input<typeof UpdateOwnCustomerSchema>;

export const CustomerDuplicateQuerySchema = z
  .object({
    phone: z.string().trim().optional(),
    email: z.string().trim().toLowerCase().optional(),
    /** The record being edited, so it doesn't match itself. */
    excludeId: z.string().optional(),
  })
  .refine((query) => query.phone || query.email, { message: "Provide a phone or an email" });

export type CustomerDuplicateQuery = z.output<typeof CustomerDuplicateQuerySchema>;

export type CustomerDuplicates = {
  /** Possible duplicates — a warning, saving is still allowed. */
  byPhone: CustomerSummary[];
  /** Email is unique, so a match here blocks saving. */
  byEmail: CustomerSummary | null;
};
