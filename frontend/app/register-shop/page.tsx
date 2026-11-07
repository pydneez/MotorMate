"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { PASSWORD_MIN_LENGTH, RegisterShopFormSchema, type ShopOption } from "@motormate/types";
import { Alert, AuthCard, Button, Field, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { formValues, useFormSubmit } from "@/lib/client";

/**
 * Public: a garage registers itself on MotorMate with its first admin login. The shop is open
 * straight away (the platform admin can suspend it later); the admin then adds staff, services
 * and stock from inside the app.
 */
export default function RegisterShopPage() {
  const router = useRouter();
  const { fieldErrors, error, submitting, validate, submit, setError } = useFormSubmit();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = validate(RegisterShopFormSchema, formValues(event.currentTarget));
    if (!data) return;
    const { adminConfirmPassword: _confirm, ...body } = data;
    const shop = await submit(() => api<ShopOption>("/shops/register", { method: "POST", body }));
    if (!shop) return;

    // The shop and its admin exist now — sign the admin in.
    const result = await signIn("credentials", { email: body.adminEmail, password: body.adminPassword, redirect: false });
    if (!result || result.error) {
      setError("Your shop is registered. Please sign in.");
      router.replace("/login");
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <AuthCard title="Register your shop">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <p className="text-sm text-slate-500">
          Your garage gets its own MotorMate: customers, vehicles, work orders, stock and invoices that only your team sees.
        </p>
        <fieldset className="space-y-4">
          <legend className="mb-2 text-sm font-semibold text-slate-900">The shop</legend>
          <Field label="Shop name" name="name" maxLength={100} error={fieldErrors.name} />
          <TextAreaField label="Address (up to 4 lines)" name="address" rows={3} maxLength={300} error={fieldErrors.address} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" name="phone" type="tel" placeholder="02-123-4567" error={fieldErrors.phone} />
            <Field label="Email (optional)" name="email" type="email" error={fieldErrors.email} />
          </div>
          <Field label="Tax ID" name="taxId" hint="13 digits; printed on invoices" error={fieldErrors.taxId} />
        </fieldset>
        <fieldset className="space-y-4 border-t border-slate-100 pt-4">
          <legend className="mb-2 pt-4 text-sm font-semibold text-slate-900">Your admin login</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" name="adminFirstName" maxLength={60} autoComplete="given-name" error={fieldErrors.adminFirstName} />
            <Field label="Last name" name="adminLastName" maxLength={60} autoComplete="family-name" error={fieldErrors.adminLastName} />
          </div>
          <Field label="Email" name="adminEmail" type="email" autoComplete="email" error={fieldErrors.adminEmail} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Password"
              name="adminPassword"
              type="password"
              autoComplete="new-password"
              hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
              error={fieldErrors.adminPassword}
            />
            <Field label="Confirm password" name="adminConfirmPassword" type="password" autoComplete="new-password" error={fieldErrors.adminConfirmPassword} />
          </div>
        </fieldset>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" loading={submitting} className="w-full">
          Register shop
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already on MotorMate?{" "}
        <Link href="/login" className="font-medium text-blue-600 hover:underline">
          Sign in →
        </Link>
      </p>
    </AuthCard>
  );
}
