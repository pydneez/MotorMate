"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  CreateVehicleSchema,
  THAI_PROVINCES,
  UpdateVehicleSchema,
  type Vehicle,
  type VehicleDuplicates,
  type VehicleSummary,
} from "@motormate/types";
import { Alert, Button, Field, LinkButton, SelectField } from "@/components/ui";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { fullName } from "@/lib/format";

/** Provinces in Thai alphabetical order for the dropdown. */
const PROVINCES = [...THAI_PROVINCES].sort((a, b) => a.localeCompare(b, "th"));

/**
 * Create / edit vehicle. A taken VIN blocks saving (it's unique); the same plate in the same
 * province only warns. Mileage is only set on create — later changes go through work orders
 * or an admin correction.
 */
export function VehicleForm({
  vehicle,
  customerId,
  cancelHref,
}: {
  vehicle?: Vehicle;
  /** Staff adding to a specific customer; omitted when a customer adds their own. */
  customerId?: string;
  cancelHref: string;
}) {
  const router = useRouter();
  const callApi = useApi();
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();
  const [duplicates, setDuplicates] = useState<VehicleDuplicates | null>(null);
  const latestCheck = useRef(0);
  const editing = Boolean(vehicle);

  async function checkDuplicates(form: HTMLFormElement | null) {
    if (!form) return;
    const { plate, province, vin } = formValues(form);
    const params = new URLSearchParams();
    if (vin) params.set("vin", vin);
    if (plate && province) {
      params.set("plate", plate);
      params.set("province", province);
    }
    const request = ++latestCheck.current;
    if (!params.size) return setDuplicates(null);
    if (vehicle) params.set("excludeId", vehicle.id);
    try {
      const result = await callApi<VehicleDuplicates>(`/vehicles/duplicates?${params}`);
      // An older check can finish after a newer one; only the latest may update the warning.
      if (request === latestCheck.current) setDuplicates(result);
    } catch {
      if (request === latestCheck.current) setDuplicates(null);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const body = editing
      ? validate(UpdateVehicleSchema, values)
      : validate(CreateVehicleSchema, { ...values, customerId });
    if (!body) return;

    const saved = await submit(() =>
      callApi<VehicleSummary>(editing ? `/vehicles/${vehicle!.id}` : "/vehicles", {
        method: editing ? "PATCH" : "POST",
        body,
      }),
    );
    if (saved) {
      router.push(`/app/vehicles/${saved.id}`);
      router.refresh();
    }
  }

  const onBlurCheck = (event: React.SyntheticEvent<HTMLInputElement | HTMLSelectElement>) =>
    checkDuplicates(event.currentTarget.form);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Plate" name="plate" placeholder="1กข 1234" defaultValue={vehicle?.plate} onBlur={onBlurCheck} error={fieldErrors.plate} />
        <SelectField
          label="Province"
          name="province"
          defaultValue={vehicle?.province ?? ""}
          onChange={onBlurCheck}
          error={fieldErrors.province}
        >
          <option value="" disabled>
            Choose a province…
          </option>
          {PROVINCES.map((province) => (
            <option key={province} value={province}>
              {province}
            </option>
          ))}
        </SelectField>
        <Field
          label="VIN"
          name="vin"
          hint="17 characters, on the windscreen or registration book"
          defaultValue={vehicle?.vin}
          onBlur={onBlurCheck}
          error={fieldErrors.vin}
          className="sm:col-span-2"
          autoCapitalize="characters"
        />
        <Field label="Make" name="make" placeholder="Honda" defaultValue={vehicle?.make} error={fieldErrors.make} />
        <Field label="Model" name="model" placeholder="Civic" defaultValue={vehicle?.model} error={fieldErrors.model} />
        <Field label="Year" name="year" type="number" inputMode="numeric" defaultValue={vehicle?.year} error={fieldErrors.year} />
        <Field label="Color (optional)" name="color" defaultValue={vehicle?.color ?? ""} error={fieldErrors.color} />
        {!editing && (
          <Field
            label="Current mileage (km)"
            name="mileage"
            type="number"
            inputMode="numeric"
            min={0}
            error={fieldErrors.mileage}
            className="sm:col-span-2"
          />
        )}
      </div>

      {duplicates?.vinTaken && (
        <Alert>
          This VIN is already registered
          {duplicates.byVin ? (
            <>
              {" "}
              to{" "}
              <Link href={`/app/vehicles/${duplicates.byVin.id}`} className="font-medium underline">
                {duplicates.byVin.make} {duplicates.byVin.model} ({fullName(duplicates.byVin.owner)})
              </Link>
            </>
          ) : (
            ". Please contact the shop"
          )}
          .
        </Alert>
      )}
      {duplicates && duplicates.plateMatchCount > 0 && (
        <Alert tone="warning">
          {duplicates.byPlate.length > 0 ? (
            <>
              A vehicle with this plate and province already exists:{" "}
              {duplicates.byPlate.map((match) => (
                <Link key={match.id} href={`/app/vehicles/${match.id}`} className="font-medium underline">
                  {match.make} {match.model} ({fullName(match.owner)})
                </Link>
              ))}
              . Check it isn't the same car before saving.
            </>
          ) : (
            "A vehicle with this plate and province is already registered. Check the plate before saving."
          )}
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      <div className="flex justify-end gap-2">
        <LinkButton href={cancelHref} variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" loading={submitting} disabled={Boolean(duplicates?.vinTaken)}>
          {editing ? "Save changes" : "Save vehicle"}
        </Button>
      </div>
    </form>
  );
}
