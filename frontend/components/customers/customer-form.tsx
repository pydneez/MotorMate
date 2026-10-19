"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  type Customer,
  type CustomerDuplicates,
  type CustomerSummary,
} from "@motormate/types";
import { Alert, Button, Field, LinkButton, TextAreaField } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { formatThaiPhone, fullName } from "@/lib/format";

/**
 * Create / edit customer. Checks for duplicates when phone or email lose focus: a phone match
 * is a warning (save anyway), an email match blocks saving because emails are unique.
 */
export function CustomerForm({ customer }: { customer?: Customer }) {
  const router = useRouter();
  const callApi = useApi();
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();
  const [duplicates, setDuplicates] = useState<CustomerDuplicates | null>(null);
  const latestCheck = useRef(0);
  const editing = Boolean(customer);

  async function checkDuplicates(form: HTMLFormElement | null) {
    if (!form) return;
    const { phone, email } = formValues(form);
    const request = ++latestCheck.current;
    if (!phone && !email) return setDuplicates(null);
    const params = new URLSearchParams();
    if (phone) params.set("phone", phone);
    if (email) params.set("email", email);
    if (customer) params.set("excludeId", customer.id);
    try {
      const result = await callApi<CustomerDuplicates>(`/customers/duplicates?${params}`);
      // An older check can finish after a newer one; only the latest may update the warning.
      if (request === latestCheck.current) setDuplicates(result);
    } catch {
      // The check is a convenience; saving still validates server-side.
      if (request === latestCheck.current) setDuplicates(null);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const body = validate(editing ? UpdateCustomerSchema : CreateCustomerSchema, values);
    if (!body) return;

    const saved = await submit(() =>
      callApi<CustomerSummary>(editing ? `/customers/${customer!.id}` : "/customers", {
        method: editing ? "PATCH" : "POST",
        body,
      }),
    );
    if (saved) {
      router.push(`/app/customers/${saved.id}`);
      router.refresh();
    }
  }

  const phoneMatches = duplicates?.byPhone ?? [];
  const emailTaken = duplicates?.byEmail ?? null;
  const onBlurCheck = (event: React.FocusEvent<HTMLInputElement>) => checkDuplicates(event.currentTarget.form);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" name="firstName" defaultValue={customer?.firstName} error={fieldErrors.firstName} />
        <Field label="Last name" name="lastName" defaultValue={customer?.lastName} error={fieldErrors.lastName} />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          placeholder="081-234-5678"
          defaultValue={customer ? formatThaiPhone(customer.phone) : undefined}
          onBlur={onBlurCheck}
          error={fieldErrors.phone}
        />
        <Field label="LINE ID (optional)" name="lineId" defaultValue={customer?.lineId ?? ""} error={fieldErrors.lineId} />
        <Field
          label="Email (optional)"
          name="email"
          type="email"
          hint="Needed for maintenance reminders"
          defaultValue={customer?.email ?? ""}
          onBlur={onBlurCheck}
          error={fieldErrors.email}
          className="sm:col-span-2"
        />
        <TextAreaField label="Notes" name="notes" defaultValue={customer?.notes ?? ""} className="sm:col-span-2" />
      </div>

      {phoneMatches.length > 0 && (
        <Alert tone="warning">
          <p className="font-medium">Possible duplicate — a customer with this phone already exists:</p>
          <ul className="mt-1 space-y-1">
            {phoneMatches.map((match) => (
              <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {fullName(match)} · {formatThaiPhone(match.phone)} · {match.vehicleCount} vehicle
                  {match.vehicleCount === 1 ? "" : "s"}
                </span>
                <Link href={`/app/customers/${match.id}`} className="font-medium underline">
                  Open record →
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {emailTaken && (
        <Alert>
          This email is already used by{" "}
          <Link href={`/app/customers/${emailTaken.id}`} className="font-medium underline">
            {fullName(emailTaken)}
          </Link>
          . Each customer needs a different email.
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      <div className="flex justify-end gap-2">
        <LinkButton href={customer ? `/app/customers/${customer.id}` : "/app/customers"} variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" loading={submitting} disabled={Boolean(emailTaken)}>
          {phoneMatches.length > 0 ? "Save anyway" : "Save"}
        </Button>
      </div>
    </form>
  );
}
