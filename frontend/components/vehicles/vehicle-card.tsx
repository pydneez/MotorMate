import Link from "next/link";
import { Car } from "lucide-react";
import type { VehicleSummary } from "@motormate/types";
import { formatDate, formatKm, shortVin } from "@/lib/format";

/** Vehicle card used on the customer page, the customer's "My vehicles" and the dashboard. */
export function VehicleCard({ vehicle }: { vehicle: VehicleSummary }) {
  return (
    <Link
      href={`/app/vehicles/${vehicle.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow"
    >
      <div className="flex items-start gap-3">
        <Car className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            {vehicle.make} {vehicle.model} {vehicle.year}
            {vehicle.color && <span className="font-normal text-slate-500"> · {vehicle.color}</span>}
          </p>
          <p className="text-sm text-slate-700">
            {vehicle.plate} <span className="text-slate-500">{vehicle.province}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {formatKm(vehicle.mileage)} · VIN {shortVin(vehicle.vin)}
          </p>
          <p className="text-xs text-slate-500">
            {vehicle.lastVisitAt ? `Last visit: ${formatDate(vehicle.lastVisitAt)}` : "No visits yet"}
          </p>
        </div>
      </div>
    </Link>
  );
}
