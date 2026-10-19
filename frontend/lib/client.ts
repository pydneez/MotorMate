"use client";

import { useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import type { ZodTypeAny, output } from "zod";
import { api, ApiError } from "./api";

type ApiInit = Parameters<typeof api>[1];

/** `api()` bound to the signed-in user's backend token, for client components. */
export function useApi() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  return useCallback(<T,>(path: string, init: ApiInit = {}) => api<T>(path, { ...init, token }), [token]);
}

export type FieldErrors = Record<string, string | undefined>;

/**
 * Form state shared by every create/edit form: client-side validation with the shared zod
 * schema, then the API call, mapping server field errors back onto the same fields.
 */
export function useFormSubmit() {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Returns the parsed data, or null after showing the errors. */
  function validate<S extends ZodTypeAny>(schema: S, values: unknown): output<S> | null {
    const parsed = schema.safeParse(values);
    if (parsed.success) {
      setFieldErrors({});
      return parsed.data;
    }
    const errors = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
    setFieldErrors(Object.fromEntries(Object.entries(errors).map(([key, messages]) => [key, messages?.[0]])));
    setError(null);
    return null;
  }

  /** Runs the request; on failure shows its message and field errors and returns null. */
  async function submit<T>(request: () => Promise<T>): Promise<T | null> {
    setSubmitting(true);
    setError(null);
    try {
      return await request();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([key, messages]) => [key, messages?.[0]])));
      } else {
        setError("Can't reach the server. Please try again.");
      }
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  return { fieldErrors, error, submitting, validate, submit, setError, setFieldErrors };
}

/** FormData → plain object of strings (what the zod schemas expect from a form). */
export function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(Array.from(new FormData(form).entries()).map(([key, value]) => [key, String(value)]));
}
