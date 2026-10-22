import { z } from "zod";
import { blankAsNull, blankAsUndefined, clearableEmail, clearableText, LineIdSchema, personName } from "./common";
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
  firstName: personName("First name"),
  lastName: personName("Last name"),
  phone: ThaiPhoneSchema,
  email: optionalEmail,
  lineId: blankAsUndefined(LineIdSchema),
  notes: optionalText,
});

export type CreateCustomerInput = z.input<typeof CreateCustomerSchema>;

/** In edit forms an emptied field means "clear it" (null), unlike create where it's just absent. */
export const UpdateCustomerSchema = z.object({
  firstName: personName("First name").optional(),
  lastName: personName("Last name").optional(),
  phone: ThaiPhoneSchema.optional(),
  email: clearableEmail(),
  lineId: blankAsNull(LineIdSchema),
  notes: clearableText(),
});

export type UpdateCustomerInput = z.input<typeof UpdateCustomerSchema>;

/**
 * PATCH /customers/me — what a customer may change about themselves. Email is excluded on
 * purpose: it is half of the self-registration matching rule (see CLAUDE.md).
 */
export const UpdateOwnCustomerSchema = z
  .object({
    phone: ThaiPhoneSchema.optional(),
    lineId: blankAsNull(LineIdSchema),
  })
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

/**
 * POST /customers/:id/merge — moves everything from `sourceId` into the customer in the URL
 * (the one kept), then removes `sourceId`. Only records with the same phone, at most one of
 * which has a portal login; the login holder must be the one kept. See CLAUDE.md.
 */
export const MergeCustomerSchema = z.object({
  sourceId: z.string().min(1, "Choose the customer to merge"),
});

export type MergeCustomerInput = z.input<typeof MergeCustomerSchema>;
