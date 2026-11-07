import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Calendar, Car, Wrench } from "lucide-react";
import { reportPresetRange } from "@motormate/types";
import type {
  AppointmentCounts,
  AppointmentSummary,
  AuthUser,
  InventorySummary,
  MyReminder,
  Paginated,
  ReminderCounts,
  RevenueTotals,
  VehicleSummary,
  WorkOrderCounts,
} from "@motormate/types";
import { authOptions } from "@/auth";
import { AppointmentStatusBadge } from "@/components/appointments/appointment-status-badge";
import { ReminderStateBadge, dueText } from "@/components/reminders/reminder-badges";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
import { api } from "@/lib/api";
import { formatAppointmentTime, formatTHB } from "@/lib/format";
import { serverGet } from "@/lib/server";

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", timeZone: "Asia/Bangkok" }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Dashboard stat. Cards whose module isn't built yet show "—" and the module name; cards with
 * a value link to the page that explains it.
 */
function StatCard({
  label,
  note,
  value,
  href,
  alert,
  noteAlert,
}: {
  label: string;
  note: string;
  value?: number | string;
  href?: string;
  alert?: boolean;
  /** Amber note, e.g. "฿7,200.00 unpaid (3)". */
  noteAlert?: boolean;
}) {
  const body = (
    <>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${value === undefined ? "text-slate-300" : alert ? "text-red-700" : "text-slate-900"}`}>
        {value ?? "—"}
      </p>
      <p className={`mt-1 text-xs ${noteAlert ? "font-medium text-amber-700" : "text-slate-400"}`}>{note}</p>
    </>
  );
  const className = "block rounded-lg border border-slate-200 bg-white p-5 shadow-sm";
  return href ? (
    <Link href={href} className={`${className} transition hover:border-blue-300 hover:shadow`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

type CardSource =
  | "lowStock"
  | "openWorkOrders"
  | "myJobs"
  | "awaitingParts"
  | "qualityCheck"
  | "todayAppointments"
  | "appointmentRequests"
  | "dueForService"
  | "revenueThisMonth";
type CardSpec = { label: string; note: string; source?: CardSource };

const LOW_STOCK_CARD: CardSpec = { label: "Low-stock items", note: "At or below reorder level", source: "lowStock" };
const OPEN_WORK_ORDERS_CARD: CardSpec = { label: "Open work orders", note: "Checked in, not yet completed", source: "openWorkOrders" };
const DUE_FOR_SERVICE_CARD: CardSpec = { label: "Due for service", note: "Due or overdue recommendations", source: "dueForService" };
const TODAY_APPOINTMENTS_CARD: CardSpec = { label: "Today's appointments", note: "Booked for today", source: "todayAppointments" };
const REQUESTS_CARD: CardSpec = { label: "Requests to confirm", note: "Customers waiting for an answer", source: "appointmentRequests" };

const STAFF_CARDS: Record<Exclude<AuthUser["role"], "CUSTOMER" | "PLATFORM_ADMIN">, CardSpec[]> = {
  // Two rows of three; the full reports are on /app/reports.
  ADMIN: [
    OPEN_WORK_ORDERS_CARD,
    TODAY_APPOINTMENTS_CARD,
    REQUESTS_CARD,
    { label: "Revenue this month", note: "Invoiced, incl. VAT", source: "revenueThisMonth" },
    LOW_STOCK_CARD,
    DUE_FOR_SERVICE_CARD,
  ],
  ADVISOR: [OPEN_WORK_ORDERS_CARD, TODAY_APPOINTMENTS_CARD, REQUESTS_CARD, LOW_STOCK_CARD, DUE_FOR_SERVICE_CARD],
  MECHANIC: [
    { label: "My assigned jobs", note: "Open jobs assigned to you", source: "myJobs" },
    { label: "Awaiting parts", note: "All mechanics", source: "awaitingParts" },
    { label: "In quality check", note: "All mechanics", source: "qualityCheck" },
  ],
};

/** Grid columns by number of cards: admin 6 = two rows of three, advisor 5 = one row on wide screens. */
const STAFF_CARD_COLUMNS: Record<number, string> = {
  3: "lg:grid-cols-3",
  5: "lg:grid-cols-3 xl:grid-cols-5",
  6: "lg:grid-cols-3",
};

/** The value, link and highlight for a card; null (shown as "—") when its data didn't load. */
function cardData(
  source: CardSource,
  inventory: InventorySummary | null,
  workOrders: WorkOrderCounts | null,
  appointments: AppointmentCounts | null,
  reminders: ReminderCounts | null,
  revenue: RevenueTotals | null,
): { value: number | string; href: string; alert?: boolean; note?: string; noteAlert?: boolean } | null {
  switch (source) {
    case "revenueThisMonth":
      return (
        revenue && {
          value: formatTHB(revenue.total),
          href: "/app/reports",
          note: revenue.unpaid.count > 0 ? `${formatTHB(revenue.unpaid.total)} unpaid (${revenue.unpaid.count})` : "All paid",
          noteAlert: revenue.unpaid.count > 0,
        }
      );
    case "dueForService":
      return (
        reminders && {
          value: reminders.due + reminders.overdue,
          alert: reminders.overdue > 0,
          href: reminders.overdue > 0 ? "/app/reminders?view=overdue" : "/app/reminders",
        }
      );
    case "todayAppointments":
      return appointments && { value: appointments.today, href: "/app/appointments?view=today" };
    case "appointmentRequests":
      return appointments && { value: appointments.requests, alert: appointments.requests > 0, href: "/app/appointments?view=requests" };
    case "lowStock":
      return inventory && { value: inventory.lowStockCount, alert: inventory.lowStockCount > 0, href: "/app/inventory?lowStock=true" };
    case "openWorkOrders":
      return workOrders && { value: workOrders.open, href: "/app/work-orders" };
    case "myJobs":
      return workOrders && { value: workOrders.mine, href: "/app/work-orders" };
    case "awaitingParts":
      return workOrders && { value: workOrders.awaitingParts, href: "/app/work-orders?status=AWAITING_PARTS&mechanic=all" };
    case "qualityCheck":
      return workOrders && { value: workOrders.qualityCheck, href: "/app/work-orders?status=QUALITY_CHECK&mechanic=all" };
  }
}

async function CustomerDashboard() {
  const [vehicles, upcoming, reminders] = await Promise.all([
    serverGet<Paginated<VehicleSummary>>("/vehicles?pageSize=6"),
    serverGet<Paginated<AppointmentSummary>>("/appointments?view=upcoming&pageSize=1"),
    serverGet<MyReminder[]>("/reminders/mine"),
  ]);
  const next = upcoming.items[0];
  // What the shop recommended that's due soon or overdue; later items stay on the vehicle page.
  const dueSoon = reminders.filter((item) => item.state !== "upcoming");
  return (
    <div className="space-y-6">
      {next && (
        <Link
          href="/app/appointments"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm transition hover:border-blue-300"
        >
          <span className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-blue-600" aria-hidden />
            <span>
              <span className="font-semibold">Next appointment:</span> {formatAppointmentTime(next.scheduledAt)} ·{" "}
              {next.vehicle.make} {next.vehicle.model} · {next.reason}
            </span>
          </span>
          <AppointmentStatusBadge status={next.status} scheduledAt={next.scheduledAt} forCustomer />
        </Link>
      )}
      {dueSoon.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <h2 className="flex items-center gap-2 font-semibold">
            <Wrench className="h-4 w-4 text-amber-700" aria-hidden /> Service coming up
          </h2>
          <ul className="mt-2 space-y-1.5">
            {dueSoon.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ReminderStateBadge state={item.state} />
                <span>
                  <span className="font-medium">{item.description}</span> — {item.vehicle.make} {item.vehicle.model} ({item.vehicle.plate}),
                  due {dueText(item)}
                </span>
              </li>
            ))}
          </ul>
          {!next && (
            <Link href="/app/appointments/new" className="mt-3 inline-block font-medium text-blue-700 hover:underline">
              Book a visit →
            </Link>
          )}
        </section>
      )}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">My vehicles</h2>
          <Link href="/app/vehicles" className="text-sm font-medium text-blue-600 hover:underline">
            View all →
          </Link>
        </div>
        {vehicles.items.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-md border border-dashed border-slate-300 py-10 text-center">
            <Car className="h-8 w-8 text-slate-300" aria-hidden />
            <p className="mt-2 text-sm text-slate-500">No vehicles yet.</p>
            <Link href="/app/vehicles/new" className="mt-2 text-sm font-medium text-blue-600 hover:underline">
              Add my vehicle →
            </Link>
            {/* Deliberately generic: never reveals whether a matching shop record exists. */}
            <p className="mt-4 max-w-sm text-xs text-slate-500">
              Been to the shop before? Ask the service advisor to link your service history to this account.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vehicles.items.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        )}
      </section>
      <Link
        href="/app/appointments"
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
      >
        <Calendar className="h-4 w-4" aria-hidden />
        Book an appointment
      </Link>
    </div>
  );
}

/** This month's invoiced totals for the admin card; null (card shows "—") if the call fails. */
function revenueThisMonth(token: string): Promise<RevenueTotals | null> {
  const { from, to } = reportPresetRange("this-month");
  return api<RevenueTotals>(`/reports/revenue?from=${from}&to=${to}`, { token }).catch(() => null);
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  const { user } = session;
  // The platform admin has no shop dashboard (the middleware sends them there too).
  if (user.role === "PLATFORM_ADMIN") redirect("/app/platform");
  const isStaff = user.role === "ADMIN" || user.role === "ADVISOR";
  const [inventory, workOrders, appointments, reminders, revenue] = await Promise.all([
    isStaff ? serverGet<InventorySummary>("/inventory/summary") : Promise.resolve(null),
    user.role !== "CUSTOMER" ? serverGet<WorkOrderCounts>("/work-orders/counts") : Promise.resolve(null),
    isStaff ? serverGet<AppointmentCounts>("/appointments/counts") : Promise.resolve(null),
    isStaff ? serverGet<ReminderCounts>("/reminders/counts") : Promise.resolve(null),
    user.role === "ADMIN" ? revenueThisMonth(session.accessToken) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        {greeting()}, {user.firstName}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {user.role === "CUSTOMER" ? "Welcome to your garage." : "Here's what's happening at the shop."}
      </p>
      <div className="mt-6">
        {user.role === "CUSTOMER" ? (
          <CustomerDashboard />
        ) : (
          <div className={`grid gap-4 sm:grid-cols-2 ${STAFF_CARD_COLUMNS[STAFF_CARDS[user.role].length] ?? "lg:grid-cols-4"}`}>
            {STAFF_CARDS[user.role].map(({ source, ...card }) => {
              const data = source ? cardData(source, inventory, workOrders, appointments, reminders, revenue) : null;
              return <StatCard key={card.label} {...card} {...(data ?? {})} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}