import { redirect } from "next/navigation";
import type { VehicleDetail } from "@motormate/types";
import { Card, PageHeader } from "@/components/ui";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { requireSession, serverGet } from "@/lib/server";

export default async function EditVehiclePage({ params }: { params: { id: string } }) {
  const { user } = await requireSession();
  if (user.role !== "ADMIN" && user.role !== "ADVISOR") redirect(`/app/vehicles/${params.id}`);

  const vehicle = await serverGet<VehicleDetail>(`/vehicles/${params.id}`);
  const title = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Edit ${title}`} back={{ href: `/app/vehicles/${vehicle.id}`, label: title }} />
      <Card className="p-6">
        <VehicleForm vehicle={vehicle} cancelHref={`/app/vehicles/${vehicle.id}`} />
      </Card>
    </div>
  );
}
