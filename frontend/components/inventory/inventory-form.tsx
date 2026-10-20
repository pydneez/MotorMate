"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CreateInventoryItemSchema,
  UpdateInventoryItemSchema,
  type InventoryItemSummary,
} from "@motormate/types";
import { Alert, Button, Field, LinkButton } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";

/**
 * Add / edit an inventory item. Quantity is only set once (opening quantity) — after that it
 * changes through Receive, Stocktake or work orders. A price below cost warns but is allowed.
 */
export function InventoryForm({ item, categories }: { item?: InventoryItemSummary; categories: string[] }) {
  const router = useRouter();
  const callApi = useApi();
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();
  const editing = Boolean(item);
  const [cost, setCost] = useState(item ? String(item.unitCost) : "");
  const [price, setPrice] = useState(item ? String(item.unitPrice) : "");
  const priceBelowCost = cost !== "" && price !== "" && Number(price) < Number(cost);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = validate(editing ? UpdateInventoryItemSchema : CreateInventoryItemSchema, formValues(event.currentTarget));
    if (!body) return;
    const saved = await submit(() =>
      callApi<InventoryItemSummary>(editing ? `/inventory/${item!.id}` : "/inventory", {
        method: editing ? "PATCH" : "POST",
        body,
      }),
    );
    if (saved) {
      router.push(`/app/inventory/${saved.id}`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="SKU"
          name="sku"
          placeholder="FLT-CAB-UNI"
          defaultValue={item?.sku}
          hint="Letters, digits and dashes; saved in capitals"
          error={fieldErrors.sku}
          autoCapitalize="characters"
        />
        <Field
          label="Category"
          name="category"
          list="inventory-categories"
          placeholder="Filters"
          defaultValue={item?.category}
          error={fieldErrors.category}
        />
        <datalist id="inventory-categories">
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <Field label="Name" name="name" defaultValue={item?.name} error={fieldErrors.name} className="sm:col-span-2" />
        <Field
          label="Cost (฿, excl. VAT)"
          name="unitCost"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={cost}
          onChange={(event) => setCost(event.target.value)}
          error={fieldErrors.unitCost}
        />
        <Field
          label="Price (฿, excl. VAT)"
          name="unitPrice"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          error={fieldErrors.unitPrice}
        />
        <Field label="Supplier (optional)" name="supplier" defaultValue={item?.supplier ?? ""} error={fieldErrors.supplier} />
        <Field
          label="Reorder at"
          name="reorderLevel"
          type="number"
          inputMode="numeric"
          min={0}
          defaultValue={item?.reorderLevel ?? 0}
          hint="Shown as low stock at or below this quantity"
          error={fieldErrors.reorderLevel}
        />
        {!editing && (
          <Field
            label="Opening quantity"
            name="openingQuantity"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={0}
            hint="Stock on the shelf now. Later changes use Receive or Stocktake."
            error={fieldErrors.openingQuantity}
            className="sm:col-span-2"
          />
        )}
      </div>

      {priceBelowCost && <Alert tone="warning">Price is below cost. Save anyway if this part is sold at a discount.</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="flex justify-end gap-2">
        <LinkButton href={item ? `/app/inventory/${item.id}` : "/app/inventory"} variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" loading={submitting}>
          {editing ? "Save changes" : "Save item"}
        </Button>
      </div>
    </form>
  );
}
