"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import {
  AddLabourSchema,
  AddPartSchema,
  UpdateWorkOrderDetailsSchema,
  type InventoryItemSummary,
  type Paginated,
  type WorkOrderDetail,
} from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button, Card, Field, TextAreaField } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { formatTHB } from "@/lib/format";

function useWorkOrderCall(workOrderId: string) {
  const router = useRouter();
  const callApi = useApi();
  const form = useFormSubmit();
  async function send(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<boolean> {
    const ok = await form.submit(() => callApi(`/work-orders/${workOrderId}${path}`, { method, body }));
    if (ok) router.refresh();
    return Boolean(ok);
  }
  return { ...form, send };
}

/** Diagnosis, work performed and internal notes — editable by staff and the assigned mechanic. */
export function NotesSection({ workOrder, canEdit }: { workOrder: WorkOrderDetail; canEdit: boolean }) {
  const action = useWorkOrderCall(workOrder.id);
  const [saved, setSaved] = useState(false);

  if (!canEdit) {
    return (
      <Card className="space-y-3 p-4 text-sm">
        {(
          [
            ["Diagnosis", workOrder.diagnosis],
            ["Work performed", workOrder.workPerformed],
            ["Notes", workOrder.notes],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="whitespace-pre-line text-slate-800">{value ?? <span className="text-slate-400">—</span>}</p>
          </div>
        ))}
      </Card>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const body = action.validate(UpdateWorkOrderDetailsSchema, formValues(event.currentTarget));
    if (body && (await action.send("", "PATCH", body))) setSaved(true);
  }

  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} noValidate className="space-y-3" onChange={() => setSaved(false)}>
        <TextAreaField label="Diagnosis" name="diagnosis" defaultValue={workOrder.diagnosis ?? ""} error={action.fieldErrors.diagnosis} />
        <TextAreaField label="Work performed" name="workPerformed" defaultValue={workOrder.workPerformed ?? ""} error={action.fieldErrors.workPerformed} />
        <TextAreaField label="Internal notes" name="notes" defaultValue={workOrder.notes ?? ""} error={action.fieldErrors.notes} />
        {action.error && <Alert>{action.error}</Alert>}
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-sm text-green-700">Saved</span>}
          <Button type="submit" variant="secondary" loading={action.submitting}>
            Save notes
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Labour lines with an inline add form. */
export function LabourSection({ workOrder, canEdit }: { workOrder: WorkOrderDetail; canEdit: boolean }) {
  const action = useWorkOrderCall(workOrder.id);
  const formRef = useRef<HTMLFormElement>(null);

  async function onAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = action.validate(AddLabourSchema, formValues(event.currentTarget));
    if (body && (await action.send("/labour", "POST", body))) formRef.current?.reset();
  }

  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold">Labour</h3>
      {workOrder.labour.length === 0 ? (
        <p className="text-sm text-slate-500">No labour yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {workOrder.labour.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 py-2">
              <span>{line.description}</span>
              <span className="flex items-center gap-2">
                {formatTHB(line.laborCost)}
                {canEdit && (
                  <button
                    onClick={() => action.send(`/labour/${line.id}`, "DELETE")}
                    aria-label={`Remove ${line.description}`}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form ref={formRef} onSubmit={onAdd} noValidate className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-start">
          <Field label="Work" name="description" placeholder="e.g. Replace front pads" error={action.fieldErrors.description} />
          <Field label="Cost (฿)" name="laborCost" type="number" inputMode="decimal" step="0.01" min={0} error={action.fieldErrors.laborCost} />
          <Button type="submit" variant="secondary" loading={action.submitting} className="sm:mt-6">
            <Plus className="h-4 w-4" aria-hidden /> Add
          </Button>
        </form>
      )}
      {action.error && <div className="mt-2"><Alert>{action.error}</Alert></div>}
    </Card>
  );
}

/** Search active inventory and add a quantity to the job (stock is deducted immediately). */
function AddPartDialog({ workOrderId, onClose }: { workOrderId: string; onClose: () => void }) {
  const callApi = useApi();
  const action = useWorkOrderCall(workOrderId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InventoryItemSummary[]>([]);
  const [chosen, setChosen] = useState<InventoryItemSummary | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const data = await callApi<Paginated<InventoryItemSummary>>(`/inventory?pageSize=8&q=${encodeURIComponent(query.trim())}`);
        if (request === latest.current) setResults(data.items);
      } catch {
        if (request === latest.current) setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, callApi]);

  async function onAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = action.validate(AddPartSchema, { ...formValues(event.currentTarget), inventoryItemId: chosen?.id ?? "" });
    if (body && (await action.send("/parts", "POST", body))) onClose();
  }

  return (
    <Modal open title="Add part" onClose={onClose}>
      {!chosen ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search SKU or part name…"
              className="block w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {results.length === 0 && <li className="p-3 text-sm text-slate-500">No parts found.</li>}
            {results.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={item.quantityOnHand === 0}
                  onClick={() => setChosen(item)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>
                    <span className="block font-medium">{item.name}</span>
                    <span className="block font-mono text-xs text-slate-500">{item.sku}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-600">
                    {item.quantityOnHand === 0 ? "Out of stock" : `${item.quantityOnHand} in stock`}
                    <span className="block">{formatTHB(item.unitPrice)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form onSubmit={onAdd} noValidate className="space-y-4">
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <p className="font-medium">{chosen.name}</p>
            <p className="text-slate-600">
              {chosen.quantityOnHand} in stock · {formatTHB(chosen.unitPrice)} each (excl. VAT)
            </p>
          </div>
          <Field
            label="Quantity"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={chosen.quantityOnHand}
            defaultValue={1}
            error={action.fieldErrors.quantity}
          />
          {action.error && <Alert>{action.error}</Alert>}
          <div className="flex justify-between gap-2">
            <Button type="button" variant="secondary" onClick={() => setChosen(null)}>
              ← Other part
            </Button>
            <Button type="submit" loading={action.submitting}>
              Add to job
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Parts used on the job. */
export function PartsSection({ workOrder, canEdit }: { workOrder: WorkOrderDetail; canEdit: boolean }) {
  const action = useWorkOrderCall(workOrder.id);
  const [adding, setAdding] = useState(false);

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Parts</h3>
        {canEdit && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add part
          </Button>
        )}
      </div>
      {workOrder.parts.length === 0 ? (
        <p className="text-sm text-slate-500">No parts yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {workOrder.parts.map((part) => (
            <li key={part.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {part.name} <span className="text-slate-500">×{part.quantity}</span>
                <span className="block font-mono text-xs text-slate-500">
                  {part.sku} · {formatTHB(part.unitPrice)} each
                </span>
              </span>
              <span className="flex items-center gap-2">
                {formatTHB(part.lineTotal)}
                {canEdit && (
                  <button
                    onClick={() => action.send(`/parts/${part.id}`, "DELETE")}
                    aria-label={`Remove ${part.name} (returns it to stock)`}
                    title="Remove (returns it to stock)"
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {action.error && <div className="mt-2"><Alert>{action.error}</Alert></div>}
      {adding && <AddPartDialog workOrderId={workOrder.id} onClose={() => setAdding(false)} />}
    </Card>
  );
}
