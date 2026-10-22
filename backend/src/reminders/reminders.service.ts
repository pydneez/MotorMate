import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  bangkokDateTime,
  bangkokParts,
  estimateMileage,
  normalizePlate,
  REMINDER_FOLLOW_UP_DAYS,
  reminderState,
  shopDayEnded,
  type AuthUser,
  type CloseDayJobSummary,
  type CloseRecommendationSchema,
  type DailyJobsSummary,
  type ListQuery,
  type MorningJobSummary,
  type MyReminder,
  type NotificationEntry,
  type NotificationType,
  type Paginated,
  type ReminderCounts,
  type ReminderItem,
  type ReminderListQuery,
  type ReminderState,
} from "@motormate/types";
import type { z } from "zod";
import { writeAudit } from "../common/utils/audit";
import { pageArgs, paginated, searchTokens } from "../common/utils/pagination";
import { appointmentEmail, serviceReminderEmail } from "../notifications/email-text";
import { NotifierService } from "../notifications/notifier.service";
import { PrismaService } from "../prisma/prisma.service";

export type CloseRecommendationData = z.output<typeof CloseRecommendationSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_ORDER: Record<ReminderState, number> = { overdue: 0, due: 1, upcoming: 2 };

const openInclude = {
  vehicle: {
    select: {
      id: true,
      plate: true,
      province: true,
      make: true,
      model: true,
      mileage: true,
      createdAt: true,
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, notifyConfirmed: true } },
      // Odometer readings for the mileage estimate.
      workOrders: { where: { status: { not: "CANCELLED" } }, select: { mileageIn: true, createdAt: true } },
    },
  },
  workOrder: { select: { id: true, number: true } },
  notifications: { where: { type: "SERVICE_REMINDER", status: "SENT" }, select: { createdAt: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.ServiceRecommendationInclude;

type OpenRow = Prisma.ServiceRecommendationGetPayload<{ include: typeof openInclude }>;
type Evaluated = { row: OpenRow; state: ReminderState; estimate: ReturnType<typeof estimateMileage>; daysUntil: number };

/**
 * Service reminders and the two daily jobs (run by EventBridge Scheduler → Lambda →
 * POST /jobs/…, or "Run daily jobs now"):
 * - morning (09:00): service reminder emails (first one when due, one follow-up 30 days
 *   later) and the day-before email for tomorrow's confirmed appointments;
 * - close the day (18:30): appointments left on a shop day that has ended — confirmed but
 *   never checked in → no-show, never confirmed → cancelled.
 * Which items are due is reminderState() / estimateMileage() from packages/types.
 */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: NotifierService,
  ) {}

  // ── Staff views ────────────────────────────────────────────────────────────

  async list(query: ReminderListQuery): Promise<Paginated<ReminderItem>> {
    const view = query.view ?? "due";
    const where: Prisma.ServiceRecommendationWhereInput = {
      AND: searchTokens(query.q).map((token) => {
        const or: Prisma.ServiceRecommendationWhereInput[] = [
          { description: { contains: token, mode: "insensitive" } },
          { vehicle: { customer: { firstName: { contains: token, mode: "insensitive" } } } },
          { vehicle: { customer: { lastName: { contains: token, mode: "insensitive" } } } },
          { vehicle: { make: { contains: token, mode: "insensitive" } } },
          { vehicle: { model: { contains: token, mode: "insensitive" } } },
        ];
        const plate = normalizePlate(token);
        if (plate) or.push({ vehicle: { plateNormalized: { contains: plate } } });
        return { OR: or };
      }),
    };
    // Due-ness depends on the mileage estimate, which is computed here, so filter and page in memory.
    const items = (await this.evaluateOpen(where)).filter((item) => item.state === view);
    const start = (query.page - 1) * query.pageSize;
    return paginated(items.slice(start, start + query.pageSize).map((item) => this.toItem(item)), items.length, query);
  }

  async counts(): Promise<ReminderCounts> {
    const items = await this.evaluateOpen({});
    return { due: items.filter((i) => i.state === "due").length, overdue: items.filter((i) => i.state === "overdue").length };
  }

  /** A customer's own open items (any state), soonest first. */
  async mine(user: AuthUser): Promise<MyReminder[]> {
    const items = await this.evaluateOpen({ vehicle: { customerId: user.customerId ?? "__none__" } });
    return items.map(({ row, state, estimate }) => ({
      id: row.id,
      description: row.description,
      dueMileage: row.dueMileage,
      dueDate: row.dueDate?.toISOString() ?? null,
      state,
      estimatedMileage: estimate.km,
      vehicle: { id: row.vehicle.id, plate: row.vehicle.plate, make: row.vehicle.make, model: row.vehicle.model },
    }));
  }

  /** Staff close an item: done (performed) or dismissed (no longer applies). */
  async close(actor: AuthUser, id: string, input: CloseRecommendationData): Promise<void> {
    const rec = await this.prisma.serviceRecommendation.findUnique({ where: { id }, select: { status: true } });
    if (!rec) throw new NotFoundException("Recommendation not found");
    if (rec.status !== "OPEN" && rec.status !== "REMINDED") throw new BadRequestException("This recommendation is already closed");
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.serviceRecommendation.updateMany({ where: { id, status: rec.status }, data: { status: input.status } });
      if (count === 0) throw new ConflictException("This recommendation was just changed by someone else. Refresh and try again.");
      await writeAudit(tx, {
        actorId: actor.id,
        action: input.status === "DONE" ? "recommendation.done" : "recommendation.dismissed",
        entity: "ServiceRecommendation",
        entityId: id,
        changes: { status: { from: rec.status, to: input.status } },
      });
    });
  }

  /**
   * Every email sent or failed, newest first. A service reminder covering several items has
   * one row per item (same customer, type and time), shown once.
   */
  async history(query: ListQuery): Promise<Paginated<NotificationEntry>> {
    const oneEmail = ["customerId", "type", "createdAt"] satisfies Prisma.NotificationLogScalarFieldEnum[];
    const [rows, emails] = await this.prisma.$transaction([
      this.prisma.notificationLog.findMany({
        distinct: oneEmail,
        orderBy: { createdAt: "desc" },
        include: { customer: { select: { id: true, firstName: true, lastName: true } } },
        ...pageArgs(query),
      }),
      this.prisma.notificationLog.groupBy({ by: oneEmail, orderBy: { createdAt: "desc" } }),
    ]);
    const total = emails.length;
    return paginated(
      rows.map((row) => ({
        id: row.id,
        type: row.type as NotificationType,
        status: row.status,
        subject: row.subject,
        recipientEmail: row.recipientEmail,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        customer: row.customer ? { id: row.customer.id, name: `${row.customer.firstName} ${row.customer.lastName}` } : null,
      })),
      total,
      query,
    );
  }

  // ── Daily jobs ─────────────────────────────────────────────────────────────

  /** "Run daily jobs now": both, which is safe at any time (close-day only touches ended days). */
  async runAll(now: Date = new Date()): Promise<DailyJobsSummary> {
    return { morning: await this.runMorning(now), closeDay: await this.runCloseDay(now) };
  }

  async runMorning(now: Date = new Date()): Promise<MorningJobSummary> {
    const summary: MorningJobSummary = {
      subscriptions: await this.notifier.syncAll(),
      reminders: 0,
      followUps: 0,
      appointmentReminders: 0,
      notConfirmed: 0,
      noEmail: 0,
      failed: 0,
    };
    const count = (result: string) => {
      if (result === "notConfirmed") summary.notConfirmed++;
      else if (result === "noEmail") summary.noEmail++;
      else if (result === "failed") summary.failed++;
    };

    // Service reminders: one email per customer, listing everything due for them.
    const followUpBefore = now.getTime() - REMINDER_FOLLOW_UP_DAYS * DAY_MS;
    const groups = new Map<string, { first: Evaluated[]; followUp: Evaluated[] }>();
    for (const item of await this.evaluateOpen({}, now)) {
      const { row, state } = item;
      const sent = row.notifications;
      const isFirst = row.status === "OPEN" && state !== "upcoming";
      const isFollowUp = row.status === "REMINDED" && sent.length === 1 && sent[0].createdAt.getTime() <= followUpBefore;
      if (!isFirst && !isFollowUp) continue;
      const group = groups.get(row.vehicle.customer.id) ?? { first: [], followUp: [] };
      (isFirst ? group.first : group.followUp).push(item);
      groups.set(row.vehicle.customer.id, group);
    }
    for (const { first, followUp } of groups.values()) {
      const items = [...first, ...followUp];
      const customer = items[0].row.vehicle.customer;
      const { subject, body } = serviceReminderEmail(
        customer.firstName,
        items.map(({ row, estimate }) => ({
          vehicle: row.vehicle,
          description: row.description,
          dueMileage: row.dueMileage,
          dueDate: row.dueDate,
          estimatedKm: estimate.km,
        })),
        first.length === 0,
      );
      const result = await this.notifier.send({
        type: "SERVICE_REMINDER",
        customer,
        subject,
        body,
        recommendationIds: items.map(({ row }) => row.id),
      });
      if (result === "sent") {
        await this.prisma.serviceRecommendation.updateMany({
          where: { id: { in: first.map(({ row }) => row.id) }, status: "OPEN" },
          data: { status: "REMINDED" },
        });
        summary.reminders += first.length;
        summary.followUps += followUp.length;
      } else count(result);
    }

    // Tomorrow's confirmed appointments, once each.
    const tomorrow = bangkokDateTime(bangkokParts(new Date(now.getTime() + DAY_MS)).date, "00:00")!;
    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: "CONFIRMED",
        scheduledAt: { gte: tomorrow, lt: new Date(tomorrow.getTime() + DAY_MS) },
        // Once each: sent, or recorded as not sent (no email / not confirmed).
        notifications: { none: { type: "APPOINTMENT_REMINDER", status: { in: ["SENT", "SKIPPED"] } } },
      },
      include: {
        customer: { select: { id: true, firstName: true, email: true, notifyConfirmed: true } },
        vehicle: { select: { make: true, model: true, plate: true } },
      },
    });
    for (const appointment of appointments) {
      const { subject, body } = appointmentEmail("reminder", appointment.customer.firstName, appointment);
      const result = await this.notifier.send({
        type: "APPOINTMENT_REMINDER",
        customer: appointment.customer,
        subject,
        body,
        appointmentId: appointment.id,
        recordSkipped: true,
      });
      if (result === "sent") summary.appointmentReminders++;
      else count(result);
    }
    return summary;
  }

  async runCloseDay(now: Date = new Date()): Promise<CloseDayJobSummary> {
    const summary: CloseDayJobSummary = { noShows: 0, expired: 0 };
    const candidates = await this.prisma.appointment.findMany({
      where: { status: { in: ["CONFIRMED", "REQUESTED"] }, scheduledAt: { lt: now } },
      select: { id: true, status: true, scheduledAt: true },
    });
    for (const appointment of candidates) {
      if (!shopDayEnded(appointment.scheduledAt, now)) continue;
      const noShow = appointment.status === "CONFIRMED";
      const to = noShow ? "NO_SHOW" : "CANCELLED";
      const moved = await this.prisma.$transaction(async (tx) => {
        // Conditional: a check-in or cancel that happened meanwhile wins.
        const { count } = await tx.appointment.updateMany({ where: { id: appointment.id, status: appointment.status }, data: { status: to } });
        if (count === 0) return false;
        await writeAudit(tx, {
          actorId: null,
          action: noShow ? "appointment.noShow" : "appointment.expired",
          entity: "Appointment",
          entityId: appointment.id,
          changes: {
            status: { from: appointment.status, to },
            by: "system",
            reason: noShow ? "Not checked in by the end of the day" : "Not confirmed in time",
          },
        });
        return true;
      });
      if (moved) summary[noShow ? "noShows" : "expired"]++;
    }
    return summary;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Open/reminded recommendations with their state today, most pressing first. */
  private async evaluateOpen(where: Prisma.ServiceRecommendationWhereInput, now: Date = new Date()): Promise<Evaluated[]> {
    const rows = await this.prisma.serviceRecommendation.findMany({
      where: { ...where, status: { in: ["OPEN", "REMINDED"] } },
      include: openInclude,
    });
    return rows
      .map((row) => {
        const readings = row.vehicle.workOrders.length
          ? row.vehicle.workOrders.map((wo) => ({ date: wo.createdAt, km: wo.mileageIn }))
          : [{ date: row.vehicle.createdAt, km: row.vehicle.mileage }];
        const estimate = estimateMileage(readings, now);
        const byDate = row.dueDate ? (row.dueDate.getTime() - now.getTime()) / DAY_MS : Infinity;
        const byMileage = row.dueMileage !== null ? (row.dueMileage - estimate.km) / estimate.kmPerDay : Infinity;
        return { row, estimate, state: reminderState(row, estimate.km, now), daysUntil: Math.min(byDate, byMileage) };
      })
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.daysUntil - b.daysUntil);
  }

  private toItem({ row, state, estimate }: Evaluated): ReminderItem {
    const { customer, ...vehicle } = row.vehicle;
    const sent = row.notifications;
    return {
      id: row.id,
      description: row.description,
      dueMileage: row.dueMileage,
      dueDate: row.dueDate?.toISOString() ?? null,
      status: row.status as "OPEN" | "REMINDED",
      state,
      estimatedMileage: estimate.km,
      kmPerDay: estimate.kmPerDay,
      reminders: { count: sent.length, lastSentAt: sent.at(-1)?.createdAt.toISOString() ?? null },
      customer: {
        id: customer.id,
        name: `${customer.firstName} ${customer.lastName}`,
        phone: customer.phone,
        email: customer.email,
        notify: this.notifier.notifyStatus(customer),
      },
      vehicle: { id: vehicle.id, plate: vehicle.plate, province: vehicle.province, make: vehicle.make, model: vehicle.model },
      workOrder: row.workOrder,
    };
  }
}
