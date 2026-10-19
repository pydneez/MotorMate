import Link from "next/link";
import { Pencil } from "lucide-react";
import type { VehicleDetail } from "@motormate/types";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { MileageCorrection } from "@/components/vehicles/mileage-correction";
import { ServiceHistory } from "@/components/vehicles/service-history";
import { formatKm, formatThaiPhone, fullName } from "@/lib/format";
import { requireSession, serverGet } from "@/lib/server";

export default async function VehiclePage({ params }: { params: { id: string } }) {
  const { user } = await requireSession();
  const vehicle = await serverGet<VehicleDetail>(`/vehicles/${params.id}`);
  const isCustomer = user.role === "CUSTOMER";
  const canEdit = user.role === "ADMIN" || user.role === "ADVISOR";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={
          <>
            {vehicle.make} {vehicle.model} {vehicle.year}
            {vehicle.color && <span className="font-normal text-slate-500"> · {vehicle.color}</span>}
          </>
        }
        back={{ href: "/app/vehicles", label: isCustomer ? "My vehicles" : "Vehicles" }}
        subtitle={
          <>
            {vehicle.plate} {vehicle.province} · VIN {vehicle.vin}
          </>
        }
        actions={
          <>
            {canEdit && (
              <LinkButton href={`/app/vehicles/${vehicle.id}/edit`} variant="secondary">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </LinkButton>
            )}
            {user.role === "ADMIN" && <MileageCorrection vehicleId={vehicle.id} currentMileage={vehicle.mileage} />}
          </>
        }
      />

      <Card className="mb-6 grid gap-4 p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Owner</p>
          {isCustomer ? (
            <p className="mt-1">{fullName(vehicle.owner)}</p>
          ) : (
            <Link href={`/app/customers/${vehicle.owner.id}`} className="mt-1 inline-block text-blue-700 hover:underline">
              {fullName(vehicle.owner)} ({formatThaiPhone(vehicle.owner.phone)}) →
            </Link>
          )}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Current mileage</p>
          <p className="mt-1 text-lg font-semibold">{formatKm(vehicle.mileage)}</p>
        </div>
      </Card>

      <h2 className="mb-4 text-base font-semibold">Service history</h2>
      <ServiceHistory history={vehicle.history} linkWorkOrders={!isCustomer} />
    </div>
  );
}
