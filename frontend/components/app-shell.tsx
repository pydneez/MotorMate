"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  BarChart3,
  Calendar,
  Car,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  UserCircle,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { AuthUser } from "@motormate/types";
import { navFor, ROLE_LABELS } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = {
  "": LayoutDashboard,
  "work-orders": ClipboardList,
  customers: Users,
  vehicles: Car,
  appointments: Calendar,
  inventory: Package,
  invoices: Receipt,
  reports: BarChart3,
  staff: UserCog,
};

function NavLinks({ user, onNavigate }: { user: AuthUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1 px-3 py-4">
      {navFor(user.role).map(({ slug, label }) => {
        const href = slug ? `/app/${slug}` : "/app";
        const active = slug ? pathname.startsWith(href) : pathname === "/app";
        const Icon = ICONS[slug] ?? LayoutDashboard;
        return (
          <Link
            key={slug}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
              active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    >
      <LogOut className="h-4 w-4" aria-hidden />
      Sign out
    </button>
  );
}

function UserMenu({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const initials = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-slate-900">
            {user.firstName} {user.lastName}
          </span>
          <span className="block text-xs leading-tight text-slate-500">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-slate-900">{user.email}</p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
          <Link
            href="/app/profile"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <UserCircle className="h-4 w-4" aria-hidden />
            Profile
          </Link>
          <SignOutButton />
        </div>
      )}
    </div>
  );
}

export function AppShell({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex print:hidden">
        <div className="flex h-16 items-center border-b border-slate-200 px-6 text-lg font-bold">🔧 MotorMate</div>
        <NavLinks user={user} />
        <div className="border-t border-slate-200 p-3">
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile slide-over */}
      {drawerOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
              <span className="text-lg font-bold">🔧 MotorMate</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="rounded-md p-2 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks user={user} onNavigate={() => setDrawerOpen(false)} />
            <div className="border-t border-slate-200 p-3">
              <SignOutButton />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 print:hidden">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="rounded-md p-2 hover:bg-slate-100 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-lg font-bold md:hidden">MotorMate</span>
          </div>
          <UserMenu user={user} />
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
