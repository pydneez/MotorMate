import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { LoginResponse } from "@motormate/types";
import { api, ApiError } from "./lib/api";

/**
 * NextAuth holds the session; the backend owns credentials and issues the API token.
 * authorize() calls POST /auth/login and the returned accessToken rides along in the
 * NextAuth session — see CLAUDE.md "Auth architecture".
 */
function isShopChange(value: unknown): value is { shopId: string; link?: boolean } {
  return typeof value === "object" && value !== null && typeof (value as { shopId?: unknown }).shopId === "string";
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        try {
          const result = await api<LoginResponse>("/auth/login", {
            method: "POST",
            body: { email: credentials.email, password: credentials.password },
          });
          return {
            ...result.user,
            accessToken: result.accessToken,
            accessTokenExpires: Date.now() + result.expiresIn * 1000,
          };
        } catch (error) {
          // Surface the backend's message ("Invalid email or password", "deactivated", ...).
          if (error instanceof ApiError) throw new Error(error.message);
          throw new Error("Can't reach the server. Please try again.");
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // `user` is only present right after authorize(), i.e. on sign-in.
      if (user && "accessToken" in user) {
        const { id, email, firstName, lastName, role, customerId, shopId, shopName } = user;
        return {
          ...token,
          // NextAuth's base User types email as optional; ours always has one.
          user: { id, email: email ?? "", firstName, lastName, role, customerId, shopId, shopName },
          accessToken: user.accessToken,
          accessTokenExpires: user.accessTokenExpires,
        };
      }
      // A customer switching shop (or linking a new one): useSession().update({ shopId, link }).
      // The backend issues a token for that shop; the session swaps to it. Runs on the server,
      // so the client never handles the API token for this.
      if (trigger === "update" && isShopChange(session)) {
        let result: LoginResponse;
        try {
          result = await api<LoginResponse>(session.link ? "/auth/shops" : "/auth/switch-shop", {
            method: "POST",
            token: token.accessToken,
            body: { shopId: session.shopId },
          });
        } catch {
          // Keep the current shop; the caller sees the shop didn't change and says so.
          return token;
        }
        return {
          ...token,
          user: result.user,
          accessToken: result.accessToken,
          accessTokenExpires: Date.now() + result.expiresIn * 1000,
        };
      }
      return token;
    },
    async session({ session, token }) {
      session.user = token.user;
      session.accessToken = token.accessToken;
      session.expired = Date.now() >= token.accessTokenExpires;
      return session;
    },
  },
};
