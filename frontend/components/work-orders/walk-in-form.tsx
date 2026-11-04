"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { UserRound, X } from "lucide-react";
import {
  WalkInCheckInSchema,
  type CustomerDetail,
  type CustomerDuplicates,
  type CustomerSummary,
  type MechanicOption,
  type VehicleDuplicates,
  type VehicleSummary,
  type WorkOrderDetail,
} from "@motormate/types";
import { Alert, Button, Field, LinkButton, SelectField, TextAreaField } from "@/components/ui";
import { PROVINCES } from "@/components/vehicles/vehicle-form";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { formatThaiPhone, fullName } from "@/lib/format";
import { MechanicSelect } from "./check-in-form";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">{children}</h2>;
}

/**
 * Walk-in check-in on one screen: customer (new, or an existing one found by phone), their new
 * car, and the visit. Saved in one request, so nothing is half-created if e.g. the VIN is taken.
 */
export function WalkInForm({ mechanics, initialPhone }: { mechanics: MechanicOption[]; initialPhone?: string }) {
  const router = useRouter();
  const callApi = useApi();
  const { fieldErrors, error, submitting, validate, submit } = useFormSubmit();
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [customerVehicles, setCustomerVehicles] = useState<VehicleSummary[]>([]);
  const [phoneMatches, setPhoneMatches] = useState<CustomerSummary[]>([]);
  const [emailTaken, setEmailTaken] = useState<CustomerSummary | null>(null);
  const [vehicleDuplicates, setVehicleDuplicates] = useState<VehicleDuplicates | null>(null);
  const latestCustomerCheck = useRef(0);
  const latestVehicleCheck = useRef(0);
  const checkedInitialPhone = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { status } = useSession();

  async function checkCustomer(form: HTMLFormElement | null) {
    if (!form) return;
    const { phone, email } = formValues(form);
    const request = ++latestCustomerCheck.current;
    if (!phone && !email) {
      setPhoneMatches([]);
      setEmailTaken(null);
      return;
    }
    const params = new URLSearchParams();
    if (phone) params.set("phone", phone);
    if (email) params.set("email", email);
    try {
      const result = await callApi<CustomerDuplicates>(`/customers/duplicates?${params}`);
      if (request !== latestCustomerCheck.current) return;
      setPhoneMatches(result.byPhone);
      setEmailTaken(result.byEmail);
    } catch {
      // A convenience only; the API still checks on save.
    }
  }

  async function checkVehicle(form: HTMLFormElement | null) {
    if (!form) return;
    const { plate, province, vin } = formValues(form);
    const params = new URLSearchParams();
    if (vin) params.set("vin", vin);
    if (plate && province) {
      params.set("plate", plate);
      params.set("province", province);
    }
    const request = ++latestVehicleCheck.current;
    if (!params.size) return setVehicleDuplicates(null);
    try {
      const result = await callApi<VehicleDuplicates>(`/vehicles/duplicates?${params}`);
      if (request === latestVehicleCheck.current) setVehicleDuplicates(result);
    } catch {
      if (request === latestVehicleCheck.current) setVehicleDuplicates(null);
    }
  }

  function pickCustomer(match: CustomerSummary) {
    setCustomer(match);
    setPhoneMatches([]);
    setEmailTaken(null);
    setCustomerVehicles([]);
    // Their cars, so a returning customer's known car is checked in directly, not re-registered.
    if (match.vehicleCount > 0) {
      callApi<CustomerDetail>(`/customers/${match.id}`)
        .then((detail) => setCustomerVehicles(detail.vehicles))
        .catch(() => setCustomerVehicles([]));
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = validate(WalkInCheckInSchema, { ...formValues(event.currentTarget), customerId: customer?.id ?? "" });
    if (!body) return;
    const created = await submit(() => callApi<WorkOrderDetail>("/work-orders/walk-in", { method: "POST", body }));
    if (created) {
      router.push(`/app/work-orders/${created.id}`);
      router.refresh();
    }
  }

  // Arriving with ?phone= (from a search that found no car): look the number up once signed-in
  // requests can be made. The ref keeps the effect from re-running on every render.
  const checkCustomerRef = useRef(checkCustomer);
  checkCustomerRef.current = checkCustomer;
  useEffect(() => {
    if (status !== "authenticated" || !initialPhone || checkedInitialPhone.current) return;
    checkedInitialPhone.current = true;
    checkCustomerRef.current(formRef.current);
  }, [status, initialPhone]);

  const onCustomerBlur = (event: React.FocusEvent<HTMLInputElement>) => checkCustomer(event.currentTarget.form);
  const onVehicleBlur = (event: React.SyntheticEvent<HTMLInputElement | HTMLSelectElement>) => checkVehicle(event.currentTarget.form);

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <SectionTitle>Customer</SectionTitle>
        {customer ? (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
            <div className="flex gap-3 text-sm">
              <UserRound className="mt-0.5 h-5 w-5 text-slate-400" aria-hidden />
              <div>
                <p className="font-medium">{fullName(customer)}</p>
                <p className="text-slate-600">
                  {formatThaiPhone(customer.phone)} · {customer.vehicleCount} vehicle{customer.vehicleCount === 1 ? "" : "s"} on file
                </p>
              </div>
            </div>
            <button type="button" onClick={() => setCustomer(null)} aria-label="Enter a new customer instead" className="rounded p-1 text-slate-400 hover:bg-slate-200">
              <X className="h-4 w-4" />
            </button>
            {customerVehicles.length > 0 && (
              <div className="w-full basis-full text-sm">
                <p className="font-medium text-slate-700">Is it one of these cars?</p>
                <ul className="mt-1 space-y-1">
                  {customerVehicles.map((vehicle) => (
                    <li key={vehicle.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {vehicle.make} {vehicle.model} · {vehicle.plate} {vehicle.province}
                      </span>
                      <LinkButton href={`/app/work-orders/new?vehicleId=${vehicle.id}`} variant="success" className="px-3 py-1 text-xs">
                        Check in this car
                      </LinkButton>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-slate-500">Otherwise, add the new car below.</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <Field
              label="Phone"
              name="phone"
              type="tel"
              placeholder="081-234-5678"
              defaultValue={initialPhone}
              hint="Enter first — we'll look for an existing customer"
              onBlur={onCustomerBlur}
              error={fieldErrors.phone}
              className="sm:col-span-2"
            />
            {phoneMatches.length > 0 && (
              <div className="sm:col-span-2">
                <Alert tone="warning">
                  <p className="font-medium">A customer with this phone already exists:</p>
                  <ul className="mt-1 space-y-1">
                    {phoneMatches.map((match) => (
                      <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {fullName(match)} · {formatThaiPhone(match.phone)} · {match.vehicleCount} vehicle{match.vehicleCount === 1 ? "" : "s"}
                        </span>
                        <button type="button" onClick={() => pickCustomer(match)} className="font-medium underline">
                          Use this customer
                        </button>
                      </li>
                    ))}
                  </ul>
                </Alert>
              </div>
            )}
            <Field label="First name" name="firstName" maxLength={60} error={fieldErrors.firstName} />
            <Field label="Last name" name="lastName" maxLength={60} error={fieldErrors.lastName} />
            <Field label="Email (optional)" name="email" type="email" onBlur={onCustomerBlur} error={fieldErrors.email} />
            <Field label="LINE ID (optional)" name="lineId" maxLength={20} error={fieldErrors.lineId} />
            {emailTaken && (
              <div className="sm:col-span-2">
                <Alert>
                  This email is already used by {fullName(emailTaken)}.{" "}
                  <button type="button" onClick={() => pickCustomer(emailTaken)} className="font-medium underline">
                    Use this customer
                  </button>{" "}
                  or leave the email blank.
                </Alert>
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SectionTitle>Vehicle</SectionTitle>
        <Field label="Plate" name="plate" placeholder="1กข 1234" onBlur={onVehicleBlur} error={fieldErrors.plate} />
        <SelectField label="Province" name="province" defaultValue="" onChange={onVehicleBlur} error={fieldErrors.province}>
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
          onBlur={onVehicleBlur}
          error={fieldErrors.vin}
          className="sm:col-span-2"
          autoCapitalize="characters"
        />
        <Field label="Make" name="make" maxLength={40} placeholder="Honda" error={fieldErrors.make} />
        <Field label="Model" name="model" maxLength={60} placeholder="Civic" error={fieldErrors.model} />
        <Field label="Year" name="year" type="number" inputMode="numeric" error={fieldErrors.year} />
        <Field label="Color (optional)" name="color" maxLength={30} error={fieldErrors.color} />
        {vehicleDuplicates?.vinTaken && (
          <div className="sm:col-span-2">
            <Alert>
              This VIN is already registered
              {vehicleDuplicates.byVin && (
                <>
                  {" "}
                  to{" "}
                  <Link href={`/app/work-orders/new?vehicleId=${vehicleDuplicates.byVin.id}`} className="font-medium underline">
                    {vehicleDuplicates.byVin.make} {vehicleDuplicates.byVin.model} ({fullName(vehicleDuplicates.byVin.owner)})
                  </Link>{" "}
                  — check that car in instead
                </>
              )}
              .
            </Alert>
          </div>
        )}
        {vehicleDuplicates && !vehicleDuplicates.vinTaken && vehicleDuplicates.plateMatchCount > 0 && (
          <div className="sm:col-span-2">
            <Alert tone="warning">A vehicle with this plate and province already exists. Check it isn&apos;t the same car.</Alert>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SectionTitle>Visit</SectionTitle>
        <Field label="Mileage now (km)" name="mileageIn" type="number" inputMode="numeric" min={0} error={fieldErrors.mileageIn} />
        <MechanicSelect mechanics={mechanics} error={fieldErrors.mechanicId} />
        <TextAreaField
          label="Customer's complaint"
          name="complaint"
          placeholder="e.g. Brakes squeal when stopping"
          error={fieldErrors.complaint}
          className="sm:col-span-2"
        />
      </div>

      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <LinkButton href="/app/work-orders" variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" loading={submitting} disabled={Boolean(vehicleDuplicates?.vinTaken || (!customer && emailTaken))}>
          Register &amp; check in
        </Button>
      </div>
    </form>
  );
}
