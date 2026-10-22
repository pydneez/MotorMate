"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { z } from "zod";
import { ChangePasswordSchema, UpdateOwnCustomerSchema } from "@motormate/types";
import { Alert, Button, Field } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";

/** The form adds a confirmation field that never reaches the API. */
const ChangePasswordFormSchema = z
  .object({ currentPassword: z.string(), newPassword: z.string(), confirmPassword: z.string() })
  .superRefine((data, ctx) => {
    const parsed = ChangePasswordSchema.safeParse(data);
    if (!parsed.success) parsed.error.issues.forEach((issue) => ctx.addIssue(issue));
    if (data.newPassword !== data.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Passwords do not match", path: ["confirmPassword"] });
    }
  });

export function ChangePasswordForm() {
  const callApi = useApi();
  const formRef = useRef<HTMLFormElement>(null);
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const values = validate(ChangePasswordFormSchema, formValues(event.currentTarget));
    if (!values) return;
    let ok = false;
    await submit(async () => {
      await callApi("/auth/me/password", {
        method: "PATCH",
        body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
      });
      ok = true;
      return true;
    });
    if (ok) {
      formRef.current?.reset();
      setSaved(true);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
      <Field
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        error={fieldErrors.currentPassword}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" name="newPassword" type="password" autoComplete="new-password" error={fieldErrors.newPassword} />
        <Field
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          error={fieldErrors.confirmPassword}
        />
      </div>
      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">Password updated.</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={submitting}>
          Update password
        </Button>
      </div>
    </form>
  );
}

/** Customers can change their phone and LINE ID; email is fixed (it's their sign-in). */
export function OwnContactForm({ phone, lineId }: { phone: string; lineId: string }) {
  const router = useRouter();
  const callApi = useApi();
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const body = validate(UpdateOwnCustomerSchema, formValues(event.currentTarget));
    if (!body) return;
    if (await submit(() => callApi("/customers/me", { method: "PATCH", body }))) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" name="phone" type="tel" defaultValue={phone} error={fieldErrors.phone} />
        <Field label="LINE ID" name="lineId" maxLength={20} defaultValue={lineId} error={fieldErrors.lineId} />
      </div>
      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">Contact details saved.</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={submitting}>
          Save contact details
        </Button>
      </div>
    </form>
  );
}
