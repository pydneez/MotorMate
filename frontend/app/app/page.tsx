import Link from "next/link";
import { getServerSession } from "next-auth";
import { Calendar, Car } from "lucide-react";
import type { AuthUser } from "@motormate/types";
import { authOptions } from "@/auth";

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", timeZone: "Asia/Bangkok" }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Placeholder stat card — values arrive as each module is built. */
function StatCard({ label, note }: { label: string; note: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-300">—</p>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
    </div>
  );
}

const STAFF_CARDS: Record<Exclude<AuthUser["role"], "CUSTOMER">, { label: string; note: string }[]> = {
  ADMIN: [
    { label: "Revenue this month", note: "Reports module" },
    { label: "Open work orders", note: "Work orders module" },
    { label: "Low-stock items", note: "Inventory module" },
    { label: "Active staff", note: "Staff module" },
  ],
  ADVISOR: [
    { label: "Open work orders", note: "Work orders module" },
    { label: "Today's appointments", note: "Appointments module" },
    { label: "Low-stock items", note: "Inventory module" },
  ],
  MECHANIC: [
    { label: "My assigned jobs", note: "Work orders module" },
    { label: "Awaiting parts", note: "Work orders module" },
    { label: "In quality check", note: "Work orders module" },
  ],
};

function CustomerDashboard() {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">My vehicles</h2>
          <Link href="/app/vehicles" className="text-sm font-medium text-blue-600 hover:underline">
            View all →
          </Link>
        </div>
        <div className="mt-4 flex flex-col items-center rounded-md border border-dashed border-slate-300 py-10 text-center">
          <Car className="h-8 w-8 text-slate-300" aria-hidden />
          <p className="mt-2 text-sm text-slate-500">Your vehicles and their next service will appear here.</p>
        </div>
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
            {STAFF_CARDS[user.role].map((card) => (
              <StatCard key={card.label} {...card} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
