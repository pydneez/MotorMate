import Link from "next/link";
import type { Paginated, VehicleSummary } from "@motormate/types";
import { BookingForm } from "@/components/appointments/booking-form";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireSession, serverGet } from "@/lib/server";

/** Customers request a visit for one of their cars; staff book any car (phone bookings). */
export default async function NewAppointmentPage() {
  const { user } = await requireSession();
  const isCustomer = user.role === "CUSTOMER";
  const vehicles = isCustomer ? (await serverGet<Paginated<VehicleSummary>>("/vehicles?pageSize=100")).items : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={isCustomer ? "Book an appointment" : "New appointment"}
        back={{ href: "/app/appointments", label: isCustomer ? "My appointments" : "Appointments" }}
        subtitle={isCustomer ? undefined : "For phone bookings — it's confirmed straight away."}
      />
      <Card className="p-6">
        {vehicles && vehicles.length === 0 ? (
          <EmptyState title="Add your vehicle first">
            <Link href="/app/vehicles/new" className="font-medium text-blue-700 hover:underline">
              Add my vehicle →
            </Link>
          </EmptyState>
        ) : (
          <BookingForm ownVehicles={vehicles} />
        )}
      </Card>
    </div>
  );
}
