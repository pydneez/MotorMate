"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Car, Search, X } from "lucide-react";
import {
  CreateWorkOrderSchema,
  type MechanicOption,
  type Paginated,
  type VehicleSummary,
  type WorkOrderDetail,
} from "@motormate/types";
import { Alert, Button, Field, LinkButton, SelectField, TextAreaField } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { formValues, useApi, useFormSubmit } from "@/lib/client";
import { formatKm, fullName } from "@/lib/format";

/** Search vehicles by plate, VIN or owner and pick one. */
function VehiclePicker({ onPick }: { onPick: (vehicle: VehicleSummary) => void }) {
  const callApi = useApi();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VehicleSummary[]>([]);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const request = ++latest.current;
    if (q.length < 2) return setResults([]);
    const timer = setTimeout(async () => {
      try {
        const data = await callApi<Paginated<VehicleSummary>>(`/vehicles?pageSize=8&q=${encodeURIComponent(q)}`);
        if (request === latest.current) setResults(data.items);
      } catch {
        if (request === latest.current) setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, callApi]);

  return (
    <div>
      <label htmlFor="vehicle-search" className="mb-1 block text-sm font-medium text-slate-700">
        Vehicle
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          id="vehicle-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search plate, VIN or customer…"
          autoComplete="off"
          className="block w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </div>
      {results.length > 0 && (
        <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white shadow-sm">
          {results.map((vehicle) => (
            <li key={vehicle.id}>
              <button
                type="button"
                onClick={() => onPick(vehicle)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium">
                  {vehicle.plate} <span className="font-normal text-slate-500">{vehicle.province}</span>
                </span>
                <span className="block text-xs text-slate-500">
                  {vehicle.make} {vehicle.model} {vehicle.year} · {fullName(vehicle.owner)} · {formatKm(vehicle.mileage)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && results.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">
          No match.{" "}
          <Link href="/app/work-orders/new?mode=walk-in" className="text-blue-700 underline">
            Register a new customer &amp; vehicle
          </Link>{" "}
          and check in at once.
        </p>
      )}
    </div>
  );
}

/** Optional mechanic for a new job, showing each one's open workload. */
export function MechanicSelect({ mechanics, error }: { mechanics: MechanicOption[]; error?: string }) {
  return (
    <SelectField label="Mechanic (optional)" name="mechanicId" defaultValue="" error={error}>
      <option value="">Assign later</option>
      {mechanics.map((mechanic) => (
        <option key={mechanic.id} value={mechanic.id}>
          {mechanic.name} ({mechanic.openJobs} open job{mechanic.openJobs === 1 ? "" : "s"})
        </option>
      ))}
    </SelectField>
  );
}

/** Check-in: pick the vehicle, record the mileage and the customer's complaint, optionally assign. */
export function CheckInForm({ initialVehicle, mechanics }: { initialVehicle: VehicleSummary | null; mechanics: MechanicOption[] }) {
  const router = useRouter();
  const callApi = useApi();
  const { fieldErrors, error, submitting, validate, setError } = useFormSubmit();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(initialVehicle);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpenJobId(null);
    const body = validate(CreateWorkOrderSchema, { ...formValues(event.currentTarget), vehicleId: vehicle?.id ?? "" });
    if (!body) return;
    setSaving(true);
    try {
      const created = await callApi<WorkOrderDetail>("/work-orders", { method: "POST", body });
      router.push(`/app/work-orders/${created.id}`);
      router.refresh();
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError) {
        setError(err.message);
        if (typeof err.body?.workOrderId === "string") setOpenJobId(err.body.workOrderId);
        if (err.fieldErrors.mileageIn) setError(err.fieldErrors.mileageIn[0] ?? err.message);
      } else {
        setError("Can't reach the server. Please try again.");
      }
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {vehicle ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex gap-3">
            <Car className="mt-0.5 h-5 w-5 text-slate-400" aria-hidden />
            <div className="text-sm">
              <p className="font-medium">
                {vehicle.make} {vehicle.model} {vehicle.year} · {vehicle.plate} {vehicle.province}
              </p>
              <p className="text-slate-600">
                {fullName(vehicle.owner)} · last recorded {formatKm(vehicle.mileage)}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setVehicle(null)} aria-label="Choose another vehicle" className="rounded p-1 text-slate-400 hover:bg-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <VehiclePicker onPick={setVehicle} />
          {fieldErrors.vehicleId && <p className="text-xs text-red-600">{fieldErrors.vehicleId}</p>}
        </>
      )}

      <Field
        label="Mileage now (km)"
        name="mileageIn"
        type="number"
        inputMode="numeric"
        min={vehicle?.mileage ?? 0}
        hint={vehicle ? `Last recorded ${formatKm(vehicle.mileage)}` : undefined}
        error={fieldErrors.mileageIn}
      />
      <TextAreaField label="Customer's complaint" name="complaint" placeholder="e.g. Brakes squeal when stopping" error={fieldErrors.complaint} />
      <MechanicSelect mechanics={mechanics} error={fieldErrors.mechanicId} />

      {error && (
        <Alert>
          {error}
          {openJobId && (
            <>
              {" "}
              <Link href={`/app/work-orders/${openJobId}`} className="font-medium underline">
                Open it →
              </Link>
            </>
          )}
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        <LinkButton href="/app/work-orders" variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" loading={submitting || saving}>
          Check in
        </Button>
      </div>
    </form>
  );
}
