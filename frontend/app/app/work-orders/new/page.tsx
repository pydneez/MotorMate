import Link from "next/link";
import { redirect } from "next/navigation";
import { APPOINTMENT_VIEWS, bangkokParts, type AppointmentSummary, type MechanicOption, type VehicleDetail } from "@motormate/types";
import { BookedServices } from "@/components/appointments/booked-services";
import { Alert, Card, PageHeader } from "@/components/ui";
import { CheckInForm } from "@/components/work-orders/check-in-form";
import { WalkInForm } from "@/components/work-orders/walk-in-form";
import { formatAppointmentTime } from "@/lib/format";
import { requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: { vehicleId?: string; mode?: string; appointment?: string; phone?: string; from?: string } };

/**
 * Check in a known vehicle, a booked appointment (?appointment=…, vehicle and complaint
 * prefilled), or (?mode=walk-in) register customer + vehicle and check in at once.
 */
export default async function CheckInPage({ searchParams }: Props) {
  const { user } = await requireSession();
  if (user.role !== "ADMIN" && user.role !== "ADVISOR") redirect("/app/work-orders");

  const walkIn = searchParams.mode === "walk-in";
  const appointment = !walkIn && searchParams.appointment
    ? await serverGet<AppointmentSummary>(`/appointments/${searchParams.appointment}`)
    : null;
  const vehicleId = appointment?.vehicle.id ?? (walkIn ? undefined : searchParams.vehicleId);
  const [mechanics, vehicle] = await Promise.all([
    serverGet<MechanicOption[]>("/work-orders/mechanics"),
    vehicleId ? serverGet<VehicleDetail>(`/vehicles/${vehicleId}`) : Promise.resolve(null),
  ]);

  if (appointment) {
    // Back to the tab the advisor came from; a booking for another day gets a warning, since
    // checking in the wrong one is easy from a long list.
    const from = (APPOINTMENT_VIEWS as readonly string[]).includes(searchParams.from ?? "") ? searchParams.from : "today";
    const bookedDay = bangkokParts(appointment.scheduledAt).date;
    const notToday = bookedDay !== bangkokParts(new Date()).date;
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Check in appointment"
          back={{ href: `/app/appointments?view=${from}`, label: "Appointments" }}
          subtitle={`Booked for ${formatAppointmentTime(appointment.scheduledAt)}`}
        />
        {notToday && (
          <div className="mb-4">
            <Alert tone="warning">
              This booking is for {formatAppointmentTime(appointment.scheduledAt)}, not today. Check it&apos;s the right customer
              and car before checking in.
            </Alert>
          </div>
        )}
        {appointment.services.length > 0 && (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <p>Booked services — they become the job&apos;s first labour lines, at the price quoted:</p>
            <BookedServices services={appointment.services} />
          </div>
        )}
        <Card className="p-6">
          <CheckInForm initialVehicle={vehicle} mechanics={mechanics} appointment={{ id: appointment.id, reason: appointment.reason }} />
        </Card>
      </div>
    );
  }

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
      <Card className="p-6">{walkIn ? <WalkInForm mechanics={mechanics} initialPhone={searchParams.phone} /> :<CheckInForm initialVehicle={vehicle} mechanics={mechanics} />}</Card>
    </div>
  );
}
