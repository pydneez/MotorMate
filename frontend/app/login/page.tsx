"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { LoginSchema } from "@motormate/types";
import { Alert, AuthCard, Button, Field } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/app";
  const expired = searchParams.get("expired") === "1";

  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const parsed = LoginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      setFieldErrors({ email: errors.email?.[0], password: errors.password?.[0] });
      return;
    }
    setFieldErrors({});
    setLoading(true);
    const result = await signIn("credentials", { ...parsed.data, redirect: false });
    setLoading(false);
    if (!result || result.error) {
      setError(result?.error ?? "Sign in failed");
      return;
    }
    router.replace(callbackUrl);
    router.refresh();
  }

  return (
    <AuthCard title="Sign in">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {expired && !error && <Alert>Your session expired. Please sign in again.</Alert>}
        <Field label="Email" name="email" type="email" autoComplete="email" error={fieldErrors.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={fieldErrors.password}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" loading={loading}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Car owner?{" "}
        <Link href="/register" className="font-medium text-blue-600 hover:underline">
          Create an account →
        </Link>
      </p>
    </AuthCard>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
