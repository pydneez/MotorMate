"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Car, X } from "lucide-react";
import { CreateAppointmentSchema, type AppointmentSummary, type VehicleSummary } from "@motormate/types";
import { Alert, Button, LinkButton, SelectField, TextAreaField } from "@/components/ui";
import { VehiclePicker } from "@/components/work-orders/check-in-form";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { fullName } from "@/lib/format";
import { AppointmentTimeFields } from "./appointment-time-fields";

/**
 * Book an appointment. Customers pick one of their own vehicles (it becomes a request);
 * staff search for any vehicle (phone bookings — confirmed straight away).
 */
export function BookingForm({ ownVehicles }: { ownVehicles: VehicleSummary[] | null }) {
  const router = useRouter();
  const callApi = useApi();
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();
  const [picked, setPicked] = useState<VehicleSummary | null>(null);
  const isStaff = ownVehicles === null;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const body = validate(CreateAppointmentSchema, isStaff ? { ...values, vehicleId: picked?.id ?? "" } : values);
    if (!body) return;
    const created = await submit(() => callApi<AppointmentSummary>("/appointments", { method: "POST", body }));
    if (created) {
      router.push(`/app/appointments${isStaff ? "?view=upcoming" : ""}`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {isStaff ? (
        picked ? (
          <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex gap-3 text-sm">
              <Car className="mt-0.5 h-5 w-5 text-slate-400" aria-hidden />
              <div>
                <p className="font-medium">
                  {picked.make} {picked.model} {picked.year} · {picked.plate} {picked.province}
                </p>
                <p className="text-slate-600">{fullName(picked.owner)}</p>
              </div>
            </div>
            <button type="button" onClick={() => setPicked(null)} aria-label="Choose another vehicle" className="rounded p-1 text-slate-400 hover:bg-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <VehiclePicker onPick={setPicked} />
            {fieldErrors.vehicleId && <p className="text-xs text-red-600">{fieldErrors.vehicleId}</p>}
          </>
        )
      ) : (
        <SelectField label="Vehicle" name="vehicleId" defaultValue={ownVehicles.length === 1 ? ownVehicles[0].id : ""} error={fieldErrors.vehicleId}>
          <option value="" disabled>
            Choose your vehicle
          </option>
          {ownVehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.make} {vehicle.model} · {vehicle.plate} {vehicle.province}
            </option>
          ))}
        </SelectField>
      )}

      <AppointmentTimeFields errors={fieldErrors} />
      <TextAreaField
        label="What's the visit for?"
        name="reason"
        placeholder="e.g. Brake inspection, oil change, strange noise when turning"
        error={fieldErrors.reason}
      />

      {!isStaff && (
        <p className="text-xs text-slate-500">
          We&apos;ll confirm your request. You can cancel online until 2 hours before; after that, please call us.
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <LinkButton href="/app/appointments" variant="secondary">
          Back
        </LinkButton>
        <Button type="submit" loading={submitting}>
          {isStaff ? "Book (confirmed)" : "Request appointment"}
        </Button>
      </div>
    </form>
  );
}
