import { z } from "zod";
import { ListQuerySchema } from "./common";
import type { Role } from "./role";
import { SHOP } from "./shop";

/**
 * "Lite" appointments: a customer requests a time, an advisor confirms it, and checking in
 * turns it into a work order. No slots or capacity — the shop just sees the requests.
 * These rules are shared by the API and the buttons, like allowedNextStatuses() for jobs.
 */

export const APPOINTMENT_STATUSES = ["REQUESTED", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export const AppointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};

/** Statuses an appointment can still be changed, cancelled or checked in from. */
export const UPCOMING_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ["REQUESTED", "CONFIRMED"];

export const APPOINTMENT_SLOT_MINUTES = 30;
/** Bookings (and customers' own changes) need at least this much notice. */
export const BOOKING_LEAD_MINUTES = 120;
export const BOOKING_MAX_DAYS = 60;
/** A customer can't cancel or move an appointment less than this long before it. */
export const CUSTOMER_CHANGE_CUTOFF_MINUTES = 120;

// ── Bangkok time ─────────────────────────────────────────────────────────────
// Thailand has no daylight saving, so a fixed +07:00 is exact.

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "2026-10-23" + "10:00" in Bangkok → the instant, or null if the date or time doesn't exist. */
export function bangkokDateTime(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  if (hour > 23 || minute > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - BANGKOK_OFFSET_MS;
  const check = new Date(utc + BANGKOK_OFFSET_MS);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return new Date(utc);
}

/** The Bangkok calendar date, time and weekday (0 = Sunday) of an instant. */
export function bangkokParts(value: Date | string): { date: string; time: string; weekday: number } {
  const local = new Date(new Date(value).getTime() + BANGKOK_OFFSET_MS);
  const iso = local.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: local.getUTCDay() };
}

/** The bookable times of day: "08:00", "08:30", … up to the last half hour before closing. */
export function appointmentSlots(): string[] {
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const slots: string[] = [];
  for (let m = toMinutes(SHOP.hours.open); m < toMinutes(SHOP.hours.close); m += APPOINTMENT_SLOT_MINUTES) {
    slots.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return slots;
}

/** Why a booking time isn't allowed, or null if it is. */
export function bookingTimeError(at: Date, now: Date = new Date()): string | null {
  const { time, weekday } = bangkokParts(at);
  if (!(SHOP.hours.weekdays as readonly number[]).includes(weekday)) return `The shop is open ${SHOP.hours.label}. Choose another day.`;
  if (!appointmentSlots().includes(time)) {
    const slots = appointmentSlots();
    return `Choose a time between ${slots[0]} and ${slots[slots.length - 1]}, on the hour or half hour`;
  }
  if (at.getTime() < now.getTime() + BOOKING_LEAD_MINUTES * 60_000) return `Book at least ${BOOKING_LEAD_MINUTES / 60} hours ahead`;
  if (at.getTime() > now.getTime() + BOOKING_MAX_DAYS * 24 * 60 * 60_000) return `Book at most ${BOOKING_MAX_DAYS} days ahead`;
  return null;
}

// ── Who may do what ──────────────────────────────────────────────────────────

export type AppointmentAction = "confirm" | "reschedule" | "cancel" | "checkIn" | "noShow";

/**
 * Actions on one appointment for a role, at `now`. Staff can do everything that fits the
 * status; a customer (their own appointment — scoping is the API's job) can cancel it, and
 * move it while it's still a request, but only until 2 hours before; after that they call
 * the shop.
 */
export function appointmentActions(
  appointment: { status: AppointmentStatus; scheduledAt: Date | string },
  role: Role,
  now: Date = new Date(),
): AppointmentAction[] {
  const upcoming = UPCOMING_APPOINTMENT_STATUSES.includes(appointment.status);
  const at = new Date(appointment.scheduledAt).getTime();

  if (role === "ADMIN" || role === "ADVISOR") {
    const actions: AppointmentAction[] = [];
    if (appointment.status === "REQUESTED") actions.push("confirm");
    if (upcoming) actions.push("reschedule", "checkIn", "cancel");
    if (appointment.status === "CONFIRMED" && at < now.getTime()) actions.push("noShow");
    return actions;
  }
  if (role === "CUSTOMER" && upcoming && at - now.getTime() >= CUSTOMER_CHANGE_CUTOFF_MINUTES * 60_000) {
    return appointment.status === "REQUESTED" ? ["reschedule", "cancel"] : ["cancel"];
  }
  return [];
}

// ── Requests ─────────────────────────────────────────────────────────────────

const timeFields = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time"),
};

function checkBookingTime(value: { date: string; time: string }, ctx: z.RefinementCtx) {
  const at = bangkokDateTime(value.date, value.time);
  if (!at) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["date"], message: "That date doesn't exist" });
    return;
  }
  const error = bookingTimeError(at);
  if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["time"], message: error });
}

/** Customers book for their own vehicle (→ Requested); staff for anyone's (→ Confirmed). */
export const CreateAppointmentSchema = z
  .object({
    vehicleId: z.string().min(1, "Choose a vehicle"),
    ...timeFields,
    reason: z.string().trim().min(1, "Tell us what the visit is for").max(500),
  })
  .superRefine(checkBookingTime);
export type CreateAppointmentInput = z.input<typeof CreateAppointmentSchema>;

export const RescheduleAppointmentSchema = z.object(timeFields).superRefine(checkBookingTime);
export type RescheduleAppointmentInput = z.input<typeof RescheduleAppointmentSchema>;

/** The optional reason is kept in the audit log. */
export const CancelAppointmentSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || undefined),
});
export type CancelAppointmentInput = z.input<typeof CancelAppointmentSchema>;

export const APPOINTMENT_VIEWS = ["requests", "today", "upcoming", "past"] as const;
export type AppointmentView = (typeof APPOINTMENT_VIEWS)[number];

export const AppointmentListQuerySchema = ListQuerySchema.extend({
  view: z.enum(APPOINTMENT_VIEWS).optional(),
});
export type AppointmentListQuery = z.output<typeof AppointmentListQuerySchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export type AppointmentSummary = {
  id: string;
  scheduledAt: string;
  reason: string;
  status: AppointmentStatus;
  customer: { id: string; name: string; phone: string };
  vehicle: { id: string; plate: string; province: string; make: string; model: string; year: number };
  /** The work order it was checked in as. */
  workOrder: { id: string; number: number } | null;
  createdAt: string;
};

/** Staff dashboard: appointments today (not cancelled) and requests waiting for confirmation. */
export type AppointmentCounts = { today: number; requests: number };
