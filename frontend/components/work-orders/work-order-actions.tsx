"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ChangeWorkOrderStatusSchema,
  statusActions,
  statusHint,
  type AuthUser,
  type MechanicOption,
  type WorkOrderDetail,
  type WorkOrderStatus,
} from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button, Field, type ButtonVariant } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { formatTHB } from "@/lib/format";

const DIALOG: Partial<Record<WorkOrderStatus, { title: string; submit: string; placeholder: string; variant: ButtonVariant }>> = {
  CANCELLED: { title: "Cancel this job?", submit: "Cancel job", placeholder: "e.g. Customer declined the quote", variant: "danger" },
  IN_PROGRESS: { title: "Fail quality check?", submit: "Back to repair", placeholder: "e.g. Still squeals at low speed", variant: "warning" },
  COMPLETED: { title: "Pass QC & issue the invoice?", submit: "Pass QC & invoice", placeholder: "e.g. Road-tested, no noise", variant: "success" },
};

/**
 * Status buttons for the moves this user may make (same rules as the API), named for what
 * they do, normal next step first and Cancel last (`statusActions()` in packages/types),
 * with a one-line hint. Cancelling, passing and failing QC open a dialog with a note;
 * passing QC then opens the new invoice.
 */
export function StatusActions({ workOrder, user }: { workOrder: WorkOrderDetail; user: AuthUser }) {
  const router = useRouter();
  const callApi = useApi();
  const { error, submitting, submit, fieldErrors, validate } = useFormSubmit();
  const [confirming, setConfirming] = useState<WorkOrderStatus | null>(null);
  const isAssignedMechanic = workOrder.mechanic?.id === user.id;
  const actions = statusActions(workOrder.status, { role: user.role, isAssignedMechanic });
  // Mechanics only get the hint on their own jobs; others can't act on it.
  const hint = user.role !== "MECHANIC" || isAssignedMechanic ? statusHint(workOrder.status, user.role) : null;

  async function move(status: WorkOrderStatus, note?: string) {
    const body = validate(ChangeWorkOrderStatusSchema, { status, note: note ?? "" });
    if (!body) return;
    const updated = await submit(() => callApi<WorkOrderDetail>(`/work-orders/${workOrder.id}/status`, { method: "POST", body }));
    if (!updated) return;
    setConfirming(null);
    if (updated.invoice && status === "COMPLETED") router.push(`/app/invoices/${updated.invoice.id}`);
    router.refresh();
  }

  if (actions.length === 0 && !hint) return null;
  const needsDialog = (to: WorkOrderStatus) =>
    to === "CANCELLED" || to === "COMPLETED" || (workOrder.status === "QUALITY_CHECK" && to === "IN_PROGRESS");
  const dialog = confirming ? DIALOG[confirming] : undefined;
  const { totals } = workOrder;

  return (
    <div className="flex flex-col items-end gap-2">
      {actions.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {actions.map(({ to, label, tone }) => (
            <Button
              key={to}
              // Cancel is the outline red on the page; the dialog's confirm is solid red.
              variant={tone === "danger" ? "dangerOutline" : tone}
              loading={submitting && confirming === null}
              onClick={() => (needsDialog(to) ? setConfirming(to) : move(to))}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      {hint && <p className="text-right text-xs text-slate-500">{hint}</p>}
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
            <Button type="submit" variant={dialog?.variant ?? "primary"} loading={submitting}>
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
