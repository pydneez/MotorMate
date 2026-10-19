import type { AuthUser } from "@motormate/types";

declare module "next-auth" {
  /** Returned by the Credentials provider's authorize(). */
  interface User extends AuthUser {
    accessToken: string;
    accessTokenExpires: number;
  }

  interface Session {
    user: AuthUser;
    /** Backend API token — send as `Authorization: Bearer` (see lib/api.ts). */
    accessToken: string;
    /** True once the backend token has expired; the user must sign in again. */
    expired: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    user: AuthUser;
    accessToken: string;
    accessTokenExpires: number;
  }
}
