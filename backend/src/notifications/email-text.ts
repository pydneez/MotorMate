import { SHOP } from "@motormate/types";

/**
 * The customer emails, as plain text (SNS email can't do HTML, so no bold or links — the
 * body is UTF-8, so Thai plates and emoji are fine). Subjects stay ASCII — SNS requires
 * it — so plates only appear in the body, and every subject starts with [MOTORMATE].
 */

const TIME_ZONE = "Asia/Bangkok";

/** The site's address, for links: the frontend origin the API already allows (CORS). */
export function siteUrl(): string {
  return (process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:3000").replace(/\/$/, "");
}

const km = (value: number) => `${value.toLocaleString("en-US")} km`;

/** 15 Jan 2027 — due dates are calendar dates stored at UTC midnight. */
function dueDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

/** Fri 23 Oct 2026, 10:00 (Bangkok). */
function appointmentTime(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** Every subject starts with this, so customers can spot and filter the shop's emails. */
export const SUBJECT_PREFIX = "[MOTORMATE]";
const subjectLine = (text: string) => `${SUBJECT_PREFIX} ${text}`;

const signature = () => `${SHOP.name} 🔧\n${SHOP.address.join(", ")}\nTel: ${SHOP.phone}\nHours: ${SHOP.hours.label}`;

export type ReminderLine = {
  vehicle: { make: string; model: string; plate: string; province: string };
  description: string;
  dueMileage: number | null;
  dueDate: Date | string | null;
  estimatedKm: number;
};

/** One email per customer per run: every due item, grouped by vehicle. */
export function serviceReminderEmail(firstName: string, lines: ReminderLine[], followUp: boolean): { subject: string; body: string } {
  const vehicles = [...new Set(lines.map((line) => `${line.vehicle.make} ${line.vehicle.model}`))];
  const subject = subjectLine(
    followUp ? `Reminder: your ${vehicles.join(" and ")} is still due for service` : `Service coming up for your ${vehicles.join(" and ")}`,
  );

  const byVehicle = new Map<string, ReminderLine[]>();
  for (const line of lines) {
    const key = `${line.vehicle.make} ${line.vehicle.model} (${line.vehicle.plate} ${line.vehicle.province})`;
    byVehicle.set(key, [...(byVehicle.get(key) ?? []), line]);
  }
  const sections = [...byVehicle].map(([vehicle, items]) => {
    const rows = items.map((item) => {
      const when = [
        item.dueMileage !== null ? `at ${km(item.dueMileage)} (you're at about ${km(item.estimatedKm)})` : null,
        item.dueDate !== null ? `by ${dueDate(item.dueDate)}` : null,
      ].filter(Boolean);
      return `  - ${item.description}: ${when.join(", or ")}`;
    });
    return `${vehicle}\n${rows.join("\n")}`;
  });

  const body = [
    `Hello ${firstName},`,
    followUp
      ? "A quick reminder — this service we recommended is still due:"
      : "At your last visit we recommended the following service, and it's coming up:",
    sections.join("\n\n"),
    `Book a visit online: ${siteUrl()}/app/appointments/new\nor call us on ${SHOP.phone}.`,
    signature(),
  ].join("\n\n");
  return { subject, body };
}

export type AppointmentEmailKind = "confirmed" | "rescheduled" | "cancelled" | "reminder";

export function appointmentEmail(
  kind: AppointmentEmailKind,
  firstName: string,
  appointment: { scheduledAt: Date | string; reason: string; vehicle: { make: string; model: string; plate: string } },
): { subject: string; body: string } {
  const when = appointmentTime(appointment.scheduledAt);
  const car = `${appointment.vehicle.make} ${appointment.vehicle.model}`;
  const subjects: Record<AppointmentEmailKind, string> = {
    confirmed: `Appointment confirmed: ${when}`,
    rescheduled: `Appointment moved to ${when}`,
    // Every subject names the time, so Gmail doesn't thread different appointments together.
    cancelled: `Appointment cancelled: ${when}`,
    reminder: `See you tomorrow: ${when}`,
  };
  const intros: Record<AppointmentEmailKind, string> = {
    confirmed: "Your appointment is confirmed:",
    rescheduled: "We've moved your appointment to a new time:",
    cancelled: "Your appointment has been cancelled:",
    reminder: "A reminder that your appointment is tomorrow:",
  };
  const details = `  ${when}\n  ${car} (${appointment.vehicle.plate})\n  ${appointment.reason}`;
  const outro =
    kind === "cancelled"
      ? `To book another time: ${siteUrl()}/app/appointments/new or call ${SHOP.phone}.`
      : `Need to change it? Visit ${siteUrl()}/app/appointments, or call ${SHOP.phone} if it's less than 2 hours away.`;
  return { subject: subjectLine(subjects[kind]), body: [`Hello ${firstName},`, intros[kind], details, outro, signature()].join("\n\n") };
}
