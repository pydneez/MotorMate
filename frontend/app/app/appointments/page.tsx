import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import {
  APPOINTMENT_VIEWS,
  formatWorkOrderNumber,
  type AppointmentCounts,
  type AppointmentSummary,
  type AppointmentView,
  type Paginated,
  type Role,
} from "@motormate/types";
import { AppointmentActions } from "@/components/appointments/appointment-actions";
import { AppointmentStatusBadge } from "@/components/appointments/appointment-status-badge";
import { AppointmentTabs } from "@/components/appointments/appointment-tabs";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatAppointmentTime, formatThaiPhone } from "@/lib/format";
import { queryString, requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

/** Staff: every appointment, by tab. Customers: their own upcoming and past visits. */
export default async function AppointmentsPage({ searchParams }: Props) {
  const { user } = await requireSession();
  return user.role === "CUSTOMER" ? <CustomerAppointments role={user.role} /> : <StaffAppointments role={user.role} searchParams={searchParams} />;
}

async function StaffAppointments({ role, searchParams }: Props & { role: Role }) {
  const requested = typeof searchParams.view === "string" ? searchParams.view : "";
  const view: AppointmentView = (APPOINTMENT_VIEWS as readonly string[]).includes(requested) ? (requested as AppointmentView) : "upcoming";
  const [data, counts] = await Promise.all([
    serverGet<Paginated<AppointmentSummary>>(`/appointments${queryString({ view, q: searchParams.q, page: searchParams.page })}`),
    serverGet<AppointmentCounts>("/appointments/counts"),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Appointments"
        actions={
          <LinkButton href="/app/appointments/new">
            <CalendarPlus className="h-4 w-4" aria-hidden /> New appointment
          </LinkButton>
        }
      />
      <div className="flex flex-wrap items-center gap-4">
        <AppointmentTabs view={view} counts={counts} />
        <SearchBox placeholder="Search customer, plate or reason…" />
      </div>

      <Card className="mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No appointments here">{view === "requests" ? "No requests waiting for confirmation." : "Try another tab or search."}</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((appointment) => (
              <li key={appointment.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] md:items-start xl:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                <div>
                  <p className="font-medium">{formatAppointmentTime(appointment.scheduledAt)}</p>
                  <AppointmentStatusBadge status={appointment.status} />
                </div>
                <div>
                  <Link href={`/app/customers/${appointment.customer.id}`} className="font-medium text-blue-700 hover:underline">
                    {appointment.customer.name}
                  </Link>
                  <p className="whitespace-nowrap text-xs text-slate-500">{formatThaiPhone(appointment.customer.phone)}</p>
                </div>
                <div>
                  <Link href={`/app/vehicles/${appointment.vehicle.id}`} className="hover:underline">
                    {appointment.vehicle.plate} <span className="text-slate-500">{appointment.vehicle.province}</span>
                  </Link>
                  <p className="text-xs text-slate-500">
                    {appointment.vehicle.make} {appointment.vehicle.model}
                  </p>
                </div>
                <div className="text-slate-700">
                  {appointment.reason}
                  {appointment.workOrder && (
                    <Link href={`/app/work-orders/${appointment.workOrder.id}`} className="ml-1 text-xs text-blue-700 hover:underline">
                      {formatWorkOrderNumber(appointment.workOrder.number)} →
                    </Link>
                  )}
                </div>
                {/* Own row until the screen is wide enough for a fifth column. */}
                <div className="md:col-span-4 xl:col-span-1">
                  <AppointmentActions appointment={appointment} role={role} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination data={data} basePath="/app/appointments" searchParams={searchParams} />
    </div>
  );
}

async function CustomerAppointments({ role }: { role: Role }) {
  const [upcoming, past] = await Promise.all([
    serverGet<Paginated<AppointmentSummary>>("/appointments?view=upcoming&pageSize=20"),
    serverGet<Paginated<AppointmentSummary>>("/appointments?view=past&pageSize=10"),
  ]);

  const row = (appointment: AppointmentSummary) => (
    <li key={appointment.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
      <div>
        <p className="font-medium">{formatAppointmentTime(appointment.scheduledAt)}</p>
        <p className="text-slate-600">
          {appointment.vehicle.make} {appointment.vehicle.model} · {appointment.vehicle.plate} · {appointment.reason}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <AppointmentStatusBadge status={appointment.status} scheduledAt={appointment.scheduledAt} forCustomer />
        <AppointmentActions appointment={appointment} role={role} />
      </div>
    </li>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="My appointments"
        actions={
          <LinkButton href="/app/appointments/new">
            <CalendarPlus className="h-4 w-4" aria-hidden /> Book an appointment
          </LinkButton>
        }
      />
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Upcoming</h2>
        <Card className="overflow-hidden">
          {upcoming.items.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Nothing booked">Book a visit and we&apos;ll confirm the time with you.</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">{upcoming.items.map(row)}</ul>
          )}
        </Card>
      </section>
      {past.items.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Past</h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-slate-100">{past.items.map(row)}</ul>
          </Card>
        </section>
      )}
    </div>
  );
}
