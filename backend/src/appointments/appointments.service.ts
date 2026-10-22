import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  APPOINTMENT_STATUS_LABEL,
  appointmentActions,
  bangkokDateTime,
  bangkokParts,
  CUSTOMER_CHANGE_CUTOFF_MINUTES,
  normalizePlate,
  SHOP,
  UPCOMING_APPOINTMENT_STATUSES,
  type AppointmentAction,
  type AppointmentCounts,
  type AppointmentListQuery,
  type AppointmentStatus,
  type AppointmentSummary,
  type AuthUser,
  type CancelAppointmentSchema,
  type CreateAppointmentSchema,
  type Paginated,
  type RescheduleAppointmentSchema,
} from "@motormate/types";
import type { z } from "zod";
import { writeAudit } from "../common/utils/audit";
import { pageArgs, paginated, searchTokens } from "../common/utils/pagination";
import { appointmentEmail, type AppointmentEmailKind } from "../notifications/email-text";
import { NotifierService } from "../notifications/notifier.service";
import { PrismaService } from "../prisma/prisma.service";
import { appointmentInclude, toAppointmentSummary } from "./appointment.mapper";

export type CreateAppointmentData = z.output<typeof CreateAppointmentSchema>;
export type RescheduleAppointmentData = z.output<typeof RescheduleAppointmentSchema>;
export type CancelAppointmentData = z.output<typeof CancelAppointmentSchema>;

const UPCOMING = [...UPCOMING_APPOINTMENT_STATUSES];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Lite" appointments. Customers book for their own vehicles (→ Requested) and see only
 * their own (others → 404); staff book for anyone (→ Confirmed), confirm, reschedule,
 * cancel and mark no-shows. Who may do what is appointmentActions() from packages/types.
 * Checking in happens in WorkOrdersService.create (it links the appointment to the job),
 * and the job's completion or cancellation carries over to the appointment.
 * When staff confirm, book, move or cancel one, the customer gets an email (after the change
 * is saved — a failed email never undoes it); customers' own changes send nothing.
 */
