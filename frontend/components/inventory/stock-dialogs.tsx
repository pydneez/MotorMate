"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardCheck, PackagePlus } from "lucide-react";
import { ReceiveStockSchema, StocktakeSchema } from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button, Field } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";

function useStockAction(itemId: string, path: "receive" | "stocktake") {
  const router = useRouter();
  const callApi = useApi();
  const form = useFormSubmit();
  async function send(body: unknown, onDone: () => void) {
    if (await form.submit(() => callApi(`/inventory/${itemId}/${path}`, { method: "POST", body }))) {
      onDone();
      router.refresh();
    }
  }
  return { ...form, send };
}

/** A delivery arrived: add the received quantity. Shows the new total as you type. */
export function ReceiveStock({ itemId, onHand, disabled }: { itemId: string; onHand: number; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const action = useStockAction(itemId, "receive");
  const added = Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 0;

  function close() {
    setOpen(false);
    setQuantity("");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = action.validate(ReceiveStockSchema, formValues(event.currentTarget));
    if (body) await action.send(body, close);
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={disabled} title={disabled ? "Reactivate the item first" : undefined}>
        <PackagePlus className="h-4 w-4" aria-hidden /> Receive stock
      </Button>
      <Modal open={open} title="Receive stock" onClose={close}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <p className="text-sm text-slate-600">On hand now: {onHand}</p>
          <Field
            label="Quantity received"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            error={action.fieldErrors.quantity}
          />
          <Field label="Note (optional)" name="note" placeholder="Supplier invoice number" error={action.fieldErrors.note} />
          <p className="text-sm font-medium text-slate-800">New on hand: {onHand + added}</p>
          {action.error && <Alert>{action.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={action.submitting}>
              Receive
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Shelf count: enter what's actually there; the difference is recorded with a reason. */
export function Stocktake({ itemId, onHand }: { itemId: string; onHand: number }) {
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const action = useStockAction(itemId, "stocktake");
  const hasCount = counted !== "" && Number.isInteger(Number(counted)) && Number(counted) >= 0;
  const difference = hasCount ? Number(counted) - onHand : null;

  function close() {
    setOpen(false);
    setCounted("");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = action.validate(StocktakeSchema, formValues(event.currentTarget));
    if (body) await action.send(body, close);
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <ClipboardCheck className="h-4 w-4" aria-hidden /> Stocktake
      </Button>
      <Modal open={open} title="Stocktake" onClose={close}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <p className="text-sm text-slate-600">System says: {onHand}</p>
          <Field
            label="Counted on the shelf"
            name="countedQuantity"
            type="number"
            inputMode="numeric"
            min={0}
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
            error={action.fieldErrors.countedQuantity}
          />
          <Field label="Reason" name="reason" placeholder="e.g. Damaged box, monthly count" error={action.fieldErrors.reason} />
          {difference !== null && (
            <p className={`text-sm font-medium ${difference === 0 ? "text-slate-500" : difference < 0 ? "text-red-700" : "text-green-700"}`}>
              {difference === 0 ? "Matches the system: nothing to adjust" : `Change: ${difference > 0 ? "+" : ""}${difference}`}
            </p>
          )}
          {action.error && <Alert>{action.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={action.submitting} disabled={difference === 0}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
