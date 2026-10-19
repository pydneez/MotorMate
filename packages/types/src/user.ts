import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "./auth";
import { ListQuerySchema, QueryBooleanSchema } from "./common";
import { RoleSchema } from "./role";

/** Roles an admin can give through staff management; customers self-register. */
export const StaffRoleSchema = RoleSchema.exclude(["CUSTOMER"]);

export type StaffRole = z.infer<typeof StaffRoleSchema>;

export const StaffUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: StaffRoleSchema,
  isActive: z.boolean(),
  lastLoginAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export type StaffUser = z.infer<typeof StaffUserSchema>;

export const StaffListQuerySchema = ListQuerySchema.extend({
  role: StaffRoleSchema.optional(),
  /** Missing = active only; "true" = include deactivated. */
  includeInactive: QueryBooleanSchema,
});

export type StaffListQuery = z.output<typeof StaffListQuerySchema>;

const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);

export const CreateStaffSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: StaffRoleSchema,
  temporaryPassword: PasswordSchema,
});

export type CreateStaffInput = z.input<typeof CreateStaffSchema>;

export const UpdateStaffSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").optional(),
  lastName: z.string().trim().min(1, "Last name is required").optional(),
  role: StaffRoleSchema.optional(),
});

export type UpdateStaffInput = z.input<typeof UpdateStaffSchema>;

export const ResetPasswordSchema = z.object({
  temporaryPassword: PasswordSchema,
});

export type ResetPasswordInput = z.input<typeof ResetPasswordSchema>;

/** PATCH /auth/me/password — any signed-in user. */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: PasswordSchema,
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "New password must be different from the current one",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.input<typeof ChangePasswordSchema>;
