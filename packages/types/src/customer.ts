import { z } from "zod";
import { ThaiPhoneSchema } from "./thai";

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

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

export const CreateCustomerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: ThaiPhoneSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  lineId: optionalText,
  notes: optionalText,
});

export type CreateCustomerInput = z.input<typeof CreateCustomerSchema>;

export const UpdateCustomerSchema = CreateCustomerSchema.partial();

export type UpdateCustomerInput = z.input<typeof UpdateCustomerSchema>;
