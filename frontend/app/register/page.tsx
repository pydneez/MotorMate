"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { PASSWORD_MIN_LENGTH, RegisterFormSchema, type LoginResponse } from "@motormate/types";
import { Alert, AuthCard, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

const FIELDS = ["firstName", "lastName", "phone", "lineId", "email", "password", "confirmPassword"] as const;
type FieldName = (typeof FIELDS)[number];

export default function RegisterPage() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(FIELDS.map((name) => [name, String(form.get(name) ?? "")]));

    // Same rules the backend applies — phone is normalized to +66… here too.
    const parsed = RegisterFormSchema.safeParse(values);
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      setFieldErrors(Object.fromEntries(FIELDS.map((name) => [name, errors[name]?.[0]])));
      return;
    }
    setFieldErrors({});
    setLoading(true);

    const { confirmPassword: _confirm, ...body } = parsed.data;
    try {
      await api<LoginResponse>("/auth/register", { method: "POST", body });
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError) {
        const serverFieldErrors = Object.fromEntries(FIELDS.map((name) => [name, err.fieldErrors[name]?.[0]]));
        setFieldErrors(serverFieldErrors);
        // A field-level message (e.g. "phone already linked") is shown on the field; don't repeat it.
        setError(Object.values(serverFieldErrors).some(Boolean) ? null : err.message);
      } else {
        setError("Can't reach the server. Please try again.");
      }
      return;
    }

    // Account exists now — start a normal NextAuth session with the same credentials.
    const result = await signIn("credentials", { email: body.email, password: body.password, redirect: false });
    setLoading(false);
    if (!result || result.error) {
      router.replace("/login");
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <AuthCard title="Create your MotorMate account">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" autoComplete="given-name" error={fieldErrors.firstName} />
          <Field label="Last name" name="lastName" autoComplete="family-name" error={fieldErrors.lastName} />
          <Field
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="081-234-5678"
            error={fieldErrors.phone}
          />
          <Field label="LINE ID (optional)" name="lineId" error={fieldErrors.lineId} />
        </div>
        <Field label="Email" name="email" type="email" autoComplete="email" error={fieldErrors.email} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
            error={fieldErrors.password}
          />
          <Field
            label="Confirm password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            error={fieldErrors.confirmPassword}
          />
        </div>
        <p className="text-xs text-slate-500">
          Already a customer at the shop? Use the same email and phone number you gave us and your vehicles and service
          history will be linked automatically.
        </p>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" loading={loading} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-blue-600 hover:underline">
          Sign in →
        </Link>
      </p>
    </AuthCard>
  );
}
