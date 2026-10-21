import { redirect } from "next/navigation";
import type { MechanicOption, VehicleDetail } from "@motormate/types";
import { Card, PageHeader } from "@/components/ui";
import { CheckInForm } from "@/components/work-orders/check-in-form";
import { requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: { vehicleId?: string } };

export default async function CheckInPage({ searchParams }: Props) {
  const { user } = await requireSession();
  if (user.role !== "ADMIN" && user.role !== "ADVISOR") redirect("/app/work-orders");

  const [mechanics, vehicle] = await Promise.all([
    serverGet<MechanicOption[]>("/work-orders/mechanics"),
    searchParams.vehicleId ? serverGet<VehicleDetail>(`/vehicles/${searchParams.vehicleId}`) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Check in vehicle" back={{ href: "/app/work-orders", label: "Work orders" }} />
      <Card className="p-6">
        <CheckInForm initialVehicle={vehicle} mechanics={mechanics} />
      </Card>
    </div>
  );
}
