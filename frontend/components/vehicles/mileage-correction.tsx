"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Gauge } from "lucide-react";
import { MileageCorrectionSchema } from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button, Field } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { formatKm } from "@/lib/format";

/** Admin-only "Correct mileage" button + dialog. The only way mileage can go down. */
export function MileageCorrection({ vehicleId, currentMileage }: { vehicleId: string; currentMileage: number }) {
  const router = useRouter();
  const callApi = useApi();
  const [open, setOpen] = useState(false);
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = validate(MileageCorrectionSchema, formValues(event.currentTarget));
    if (!body) return;
    const saved = await submit(() => callApi(`/vehicles/${vehicleId}/mileage-correction`, { method: "POST", body }));
    if (saved) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Gauge className="h-4 w-4" aria-hidden /> Correct mileage
      </Button>
      <Modal open={open} title="Correct mileage" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <p className="text-sm text-slate-600">Current: {formatKm(currentMileage)}</p>
          <Field label="New mileage (km)" name="mileage" type="number" min={0} inputMode="numeric" error={fieldErrors.mileage} />
          <Field label="Reason" name="reason" placeholder="e.g. Typo at check-in" error={fieldErrors.reason} />
          <p className="text-xs text-slate-500">This change is recorded in the audit log with your name.</p>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
