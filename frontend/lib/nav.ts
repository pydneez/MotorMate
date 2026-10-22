import type { Role } from "@motormate/types";

export type NavItem = {
  /** URL segment under /app ("" is the dashboard). */
  slug: string;
  label: string;
  roles: readonly Role[];
};

const STAFF: readonly Role[] = ["ADMIN", "ADVISOR"];
const ALL: readonly Role[] = ["ADMIN", "ADVISOR", "MECHANIC", "CUSTOMER"];

/**
 * Single source of truth for the sidebar AND the middleware's page-level role check.
 * The backend still enforces roles on every API route — this only controls navigation.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { slug: "", label: "Dashboard", roles: ALL },
  { slug: "work-orders", label: "Work Orders", roles: ["ADMIN", "ADVISOR", "MECHANIC"] },
  { slug: "customers", label: "Customers", roles: STAFF },
  { slug: "vehicles", label: "Vehicles", roles: ALL },
  { slug: "appointments", label: "Appointments", roles: ["ADMIN", "ADVISOR", "CUSTOMER"] },
  { slug: "reminders", label: "Reminders", roles: STAFF },
  { slug: "inventory", label: "Inventory", roles: ["ADMIN", "ADVISOR", "MECHANIC"] },
  { slug: "invoices", label: "Invoices", roles: ["ADMIN", "ADVISOR", "CUSTOMER"] },
  { slug: "reports", label: "Reports", roles: ["ADMIN"] },
  { slug: "staff", label: "Staff", roles: ["ADMIN"] },
];

/** Customers see some sections under friendlier names. */
const CUSTOMER_LABELS: Record<string, string> = {
  "": "My Garage",
  vehicles: "My Vehicles",
  appointments: "Appointments",
  invoices: "My Invoices",
};

export function navFor(role: Role): { slug: string; label: string }[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role)).map((item) => ({
    slug: item.slug,
    label: role === "CUSTOMER" ? (CUSTOMER_LABELS[item.slug] ?? item.label) : item.label,
  }));
}

export function findNavItem(slug: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.slug === slug);
}

/** Whether `role` may open /app/<slug>. Unknown slugs are allowed through to 404. */
export function canAccess(role: Role, slug: string): boolean {
  const item = findNavItem(slug);
  return !item || item.roles.includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  ADVISOR: "Service Advisor",
  MECHANIC: "Mechanic",
  CUSTOMER: "Customer",
};
