import { z } from "zod";
import { RoleSchema } from "./role";

/**
 * Shape of the JWT signed by NextAuth (apps/web) and verified by the
 * Passport JWT strategy (apps/api) via the shared NEXTAUTH_SECRET / JWT_SECRET.
 */
export const JwtClaimsSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  iat: z.number(),
  exp: z.number(),
});

export type JwtClaims = z.infer<typeof JwtClaimsSchema>;
