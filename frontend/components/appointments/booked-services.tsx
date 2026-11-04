import type { AppointmentSummary } from "@motormate/types";
import { formatTHB } from "@/lib/format";

/**
 * The booking's note, or null when it's only the services' names (filled in by the API when the
 * customer picked services and typed nothing) — those already show as BookedServices.
 */
export function visitNote(appointment: Pick<AppointmentSummary, "reason" | "services">): string | null {
  return appointment.services.length > 0 && appointment.reason === appointment.services.map((service) => service.name).join(", ")
    ? null
    : appointment.reason;
}

/** The price-list services picked when booking, at the price quoted then (excl. VAT). */
export function BookedServices({ services }: { services: AppointmentSummary["services"] }) {
  if (services.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1.5">
      {services.map((service) => (
        <li key={service.id} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800">
          {service.name} · {formatTHB(service.price)}
        </li>
      ))}
    </ul>
  );
}
