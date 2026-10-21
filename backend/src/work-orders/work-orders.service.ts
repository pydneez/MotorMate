import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  allowedNextStatuses,
  formatWorkOrderNumber,
  isClosedStatus,
  normalizePlate,
  parseWorkOrderNumber,
  WORK_ORDER_STATUS_LABEL,
  type AddLabourSchema,
  type AddPartSchema,
  type AssignMechanicSchema,
  type AuthUser,
  type ChangeWorkOrderStatusSchema,
  type CreateWorkOrderSchema,
  type MechanicOption,
  type Paginated,
  type UpdateWorkOrderDetailsSchema,
  type WalkInCheckInSchema,
  type WorkOrderCounts,
  type WorkOrderDetail,
  type WorkOrderListQuery,
  type WorkOrderStatus,
  type WorkOrderSummary,
} from "@motormate/types";
import type { z } from "zod";
import { diffFields, writeAudit } from "../common/utils/audit";
import { pageArgs, paginated, searchTokens } from "../common/utils/pagination";
import { StockService } from "../inventory/stock.service";
import { PrismaService } from "../prisma/prisma.service";
import { toWorkOrderDetail, toWorkOrderSummary, workOrderDetailInclude, workOrderSummaryInclude } from "./work-order.mapper";

export type CreateWorkOrderData = z.output<typeof CreateWorkOrderSchema>;
export type UpdateWorkOrderDetailsData = z.output<typeof UpdateWorkOrderDetailsSchema>;
export type AssignMechanicData = z.output<typeof AssignMechanicSchema>;
export type ChangeWorkOrderStatusData = z.output<typeof ChangeWorkOrderStatusSchema>;
export type AddLabourData = z.output<typeof AddLabourSchema>;
export type AddPartData = z.output<typeof AddPartSchema>;
export type WalkInCheckInData = z.output<typeof WalkInCheckInSchema>;

const OPEN_STATUSES: WorkOrderStatus[] = ["CHECKED_IN", "DIAGNOSING", "AWAITING_PARTS", "IN_PROGRESS", "QUALITY_CHECK"];
const isStaff = (user: AuthUser) => user.role === "ADMIN" || user.role === "ADVISOR";

