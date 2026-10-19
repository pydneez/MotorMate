import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { LoginResponse } from "@motormate/types";
import { api, ApiError } from "./lib/api";

/**
 * NextAuth holds the session; the backend owns credentials and issues the API token.
 * authorize() calls POST /auth/login and the returned accessToken rides along in the
 * NextAuth session — see CLAUDE.md "Auth architecture".
 */
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
    async jwt({ token, user }) {
      // `user` is only present right after authorize(), i.e. on sign-in.
      if (user && "accessToken" in user) {
        const { id, email, firstName, lastName, role, customerId } = user;
        return {
          ...token,
          // NextAuth's base User types email as optional; ours always has one.
          user: { id, email: email ?? "", firstName, lastName, role, customerId },
          accessToken: user.accessToken,
          accessTokenExpires: user.accessTokenExpires,
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