@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger("Appointments");

  constructor(
    private readonly prisma: PrismaService,
    // Optional so unit tests can build the service without it.
    @Optional() private readonly notifier?: NotifierService,
  ) {}

  async list(user: AuthUser, query: AppointmentListQuery): Promise<Paginated<AppointmentSummary>> {
    const { start, end } = this.today();
    const now = new Date();
    // Staff also see bookings whose time passed unresolved under "upcoming", so they deal
    // with them; for a customer those are simply past.
    const isCustomer = user.role === "CUSTOMER";
    const view: Record<NonNullable<AppointmentListQuery["view"]>, { where: Prisma.AppointmentWhereInput; order: Prisma.SortOrder }> = {
      requests: { where: { status: "REQUESTED" }, order: "asc" },
      today: { where: { scheduledAt: { gte: start, lt: end }, status: { notIn: ["CANCELLED"] } }, order: "asc" },
      upcoming: {
        where: { status: { in: UPCOMING }, ...(isCustomer ? { scheduledAt: { gte: now } } : {}) },
        order: "asc",
      },
      past: {
        where: isCustomer
          ? { OR: [{ status: { notIn: UPCOMING } }, { scheduledAt: { lt: now } }] }
          : { status: { notIn: UPCOMING } },
        order: "desc",
      },
    };
    const { where: viewWhere, order } = view[query.view ?? "upcoming"];
    const where: Prisma.AppointmentWhereInput = {
      ...this.scope(user),
      ...viewWhere,
      AND: searchTokens(query.q).map((token) => {
        const or: Prisma.AppointmentWhereInput[] = [
          { customer: { firstName: { contains: token, mode: "insensitive" } } },
          { customer: { lastName: { contains: token, mode: "insensitive" } } },
          { vehicle: { make: { contains: token, mode: "insensitive" } } },
          { vehicle: { model: { contains: token, mode: "insensitive" } } },
          { reason: { contains: token, mode: "insensitive" } },
        ];
        const plate = normalizePlate(token);
        if (plate) or.push({ vehicle: { plateNormalized: { contains: plate } } });
        return { OR: or };
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({ where, include: appointmentInclude, orderBy: { scheduledAt: order }, ...pageArgs(query) }),
      this.prisma.appointment.count({ where }),
    ]);
    return paginated(rows.map(toAppointmentSummary), total, query);
  }

  async counts(): Promise<AppointmentCounts> {
    const { start, end } = this.today();
    const [today, requests] = await this.prisma.$transaction([
      this.prisma.appointment.count({ where: { scheduledAt: { gte: start, lt: end }, status: { in: [...UPCOMING, "CHECKED_IN", "COMPLETED"] } } }),
      this.prisma.appointment.count({ where: { status: "REQUESTED" } }),
    ]);
    return { today, requests };
  }

  async findOne(user: AuthUser, id: string): Promise<AppointmentSummary> {
    const row = await this.prisma.appointment.findFirst({ where: { id, ...this.scope(user) }, include: appointmentInclude });
    if (!row) throw new NotFoundException("Appointment not found");
    return toAppointmentSummary(row);
  }

  async create(user: AuthUser, input: CreateAppointmentData): Promise<AppointmentSummary> {
    const isCustomer = user.role === "CUSTOMER";
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true, customerId: true } });
    // A customer can only book for their own vehicles; anyone else's doesn't exist for them.
    if (!vehicle || (isCustomer && vehicle.customerId !== user.customerId)) throw new NotFoundException("Vehicle not found");

    const pending = await this.prisma.appointment.findFirst({
      where: { vehicleId: vehicle.id, status: { in: UPCOMING } },
      select: { scheduledAt: true },
    });
    if (pending) {
      const { date, time } = bangkokParts(pending.scheduledAt);
      throw new ConflictException(`This vehicle already has an appointment on ${date} at ${time}. Change or cancel that one instead.`);
    }

    const status: AppointmentStatus = isCustomer ? "REQUESTED" : "CONFIRMED";
    const id = await this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          customerId: vehicle.customerId,
          vehicleId: vehicle.id,
          scheduledAt: bangkokDateTime(input.date, input.time)!,
          reason: input.reason,
          status,
          createdById: user.id,
        },
      });
      await writeAudit(tx, {
        actorId: user.id,
        action: "appointment.created",
        entity: "Appointment",
        entityId: appointment.id,
        changes: { vehicleId: vehicle.id, scheduledAt: appointment.scheduledAt.toISOString(), status },
      });
      return appointment.id;
    });
    // A staff (phone) booking is confirmed straight away.
    if (!isCustomer) await this.notify(id, "confirmed");
    return this.findOne(user, id);
  }

  async reschedule(user: AuthUser, id: string, input: RescheduleAppointmentData): Promise<AppointmentSummary> {
    const current = await this.findForAction(user, id, "reschedule");
    const scheduledAt = bangkokDateTime(input.date, input.time)!;
    await this.prisma.$transaction(async (tx) => {
      // Conditional on the status we checked, so a concurrent check-in or cancel wins.
      const { count } = await tx.appointment.updateMany({ where: { id, status: current.status }, data: { scheduledAt } });
      if (count === 0) throw new ConflictException("This appointment was just changed by someone else. Refresh and try again.");
      await writeAudit(tx, {
        actorId: user.id,
        action: "appointment.rescheduled",
        entity: "Appointment",
        entityId: id,
        changes: { scheduledAt: { from: current.scheduledAt, to: scheduledAt.toISOString() } },
      });
    });
    if (user.role !== "CUSTOMER") await this.notify(id, "rescheduled");
    return this.findOne(user, id);
  }

  confirm(user: AuthUser, id: string): Promise<AppointmentSummary> {
    return this.move(user, id, "confirm", "CONFIRMED");
  }

  cancel(user: AuthUser, id: string, input: CancelAppointmentData): Promise<AppointmentSummary> {
    return this.move(user, id, "cancel", "CANCELLED", input.reason);
  }

  noShow(user: AuthUser, id: string): Promise<AppointmentSummary> {
    return this.move(user, id, "noShow", "NO_SHOW");
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async move(user: AuthUser, id: string, action: AppointmentAction, to: AppointmentStatus, reason?: string) {
    const current = await this.findForAction(user, id, action);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.appointment.updateMany({ where: { id, status: current.status }, data: { status: to } });
      if (count === 0) throw new ConflictException("This appointment was just changed by someone else. Refresh and try again.");
      await writeAudit(tx, {
        actorId: user.id,
        action: `appointment.${action === "noShow" ? "noShow" : to === "CONFIRMED" ? "confirmed" : "cancelled"}`,
        entity: "Appointment",
        entityId: id,
        changes: { status: { from: current.status, to }, ...(reason ? { reason } : {}) },
      });
    });
    if (user.role !== "CUSTOMER" && (to === "CONFIRMED" || to === "CANCELLED")) {
      await this.notify(id, to === "CONFIRMED" ? "confirmed" : "cancelled");
    }
    return this.findOne(user, id);
  }

  /** Emails the customer about a change staff made. Never throws: the change is already saved. */
  private async notify(id: string, kind: Exclude<AppointmentEmailKind, "reminder">): Promise<void> {
    if (!this.notifier) return;
    try {
      const appointment = await this.prisma.appointment.findUniqueOrThrow({
        where: { id },
        include: {
          customer: { select: { id: true, firstName: true, email: true, notifyConfirmed: true } },
          vehicle: { select: { make: true, model: true, plate: true } },
        },
      });
      const { subject, body } = appointmentEmail(kind, appointment.customer.firstName, appointment);
      const type = ({ confirmed: "APPOINTMENT_CONFIRMED", rescheduled: "APPOINTMENT_RESCHEDULED", cancelled: "APPOINTMENT_CANCELLED" } as const)[kind];
      await this.notifier.send({ type, customer: appointment.customer, subject, body, appointmentId: id, recordSkipped: true });
    } catch (error) {
      this.logger.warn(`Couldn't email the customer about appointment ${id}: ${(error as Error).message}`);
    }
  }

  /** The appointment (scoped: someone else's → 404), if `action` is allowed on it right now. */
  private async findForAction(user: AuthUser, id: string, action: AppointmentAction): Promise<AppointmentSummary> {
    const appointment = await this.findOne(user, id);
    if (appointmentActions(appointment, user.role).includes(action)) return appointment;

    const upcoming = UPCOMING_APPOINTMENT_STATUSES.includes(appointment.status);
    if (user.role === "CUSTOMER" && upcoming) {
      if (action === "reschedule" && appointment.status === "CONFIRMED") {
        throw new BadRequestException(`It's already confirmed. To move it, cancel it and book again, or call us on ${SHOP.phone}.`);
      }
      throw new BadRequestException(
        `It's less than ${CUSTOMER_CHANGE_CUTOFF_MINUTES / 60} hours away, so it can't be changed online. Please call us on ${SHOP.phone}.`,
      );
    }
    const verb = { confirm: "confirmed", reschedule: "rescheduled", cancel: "cancelled", checkIn: "checked in", noShow: "marked as a no-show" }[action];
    const when = action === "noShow" && appointment.status === "CONFIRMED" ? " before its time" : "";
    throw new BadRequestException(`A ${APPOINTMENT_STATUS_LABEL[appointment.status].toLowerCase()} appointment can't be ${verb}${when}`);
  }

  /** Today in Bangkok, as UTC instants. */
  private today(): { start: Date; end: Date } {
    const start = bangkokDateTime(bangkokParts(new Date()).date, "00:00")!;
    return { start, end: new Date(start.getTime() + DAY_MS) };
  }

  private scope(user: AuthUser): Prisma.AppointmentWhereInput {
    return user.role === "CUSTOMER" ? { customerId: user.customerId ?? "__none__" } : {};
  }
}