/** Start/end of a yyyy-mm-dd day in shop time (Bangkok, UTC+7). */
const dayStart = (day: string) => new Date(`${day}T00:00:00+07:00`);
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999+07:00`);

type WorkOrderRow = Prisma.WorkOrderGetPayload<object>;

/**
 * The work-order lifecycle (Step 4a): check-in, assignment, status moves, notes, labour and
 * parts. Completing a job and invoicing are Step 4b.
 *
 * Who may change what: advisors/admins anything; a mechanic only the jobs assigned to them,
 * and never the Completed / Cancelled moves. Nothing changes once a job is closed.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  // ── Reads ───────────────────────────────────────────────────────────────────

  async list(user: AuthUser, query: WorkOrderListQuery): Promise<Paginated<WorkOrderSummary>> {
    const where: Prisma.WorkOrderWhereInput = {
      ...this.statusFilter(query.status),
      ...this.mechanicFilter(user, query.mechanic),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: dayStart(query.from) } : {}), ...(query.to ? { lte: dayEnd(query.to) } : {}) } }
        : {}),
      AND: searchTokens(query.q).map((token) => {
        const or: Prisma.WorkOrderWhereInput[] = [
          { complaint: { contains: token, mode: "insensitive" } },
          { vehicle: { vin: { contains: token.toUpperCase() } } },
          { vehicle: { make: { contains: token, mode: "insensitive" } } },
          { vehicle: { model: { contains: token, mode: "insensitive" } } },
          { vehicle: { customer: { firstName: { contains: token, mode: "insensitive" } } } },
          { vehicle: { customer: { lastName: { contains: token, mode: "insensitive" } } } },
        ];
        const number = parseWorkOrderNumber(token);
        if (number !== null) or.push({ number });
        const plate = normalizePlate(token);
        if (plate) or.push({ vehicle: { plateNormalized: { contains: plate } } });
        return { OR: or };
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workOrder.findMany({
        where,
        include: workOrderSummaryInclude,
        orderBy: [{ createdAt: "desc" }],
        ...pageArgs(query),
      }),
      this.prisma.workOrder.count({ where }),
    ]);
    return paginated(rows.map(toWorkOrderSummary), total, query);
  }

  async counts(user: AuthUser): Promise<WorkOrderCounts> {
    const open = { status: { in: OPEN_STATUSES } };
    const [openCount, awaitingParts, qualityCheck, mine] = await Promise.all([
      this.prisma.workOrder.count({ where: open }),
      this.prisma.workOrder.count({ where: { status: "AWAITING_PARTS" } }),
      this.prisma.workOrder.count({ where: { status: "QUALITY_CHECK" } }),
      user.role === "MECHANIC" ? this.prisma.workOrder.count({ where: { ...open, mechanicId: user.id } }) : Promise.resolve(0),
    ]);
    return { open: openCount, awaitingParts, qualityCheck, mine };
  }

  /** Active mechanics with their open-job counts, for the assign dropdown. */
  async mechanics(): Promise<MechanicOption[]> {
    const mechanics = await this.prisma.user.findMany({
      where: { role: "MECHANIC", isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        _count: { select: { assignedWorkOrders: { where: { status: { in: OPEN_STATUSES } } } } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    return mechanics.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`, openJobs: m._count.assignedWorkOrders }));
  }

  async findOne(id: string): Promise<WorkOrderDetail> {
    const row = await this.prisma.workOrder.findUnique({ where: { id }, include: workOrderDetailInclude });
    if (!row) throw new NotFoundException("Work order not found");
    return toWorkOrderDetail(row);
  }

  // ── Check-in and assignment (advisor / admin) ──────────────────────────────

  async create(actor: AuthUser, input: CreateWorkOrderData): Promise<WorkOrderDetail> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    if (input.mileageIn < vehicle.mileage) {
      throw new BadRequestException({
        message: `Mileage can't be lower than the recorded ${vehicle.mileage.toLocaleString("en-US")} km`,
        errors: {
          mileageIn: [
            `Lower than the recorded ${vehicle.mileage.toLocaleString("en-US")} km. If the record is wrong, an admin can correct it on the vehicle page.`,
          ],
        },
      });
    }
    const open = await this.prisma.workOrder.findFirst({
      where: { vehicleId: vehicle.id, status: { in: OPEN_STATUSES } },
      select: { id: true, number: true },
    });
    if (open) {
      throw new ConflictException({
        message: `This vehicle is already checked in on ${formatWorkOrderNumber(open.number)}`,
        workOrderId: open.id,
      });
    }
    if (input.mechanicId) await this.assertMechanic(input.mechanicId);

    const id = await this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.create({
        data: {
          vehicleId: vehicle.id,
          mileageIn: input.mileageIn,
          complaint: input.complaint,
          mechanicId: input.mechanicId ?? null,
          createdById: actor.id,
          statusChanges: { create: { toStatus: "CHECKED_IN", changedById: actor.id } },
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "workOrder.created",
        entity: "WorkOrder",
        entityId: workOrder.id,
        changes: { vehicleId: vehicle.id, mileageIn: input.mileageIn, mechanicId: input.mechanicId ?? null },
      });
      return workOrder.id;
    });
    return this.findOne(id);
  }

  /**
   * Walk-in check-in: (new or existing) customer + new vehicle + work order, all in one
   * transaction — if anything fails (VIN or email already taken), nothing is created.
   * The new vehicle's recorded mileage is the mileage at check-in.
   */
  async walkIn(actor: AuthUser, input: WalkInCheckInData): Promise<WorkOrderDetail> {
    if (input.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
      if (!customer) throw new NotFoundException("Customer not found");
    } else if (input.email) {
      const taken = await this.prisma.customer.findFirst({ where: { email: input.email }, select: { id: true } });
      if (taken) {
        throw new ConflictException({
          message: "Another customer already uses this email",
          errors: { email: ["Another customer already uses this email. Search for them by phone instead."] },
          customerId: taken.id,
        });
      }
    }
    const vinOwner = await this.prisma.vehicle.findUnique({ where: { vin: input.vin }, select: { id: true } });
    if (vinOwner) {
      throw new ConflictException({
        message: "This VIN is already registered to another vehicle",
        errors: { vin: ["This VIN is already registered. Search for the vehicle instead."] },
        vehicleId: vinOwner.id,
      });
    }
    if (input.mechanicId) await this.assertMechanic(input.mechanicId);

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        let customerId = input.customerId;
        if (!customerId) {
          const customer = await tx.customer.create({
            data: {
              firstName: input.firstName!,
              lastName: input.lastName!,
              phone: input.phone!,
              email: input.email,
              lineId: input.lineId,
            },
          });
          customerId = customer.id;
          await writeAudit(tx, { actorId: actor.id, action: "customer.created", entity: "Customer", entityId: customer.id, changes: { via: "walk-in" } });
        }

        const vehicle = await tx.vehicle.create({
          data: {
            customerId,
            vin: input.vin,
            plate: input.plate,
            plateNormalized: normalizePlate(input.plate),
            province: input.province,
            make: input.make,
            model: input.model,
            year: input.year,
            color: input.color,
            mileage: input.mileageIn,
          },
        });
        await writeAudit(tx, {
          actorId: actor.id,
          action: "vehicle.created",
          entity: "Vehicle",
          entityId: vehicle.id,
          changes: { customerId, vin: vehicle.vin, mileage: vehicle.mileage, via: "walk-in" },
        });

        const workOrder = await tx.workOrder.create({
          data: {
            vehicleId: vehicle.id,
            mileageIn: input.mileageIn,
            complaint: input.complaint,
            mechanicId: input.mechanicId ?? null,
            createdById: actor.id,
            statusChanges: { create: { toStatus: "CHECKED_IN", changedById: actor.id } },
          },
        });
        await writeAudit(tx, {
          actorId: actor.id,
          action: "workOrder.created",
          entity: "WorkOrder",
          entityId: workOrder.id,
          changes: { vehicleId: vehicle.id, mileageIn: input.mileageIn, mechanicId: input.mechanicId ?? null, via: "walk-in" },
        });
        return workOrder.id;
      });
      return this.findOne(id);
    } catch (error) {
      // Someone registered the same VIN or email between our check and the insert.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("This VIN or email was just registered by someone else. Please search for it and try again.");
      }
      throw error;
    }
  }

  async assignMechanic(actor: AuthUser, id: string, input: AssignMechanicData): Promise<WorkOrderDetail> {
    const workOrder = await this.findOpen(id);
    if (input.mechanicId) await this.assertMechanic(input.mechanicId);
    if (workOrder.mechanicId === input.mechanicId) return this.findOne(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrder.update({ where: { id }, data: { mechanicId: input.mechanicId } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "workOrder.mechanicAssigned",
        entity: "WorkOrder",
        entityId: id,
        changes: { mechanicId: { from: workOrder.mechanicId, to: input.mechanicId } },
      });
    });
    return this.findOne(id);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async changeStatus(user: AuthUser, id: string, input: ChangeWorkOrderStatusData): Promise<WorkOrderDetail> {
    const workOrder = await this.findForWrite(user, id);
    const from = workOrder.status as WorkOrderStatus;
    const to = input.status;
    const allowed = allowedNextStatuses(from, { role: user.role, isAssignedMechanic: workOrder.mechanicId === user.id });

    if (!allowed.includes(to)) {
      const staffCould = allowedNextStatuses(from, { role: "ADVISOR", isAssignedMechanic: false }).includes(to);
      if (staffCould) throw new ForbiddenException(`Only an advisor or admin can move a job to ${WORK_ORDER_STATUS_LABEL[to]}`);
      throw new BadRequestException(`A job can't go from ${WORK_ORDER_STATUS_LABEL[from]} to ${WORK_ORDER_STATUS_LABEL[to]}`);
    }
    if (to === "COMPLETED") {
      // Step 4b: completion creates the invoice and updates the vehicle's mileage and history.
      throw new BadRequestException("Completing jobs and invoicing aren't available yet");
    }

    await this.prisma.$transaction(async (tx) => {
      // Cancelling puts every part back on the shelf.
      if (to === "CANCELLED") {
        const parts = await tx.partUsed.findMany({ where: { workOrderId: id } });
        for (const part of parts) {
          await this.stock.change(tx, {
            inventoryItemId: part.inventoryItemId,
            change: part.quantity,
            reason: "WORK_ORDER",
            note: `Returned: ${formatWorkOrderNumber(workOrder.number)} cancelled`,
            workOrderId: id,
            actorId: user.id,
          });
        }
        await tx.partUsed.deleteMany({ where: { workOrderId: id } });
      }
      await tx.workOrder.update({ where: { id }, data: { status: to } });
      await tx.workOrderStatusChange.create({
        data: { workOrderId: id, fromStatus: from, toStatus: to, note: input.note ?? null, changedById: user.id },
      });
      await writeAudit(tx, {
        actorId: user.id,
        action: "workOrder.statusChanged",
        entity: "WorkOrder",
        entityId: id,
        changes: { status: { from, to }, note: input.note ?? null },
      });
    });
    return this.findOne(id);
  }

  // ── Notes, labour and parts (assigned mechanic or staff) ──────────────────

  async updateDetails(user: AuthUser, id: string, input: UpdateWorkOrderDetailsData): Promise<WorkOrderDetail> {
    const workOrder = await this.findForWrite(user, id);
    const changes = diffFields(workOrder, input);
    if (Object.keys(changes).length === 0) return this.findOne(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.workOrder.update({ where: { id }, data: input });
      await writeAudit(tx, { actorId: user.id, action: "workOrder.updated", entity: "WorkOrder", entityId: id, changes });
    });
    return this.findOne(id);
  }

  async addLabour(user: AuthUser, id: string, input: AddLabourData): Promise<WorkOrderDetail> {
    await this.findForWrite(user, id);
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.serviceItem.create({ data: { workOrderId: id, description: input.description, laborCost: input.laborCost } });
      await writeAudit(tx, {
        actorId: user.id,
        action: "workOrder.labourAdded",
        entity: "WorkOrder",
        entityId: id,
        changes: { serviceItemId: item.id, description: input.description, laborCost: input.laborCost },
      });
    });
    return this.findOne(id);
  }

  async removeLabour(user: AuthUser, id: string, itemId: string): Promise<WorkOrderDetail> {
    await this.findForWrite(user, id);
    const item = await this.prisma.serviceItem.findFirst({ where: { id: itemId, workOrderId: id } });
    if (!item) throw new NotFoundException("Labour line not found");
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceItem.delete({ where: { id: itemId } });
      await writeAudit(tx, {
        actorId: user.id,
        action: "workOrder.labourRemoved",
        entity: "WorkOrder",
        entityId: id,
        changes: { description: item.description, laborCost: item.laborCost.toNumber() },
      });
    });
    return this.findOne(id);
  }

  /** Takes the part out of stock straight away (it's reserved for this job). */
  async addPart(user: AuthUser, id: string, input: AddPartData): Promise<WorkOrderDetail> {
    const workOrder = await this.findForWrite(user, id);
    const item = await this.prisma.inventoryItem.findUnique({ where: { id: input.inventoryItemId } });
    if (!item) throw new NotFoundException("Part not found");
    if (!item.isActive) throw new BadRequestException(`${item.name} is deactivated and can't be used`);

    await this.prisma.$transaction(async (tx) => {
      await this.stock.change(tx, {
        inventoryItemId: item.id,
        change: -input.quantity,
        reason: "WORK_ORDER",
        note: `Used on ${formatWorkOrderNumber(workOrder.number)}`,
        workOrderId: id,
        actorId: user.id,
      });
      await tx.partUsed.create({
        data: { workOrderId: id, inventoryItemId: item.id, quantity: input.quantity, unitPrice: item.unitPrice },
      });
    });
    return this.findOne(id);
  }

  /** Puts the part back in stock. */
  async removePart(user: AuthUser, id: string, partId: string): Promise<WorkOrderDetail> {
    const workOrder = await this.findForWrite(user, id);
    const part = await this.prisma.partUsed.findFirst({ where: { id: partId, workOrderId: id } });
    if (!part) throw new NotFoundException("Part line not found");

    await this.prisma.$transaction(async (tx) => {
      await this.stock.change(tx, {
        inventoryItemId: part.inventoryItemId,
        change: part.quantity,
        reason: "WORK_ORDER",
        note: `Returned from ${formatWorkOrderNumber(workOrder.number)}`,
        workOrderId: id,
        actorId: user.id,
      });
      await tx.partUsed.delete({ where: { id: partId } });
    });
    return this.findOne(id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private statusFilter(status: WorkOrderListQuery["status"]): Prisma.WorkOrderWhereInput {
    if (!status) return {};
    if (status === "open") return { status: { in: OPEN_STATUSES } };
    if (status === "closed") return { status: { in: ["COMPLETED", "CANCELLED"] } };
    return { status };
  }

  private mechanicFilter(user: AuthUser, mechanic: string | undefined): Prisma.WorkOrderWhereInput {
    if (!mechanic) return {};
    if (mechanic === "me") return { mechanicId: user.id };
    if (mechanic === "none") return { mechanicId: null };
    return { mechanicId: mechanic };
  }

  private async findOpen(id: string): Promise<WorkOrderRow> {
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id } });
    if (!workOrder) throw new NotFoundException("Work order not found");
    if (isClosedStatus(workOrder.status as WorkOrderStatus)) {
      throw new ConflictException(
        `${formatWorkOrderNumber(workOrder.number)} is ${WORK_ORDER_STATUS_LABEL[workOrder.status as WorkOrderStatus].toLowerCase()} and can't be changed`,
      );
    }
    return workOrder;
  }

  /** Open job that this user may change: staff, or the mechanic assigned to it. */
  private async findForWrite(user: AuthUser, id: string): Promise<WorkOrderRow> {
    const workOrder = await this.findOpen(id);
    if (!isStaff(user) && workOrder.mechanicId !== user.id) {
      throw new ForbiddenException("Only the mechanic assigned to this job (or an advisor) can change it");
    }
    return workOrder;
  }

  private async assertMechanic(mechanicId: string): Promise<void> {
    const mechanic = await this.prisma.user.findUnique({ where: { id: mechanicId }, select: { role: true, isActive: true } });
    if (!mechanic || mechanic.role !== "MECHANIC" || !mechanic.isActive) {
      throw new BadRequestException({
        message: "Choose an active mechanic",
        errors: { mechanicId: ["Choose an active mechanic"] },
      });
    }
  }
}
