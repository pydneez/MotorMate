import Link from "next/link";
import { redirect } from "next/navigation";
import type { MechanicOption, VehicleDetail } from "@motormate/types";
import { Card, PageHeader } from "@/components/ui";
import { CheckInForm } from "@/components/work-orders/check-in-form";
import { WalkInForm } from "@/components/work-orders/walk-in-form";
import { requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: { vehicleId?: string; mode?: string } };

/** Check in a known vehicle, or (?mode=walk-in) register customer + vehicle and check in at once. */
export default async function CheckInPage({ searchParams }: Props) {
  const { user } = await requireSession();
  if (user.role !== "ADMIN" && user.role !== "ADVISOR") redirect("/app/work-orders");

  const walkIn = searchParams.mode === "walk-in";
  const [mechanics, vehicle] = await Promise.all([
    serverGet<MechanicOption[]>("/work-orders/mechanics"),
    !walkIn && searchParams.vehicleId ? serverGet<VehicleDetail>(`/vehicles/${searchParams.vehicleId}`) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={walkIn ? "Walk-in check-in" : "Check in vehicle"}
        back={{ href: "/app/work-orders", label: "Work orders" }}
        subtitle={
          walkIn ? (
            <Link href="/app/work-orders/new" className="text-blue-700 hover:underline">
              ← Car already in the system? Search for it instead
            </Link>
          ) : (
            <Link href="/app/work-orders/new?mode=walk-in" className="text-blue-700 hover:underline">
              New customer or car? Register and check in on one page →
            </Link>
          )
        }
      />
      <Card className="p-6">{walkIn ? <WalkInForm mechanics={mechanics} /> : <CheckInForm initialVehicle={vehicle} mechanics={mechanics} />}</Card>
    </div>
  );
}
