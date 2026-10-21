/**
 * Base URL of the NestJS backend (routes live under /v1).
 *
 * The browser uses NEXT_PUBLIC_API_URL, baked in at build time: `/v1` on AWS, where the site
 * and the API share one address. The Next.js server (server components, NextAuth's
 * authorize()) can't fetch a relative URL, so on AWS it calls the load balancer directly via
 * API_INTERNAL_URL, read at runtime — one image then works in every AWS account.
 */
export function apiBaseUrl(isServer = typeof window === "undefined"): string {
  const publicUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/v1";
  if (!isServer) return publicUrl;
  const serverUrl = process.env.API_INTERNAL_URL ?? publicUrl;
  if (serverUrl.startsWith("/")) {
    throw new Error("API_INTERNAL_URL must be set when NEXT_PUBLIC_API_URL is a relative path");
  }
  return serverUrl;
}

/** Error thrown for non-2xx API responses; `fieldErrors` comes from the backend's ZodValidationPipe. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors: Record<string, string[] | undefined> = {},
    /** The full error body, for extra fields such as `workOrderId` on a conflict. */
    readonly body: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

type ApiOptions = Omit<RequestInit, "body"> & {
  /** The backend access token from the NextAuth session (`session.accessToken`). */
  token?: string;
  body?: unknown;
};

/** Calls the NestJS backend, attaching the bearer token and JSON-encoding the body. */
export async function api<T>(path: string, { token, body, headers, ...init }: ApiOptions = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "Something went wrong";
    throw new ApiError(message, response.status, data?.errors ?? {}, data);
  }
  return data as T;
}
