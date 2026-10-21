import Link from "next/link";
import { getServerSession } from "next-auth";
import { Calendar, Car } from "lucide-react";
import type { AuthUser, InventorySummary, Paginated, VehicleSummary, WorkOrderCounts } from "@motormate/types";
import { authOptions } from "@/auth";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
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
function StatCard({ label, note, value, href, alert }: { label: string; note: string; value?: number; href?: string; alert?: boolean }) {
  const body = (
    <>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${value === undefined ? "text-slate-300" : alert ? "text-red-700" : "text-slate-900"}`}>
        {value ?? "—"}
      </p>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
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

type CardSource = "lowStock" | "openWorkOrders" | "myJobs" | "awaitingParts" | "qualityCheck";
type CardSpec = { label: string; note: string; source?: CardSource };

const LOW_STOCK_CARD: CardSpec = { label: "Low-stock items", note: "At or below reorder level", source: "lowStock" };
const OPEN_WORK_ORDERS_CARD: CardSpec = { label: "Open work orders", note: "Checked in, not yet completed", source: "openWorkOrders" };

const STAFF_CARDS: Record<Exclude<AuthUser["role"], "CUSTOMER">, CardSpec[]> = {
  ADMIN: [
    { label: "Revenue this month", note: "Reports module" },
    OPEN_WORK_ORDERS_CARD,
    LOW_STOCK_CARD,
    { label: "Active staff", note: "Staff module" },
  ],
  ADVISOR: [OPEN_WORK_ORDERS_CARD, { label: "Today's appointments", note: "Appointments module" }, LOW_STOCK_CARD],
  MECHANIC: [
    { label: "My assigned jobs", note: "Open jobs assigned to you", source: "myJobs" },
    { label: "Awaiting parts", note: "All mechanics", source: "awaitingParts" },
    { label: "In quality check", note: "All mechanics", source: "qualityCheck" },
  ],
};

/** The number, link and highlight for a card whose module is built. */
function cardData(
  source: CardSource,
  inventory: InventorySummary | null,
  workOrders: WorkOrderCounts | null,
): { value: number; href: string; alert?: boolean } | null {
  switch (source) {
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
  const vehicles = await serverGet<Paginated<VehicleSummary>>("/vehicles?pageSize=6");
  return (
    <div className="space-y-6">
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

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  const { user } = session;
  const isStaff = user.role === "ADMIN" || user.role === "ADVISOR";
  const [inventory, workOrders] = await Promise.all([
    isStaff ? serverGet<InventorySummary>("/inventory/summary") : Promise.resolve(null),
    user.role !== "CUSTOMER" ? serverGet<WorkOrderCounts>("/work-orders/counts") : Promise.resolve(null),
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STAFF_CARDS[user.role].map(({ source, ...card }) => {
              const data = source ? cardData(source, inventory, workOrders) : null;
              return <StatCard key={card.label} {...card} {...(data ?? {})} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
