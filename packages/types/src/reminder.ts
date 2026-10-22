import { z } from "zod";
import { bangkokDateTime, bangkokParts } from "./appointment";
import { ListQuerySchema } from "./common";
import { SHOP } from "./shop";

/**
 * Service reminders: when a recommendation ("Brake pads check at 80,000 km", "Coolant flush
 * by 15 Jan") is coming up, the customer gets an email, and staff see it on the Reminders
 * page. Shared by the API, the daily job and the pages.
 */

/** Date-based items are due this many days before their date. */
export const REMINDER_DATE_LEAD_DAYS = 7;
/** Mileage-based items are due when the estimated odometer is this close. */
export const REMINDER_MILEAGE_LEAD_KM = 1000;
/** Assumed when a vehicle's visits don't give a usable rate (~15,000 km a year). */
export const DEFAULT_KM_PER_DAY = 40;
/** A rate needs readings at least this far apart, or one visit's noise dominates. */
const MIN_RATE_SPAN_DAYS = 30;
/** One follow-up, this long after the first reminder, if the item is still open. */
export const REMINDER_FOLLOW_UP_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MileageEstimate = { km: number; kmPerDay: number; fromHistory: boolean };

/**
 * Today's odometer, estimated from the vehicle's readings (visits): the latest reading plus
 * the average km/day between the first and last ones — or DEFAULT_KM_PER_DAY when there's
 * only one reading, they're too close together, or the odometer didn't move.
 */
export function estimateMileage(readings: { date: Date | string; km: number }[], now: Date = new Date()): MileageEstimate {
  const sorted = readings
    .map((r) => ({ time: new Date(r.date).getTime(), km: r.km }))
    .sort((a, b) => a.time - b.time);
  const last = sorted[sorted.length - 1];
  if (!last) return { km: 0, kmPerDay: DEFAULT_KM_PER_DAY, fromHistory: false };

  const first = sorted[0];
  const spanDays = (last.time - first.time) / DAY_MS;
  const fromHistory = spanDays >= MIN_RATE_SPAN_DAYS && last.km > first.km;
  const kmPerDay = fromHistory ? (last.km - first.km) / spanDays : DEFAULT_KM_PER_DAY;
  const daysSince = Math.max(0, (now.getTime() - last.time) / DAY_MS);
  return { km: Math.round(last.km + kmPerDay * daysSince), kmPerDay: Math.round(kmPerDay * 10) / 10, fromHistory };
}

export const REMINDER_STATES = ["overdue", "due", "upcoming"] as const;
export type ReminderState = (typeof REMINDER_STATES)[number];

/**
 * Where an open recommendation stands today. Due dates are calendar dates (stored at UTC
 * midnight), compared with today in Bangkok.
 */
export function reminderState(
  item: { dueMileage: number | null; dueDate: Date | string | null },
  estimatedKm: number,
  now: Date = new Date(),
): ReminderState {
  const today = bangkokParts(now).date;
  const dueBy = bangkokParts(new Date(now.getTime() + REMINDER_DATE_LEAD_DAYS * DAY_MS)).date;
  const date = item.dueDate === null ? null : new Date(item.dueDate).toISOString().slice(0, 10);

  if ((date !== null && date < today) || (item.dueMileage !== null && estimatedKm >= item.dueMileage)) return "overdue";
  if ((date !== null && date <= dueBy) || (item.dueMileage !== null && estimatedKm >= item.dueMileage - REMINDER_MILEAGE_LEAD_KM)) {
    return "due";
  }
  return "upcoming";
}

/**
 * Whether the shop day an appointment was on has ended (closing time, Bangkok). The
 * end-of-day job marks what's left of those days: no-shows and unconfirmed requests.
 */
export function shopDayEnded(scheduledAt: Date | string, now: Date = new Date()): boolean {
  const close = bangkokDateTime(bangkokParts(scheduledAt).date, SHOP.hours.close)!;
  return now.getTime() >= close.getTime();
}

// ── Requests ─────────────────────────────────────────────────────────────────

export const REMINDER_VIEWS = ["due", "overdue", "upcoming"] as const;
export type ReminderView = (typeof REMINDER_VIEWS)[number];

export const ReminderListQuerySchema = ListQuerySchema.extend({
  view: z.enum(REMINDER_VIEWS).optional(),
});
export type ReminderListQuery = z.output<typeof ReminderListQuerySchema>;

/** Staff close an item: the work was done, or it no longer applies. */
export const CloseRecommendationSchema = z.object({
  status: z.enum(["DONE", "DISMISSED"]),
});
export type CloseRecommendationInput = z.input<typeof CloseRecommendationSchema>;

// ── Responses ────────────────────────────────────────────────────────────────

/** A customer's email notifications: SNS subscription confirmed, waiting, no email — or local logging. */
export type NotifyStatus = "confirmed" | "pending" | "none" | "local";

export type ReminderItem = {
  id: string;
  description: string;
  dueMileage: number | null;
  dueDate: string | null;
  status: "OPEN" | "REMINDED";
  state: ReminderState;
  estimatedMileage: number;
  kmPerDay: number;
  reminders: { count: number; lastSentAt: string | null };
  customer: { id: string; name: string; phone: string; email: string | null; notify: NotifyStatus };
  vehicle: { id: string; plate: string; province: string; make: string; model: string };
  workOrder: { id: string; number: number } | null;
};

/** The customer's own view: what's coming up for their cars. */
export type MyReminder = Pick<ReminderItem, "id" | "description" | "dueMileage" | "dueDate" | "state" | "estimatedMileage"> & {
  vehicle: { id: string; plate: string; make: string; model: string };
};

export type ReminderCounts = { due: number; overdue: number };

export const NOTIFICATION_TYPE_LABEL = {
  SERVICE_REMINDER: "Service reminder",
  APPOINTMENT_CONFIRMED: "Appointment confirmed",
  APPOINTMENT_RESCHEDULED: "Appointment moved",
  APPOINTMENT_CANCELLED: "Appointment cancelled",
  APPOINTMENT_REMINDER: "Appointment tomorrow",
  INVOICE_ISSUED: "Invoice issued",
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPE_LABEL;

export type NotificationEntry = {
  id: string;
  type: NotificationType;
  /** SKIPPED: not sent (no email, or email not confirmed) — `error` says which. */
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  subject: string | null;
  recipientEmail: string | null;
  error: string | null;
  createdAt: string;
  customer: { id: string; name: string } | null;
};

/** What a run of the daily jobs did — shown after "Run daily jobs now", logged on AWS. */
export type MorningJobSummary = {
  subscriptions: number;
  reminders: number;
  followUps: number;
  appointmentReminders: number;
  notConfirmed: number;
  noEmail: number;
  failed: number;
};
export type CloseDayJobSummary = { noShows: number; expired: number };
export type DailyJobsSummary = { morning: MorningJobSummary; closeDay: CloseDayJobSummary };
