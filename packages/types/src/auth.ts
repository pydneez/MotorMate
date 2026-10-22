import { z } from "zod";
import { blankAsUndefined, LineIdSchema, personName } from "./common";
import { RoleSchema } from "./role";
import { ThaiPhoneSchema } from "./thai";

/**
 * Claims of the API access token. The backend signs it (HS256, JWT_SECRET) on
 * POST /auth/login; NextAuth only stores it in its session — see CLAUDE.md "Auth architecture".
 */
export const JwtClaimsSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  iat: z.number(),
  exp: z.number(),
});

export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const PASSWORD_MIN_LENGTH = 8;

/** Body of POST /auth/register (customer self-registration). */
export const RegisterSchema = z.object({
  firstName: personName("First name"),
  lastName: personName("Last name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: ThaiPhoneSchema,
  lineId: blankAsUndefined(LineIdSchema),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
});

export type RegisterInput = z.input<typeof RegisterSchema>;
export type RegisterData = z.output<typeof RegisterSchema>;

/** The register form adds a confirmation field that never reaches the API. */
export const RegisterFormSchema = RegisterSchema.extend({
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: RoleSchema,
  /** Set for CUSTOMER users linked to a Customer record. */
  customerId: z.string().nullable(),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until accessToken expires. */
  expiresIn: z.number(),
  user: AuthUserSchema,
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
