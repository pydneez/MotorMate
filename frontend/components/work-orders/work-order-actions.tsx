"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  allowedNextStatuses,
  ChangeWorkOrderStatusSchema,
  WORK_ORDER_STATUS_LABEL,
  type AuthUser,
  type MechanicOption,
  type WorkOrderDetail,
  type WorkOrderStatus,
} from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button, Field } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { formatTHB } from "@/lib/format";

/** Button text for a move, phrased from where the job is now. */
function moveLabel(from: WorkOrderStatus, to: WorkOrderStatus): string {
  if (to === "CANCELLED") return "Cancel job";
  if (to === "COMPLETED") return "Complete & invoice";
  if (from === "QUALITY_CHECK" && to === "IN_PROGRESS") return "Send back to In progress";
  return `→ ${WORK_ORDER_STATUS_LABEL[to]}`;
}

const DIALOG: Partial<Record<WorkOrderStatus, { title: string; submit: string; placeholder: string }>> = {
  CANCELLED: { title: "Cancel this job?", submit: "Cancel job", placeholder: "e.g. Customer declined the quote" },
  IN_PROGRESS: { title: "Send back to In progress", submit: "Send back", placeholder: "e.g. Still squeals at low speed" },
  COMPLETED: { title: "Complete & issue invoice?", submit: "Complete & invoice", placeholder: "e.g. Road-tested, no noise" },
};

/**
 * Status buttons for the moves this user may make (same rules as the API). Cancelling,
 * completing and sending a job back from quality check open a dialog with an optional note;
 * completing then opens the new invoice.
 */
export function StatusActions({ workOrder, user }: { workOrder: WorkOrderDetail; user: AuthUser }) {
  const router = useRouter();
  const callApi = useApi();
  const { error, submitting, submit, fieldErrors, validate } = useFormSubmit();
  const [confirming, setConfirming] = useState<WorkOrderStatus | null>(null);
  const next = allowedNextStatuses(workOrder.status, { role: user.role, isAssignedMechanic: workOrder.mechanic?.id === user.id });

  async function move(status: WorkOrderStatus, note?: string) {
    const body = validate(ChangeWorkOrderStatusSchema, { status, note: note ?? "" });
    if (!body) return;
    const updated = await submit(() => callApi<WorkOrderDetail>(`/work-orders/${workOrder.id}/status`, { method: "POST", body }));
    if (!updated) return;
    setConfirming(null);
    if (updated.invoice && status === "COMPLETED") router.push(`/app/invoices/${updated.invoice.id}`);
    router.refresh();
  }

  if (next.length === 0) return null;
  const needsDialog = (to: WorkOrderStatus) =>
    to === "CANCELLED" || to === "COMPLETED" || (workOrder.status === "QUALITY_CHECK" && to === "IN_PROGRESS");
  const dialog = confirming ? DIALOG[confirming] : undefined;
  const { totals } = workOrder;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {next.map((to) => (
          <Button
            key={to}
            variant={to === "CANCELLED" ? "danger" : to === "IN_PROGRESS" && workOrder.status === "QUALITY_CHECK" ? "secondary" : "primary"}
            loading={submitting && confirming === null}
            onClick={() => (needsDialog(to) ? setConfirming(to) : move(to))}
          >
            {moveLabel(workOrder.status, to)}
          </Button>
        ))}
      </div>
      {error && !confirming && <Alert>{error}</Alert>}

      <Modal open={confirming !== null} title={dialog?.title ?? ""} onClose={() => setConfirming(null)}>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirming) move(confirming, formValues(event.currentTarget).note);
          }}
        >
          {confirming === "COMPLETED" ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p>Quality check passed? This issues the invoice and locks the job — labour and parts can&apos;t be changed afterwards.</p>
              <dl className="rounded-md bg-slate-50 p-3">
                <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatTHB(totals.subtotal)}</dd></div>
                <div className="flex justify-between"><dt>VAT {Math.round(totals.vatRate * 100)}%</dt><dd>{formatTHB(totals.vat)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>Invoice total</dt><dd>{formatTHB(totals.total)}</dd></div>
              </dl>
            </div>
          ) : (
            <p className="text-sm text-slate-700">
              {confirming === "CANCELLED"
                ? "All parts on this job go back into stock. The job can't be changed afterwards."
                : "What still needs fixing? The mechanic will see this note in the job history."}
            </p>
          )}
          <Field label={confirming === "COMPLETED" ? "Note (optional)" : "Note"} name="note" placeholder={dialog?.placeholder} error={fieldErrors.note} />
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>
              Back
            </Button>
            <Button type="submit" variant={confirming === "CANCELLED" ? "danger" : "primary"} loading={submitting}>
              {dialog?.submit}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/** Advisor/admin: assign or change the mechanic. */
export function MechanicAssign({ workOrder, mechanics }: { workOrder: WorkOrderDetail; mechanics: MechanicOption[] }) {
  const router = useRouter();
  const callApi = useApi();
  const { error, submitting, submit } = useFormSubmit();

  async function assign(mechanicId: string) {
    if (await submit(() => callApi(`/work-orders/${workOrder.id}/mechanic`, { method: "PATCH", body: { mechanicId: mechanicId || null } }))) {
      router.refresh();
    }
  }

  return (
    <div>
      <label htmlFor="mechanic" className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Mechanic
      </label>
      <select
        id="mechanic"
        value={workOrder.mechanic?.id ?? ""}
        disabled={submitting}
        onChange={(event) => assign(event.target.value)}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
      >
        <option value="">Unassigned</option>
        {mechanics.map((mechanic) => (
          <option key={mechanic.id} value={mechanic.id}>
            {mechanic.name} ({mechanic.openJobs} open)
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
