"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UpdateShopDetailsSchema, type ShopDetails } from "@motormate/types";
import { Alert, Button, Field, TextAreaField } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { formatThaiPhone } from "@/lib/format";

/** Settings → Shop details: what invoices, the invoice PDF and customer emails print. */
export function ShopDetailsForm({ shop }: { shop: ShopDetails }) {
  const router = useRouter();
  const callApi = useApi();
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const body = validate(UpdateShopDetailsSchema, formValues(event.currentTarget));
    if (!body) return;
    if (await submit(() => callApi("/settings/shop", { method: "PATCH", body }))) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} onChange={() => setSaved(false)} noValidate className="space-y-4">
      <Field label="Shop name" name="name" defaultValue={shop.name} maxLength={100} error={fieldErrors.name} />
      <TextAreaField
        label="Address (one line per row, up to 4)"
        name="address"
        defaultValue={shop.address}
        rows={3}
        maxLength={300}
        error={fieldErrors.address}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" name="phone" type="tel" defaultValue={formatThaiPhone(shop.phone)} error={fieldErrors.phone} />
        <Field label="Email (optional)" name="email" type="email" defaultValue={shop.email ?? ""} error={fieldErrors.email} />
      </div>
      <Field label="Tax ID" name="taxId" defaultValue={shop.taxId} hint="13 digits; dashes are fine" error={fieldErrors.taxId} />
      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">Saved. New invoices, PDFs and emails use these details.</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={submitting}>
          Save shop details
        </Button>
      </div>
    </form>
  );
}
