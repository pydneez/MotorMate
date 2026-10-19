"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CustomerDetail } from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button } from "@/components/ui";
import { useApi, useFormSubmit } from "@/lib/client";
import { formatThaiPhone, fullName } from "@/lib/format";

/**
 * Works out the merge direction the backend enforces: the record with the portal login is
 * always kept; with no login on either side, the record whose page we're on is kept.
 */
function direction(current: CustomerDetail, other: CustomerDetail) {
  if (current.hasPortalAccount && other.hasPortalAccount) return null;
  return other.hasPortalAccount ? { kept: other, merged: current } : { kept: current, merged: other };
}

function vehicleList(customer: CustomerDetail): string {
  if (customer.vehicles.length === 0) return "0 vehicles";
  const names = customer.vehicles.map((v) => `${v.make} ${v.model} ${v.plate}`).join(", ");
  return `${customer.vehicles.length} vehicle${customer.vehicles.length === 1 ? "" : "s"} (${names})`;
}

function RecordColumn({ title, customer }: { title: string; customer: CustomerDetail }) {
  return (
    <div className="rounded-md border border-slate-200 p-3 text-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="font-medium text-slate-900">{fullName(customer)}</p>
      <p className="text-slate-600">{formatThaiPhone(customer.phone)}</p>
      <p className="break-all text-slate-600">Email: {customer.email ?? "—"}</p>
      <p className="text-slate-600">LINE: {customer.lineId ?? "—"}</p>
      <p className="mt-1 text-slate-600">{vehicleList(customer)}</p>
    </div>
  );
}

/** "Merge…" button + confirmation popup for one duplicate of the customer being viewed. */
export function MergeCustomers({ current, other }: { current: CustomerDetail; other: CustomerDetail }) {
  const router = useRouter();
  const callApi = useApi();
  const [open, setOpen] = useState(false);
  const { error, submitting, submit } = useFormSubmit();
  const plan = direction(current, other);

  async function onMerge() {
    if (!plan) return;
    const kept = await submit(() =>
      callApi<CustomerDetail>(`/customers/${plan.kept.id}/merge`, { method: "POST", body: { sourceId: plan.merged.id } }),
    );
    if (kept) {
      setOpen(false);
      router.push(`/app/customers/${kept.id}`);
      router.refresh();
    }
  }

  // What the kept record gains, mirroring the backend's rule (kept wins, blanks filled, notes combined).
  const gains: string[] = [];
  if (plan) {
    const { kept, merged } = plan;
    const vehicleCount = kept.vehicles.length + merged.vehicles.length;
    gains.push(`${vehicleCount} vehicle${vehicleCount === 1 ? "" : "s"}, with full service history`);
    if (!kept.email && merged.email) gains.push(`email ${merged.email} (filled from the merged record)`);
    if (!kept.lineId && merged.lineId) gains.push(`LINE ID ${merged.lineId} (filled from the merged record)`);
    if (merged.notes && merged.notes !== kept.notes) gains.push(kept.notes ? "notes from both records" : "the merged record's notes");
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Merge…
      </Button>
      <Modal open={open} title="Merge duplicate customers" onClose={() => setOpen(false)}>
        {!plan ? (
          <div className="space-y-4">
            <Alert tone="warning">
              Both records have online accounts, so they may be different people sharing a phone (e.g. family members).
              These can&apos;t be merged.
            </Alert>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <RecordColumn title={plan.kept.hasPortalAccount ? "Keep (has online account)" : "Keep"} customer={plan.kept} />
              <RecordColumn title="Merge into it, then remove" customer={plan.merged} />
            </div>
            <div className="text-sm text-slate-700">
              <p className="font-medium">After merging, {fullName(plan.kept)} will have:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {gains.map((gain) => (
                  <li key={gain}>{gain}</li>
                ))}
              </ul>
              <p className="mt-2 text-slate-500">The second record will be removed. This can&apos;t be undone.</p>
            </div>
            {error && <Alert>{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button loading={submitting} onClick={onMerge}>
                Merge customers
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
