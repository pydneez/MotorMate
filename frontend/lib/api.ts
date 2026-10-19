export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** Error thrown for non-2xx API responses; `fieldErrors` comes from the backend's ZodValidationPipe. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors: Record<string, string[] | undefined> = {},
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
  const response = await fetch(`${API_URL}${path}`, {
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
    throw new ApiError(message, response.status, data?.errors ?? {});
  }
  return data as T;
}
