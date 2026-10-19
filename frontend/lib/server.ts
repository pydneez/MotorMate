import "server-only";
import { notFound, redirect } from "next/navigation";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/auth";
import { api, ApiError } from "./api";

/** The current session in a server component; sends signed-out users to /login. */
export async function requireSession(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session || session.expired) redirect("/login");
  return session;
}

/**
 * GET from the backend in a server component, with the session's token. A 404 renders the
 * page's not-found UI and a 401 sends the user back to sign in; other errors bubble up.
 */
export async function serverGet<T>(path: string): Promise<T> {
  const session = await requireSession();
  try {
    return await api<T>(path, { token: session.accessToken });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.status === 401) redirect("/login?expired=1");
    throw error;
  }
}

/** Builds "?q=..&page=.." from page searchParams, dropping empty values. */
export function queryString(params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value !== "") search.set(key, value);
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}
