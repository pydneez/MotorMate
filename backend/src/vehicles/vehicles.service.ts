import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  normalizePlate,
  type AuthUser,
  type CreateVehicleSchema,
  type ListQuery,
  type MileageCorrectionSchema,
  type Paginated,
  type UpdateVehicleSchema,
  type VehicleDetail,
  type VehicleDuplicateQuery,
  type VehicleDuplicates,
  type VehicleSummary,
} from "@motormate/types";
import type { z } from "zod";
import { diffFields, writeAudit } from "../common/utils/audit";
import { pageArgs, paginated, searchTokens } from "../common/utils/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { serviceHistoryInclude, toServiceHistory, toVehicleSummary, vehicleSummaryInclude } from "./vehicle.mapper";

/** Validated request bodies (after the shared zod schemas' transforms). */
export type CreateVehicleData = z.output<typeof CreateVehicleSchema>;
export type UpdateVehicleData = z.output<typeof UpdateVehicleSchema>;
export type MileageCorrectionData = z.output<typeof MileageCorrectionSchema>;

const isCustomer = (user: AuthUser) => user.role === "CUSTOMER";

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Customers only ever see their own vehicles. A customer user without a linked Customer
   * record matches nothing.
   */
  private scope(user: AuthUser): Prisma.VehicleWhereInput {
    return isCustomer(user) ? { customerId: user.customerId ?? "__none__" } : {};
  }

  async list(user: AuthUser, query: ListQuery): Promise<Paginated<VehicleSummary>> {
    const where: Prisma.VehicleWhereInput = {
      ...this.scope(user),
      AND: searchTokens(query.q).map((token) => {
        const or: Prisma.VehicleWhereInput[] = [
          { vin: { contains: token.toUpperCase() } },
          { make: { contains: token, mode: "insensitive" } },
          { model: { contains: token, mode: "insensitive" } },
          { province: { contains: token } },
          { customer: { firstName: { contains: token, mode: "insensitive" } } },
          { customer: { lastName: { contains: token, mode: "insensitive" } } },
        ];
        const plate = normalizePlate(token);
        if (plate) or.push({ plateNormalized: { contains: plate } });
        return { OR: or };
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        include: vehicleSummaryInclude,
        orderBy: [{ updatedAt: "desc" }],
        ...pageArgs(query),
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return paginated(rows.map(toVehicleSummary), total, query);
  }

  async findOne(user: AuthUser, id: string): Promise<VehicleDetail> {
    // Another customer's vehicle is reported as "not found", not "forbidden", so its
    // existence isn't revealed.
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, ...this.scope(user) },
      include: { customer: vehicleSummaryInclude.customer, ...serviceHistoryInclude },
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    const latest = vehicle.workOrders[0];
    return {
      ...toVehicleSummary({ ...vehicle, workOrders: latest ? [{ createdAt: latest.createdAt }] : [] }),
      history: toServiceHistory(vehicle),
    };
  }

  async create(user: AuthUser, input: CreateVehicleData): Promise<VehicleSummary> {
    const customerId = this.resolveOwner(user, input.customerId);
    if (!(await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) {
      throw new NotFoundException("Customer not found");
    }
    await this.assertVinFree(user, input.vin);

    const { customerId: _ignored, ...fields } = input;
    return this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: { ...fields, customerId, plateNormalized: normalizePlate(fields.plate) },
        include: vehicleSummaryInclude,
      });
      await writeAudit(tx, {
        actorId: user.id,
        action: "vehicle.created",
        entity: "Vehicle",
        entityId: vehicle.id,
        changes: { customerId, vin: vehicle.vin, mileage: vehicle.mileage },
      });
      return toVehicleSummary(vehicle);
    });
  }

  /** Staff only (enforced by the controller). Mileage and owner can't change here. */
  async update(user: AuthUser, id: string, input: UpdateVehicleData): Promise<VehicleSummary> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    if (input.vin && input.vin !== vehicle.vin) await this.assertVinFree(user, input.vin, id);

    const data: Prisma.VehicleUncheckedUpdateInput = { ...input };
    if (input.plate) data.plateNormalized = normalizePlate(input.plate);
    const changes = diffFields(vehicle, input);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({ where: { id }, data, include: vehicleSummaryInclude });
      if (Object.keys(changes).length > 0) {
        await writeAudit(tx, { actorId: user.id, action: "vehicle.updated", entity: "Vehicle", entityId: id, changes });
      }
      return toVehicleSummary(updated);
    });
  }

  /** Admin only (enforced by the controller). The only way mileage can go down. */
  async correctMileage(user: AuthUser, id: string, input: MileageCorrectionData): Promise<VehicleSummary> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    if (vehicle.mileage === input.mileage) {
      throw new BadRequestException({
        message: `Mileage is already ${input.mileage.toLocaleString("en-US")} km`,
        errors: { mileage: ["That is already the current mileage"] },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({
        where: { id },
        data: { mileage: input.mileage },
        include: vehicleSummaryInclude,
      });
      await writeAudit(tx, {
        actorId: user.id,
        action: "vehicle.mileageCorrected",
        entity: "Vehicle",
        entityId: id,
        changes: { mileage: { from: vehicle.mileage, to: input.mileage }, reason: input.reason },
      });
      return toVehicleSummary(updated);
    });
  }

  async duplicates(user: AuthUser, query: VehicleDuplicateQuery): Promise<VehicleDuplicates> {
    const exclude = query.excludeId ? { id: { not: query.excludeId } } : {};
    const staff = !isCustomer(user);

    const plateMatches =
      query.plate && query.province
        ? await this.prisma.vehicle.findMany({
            where: { plateNormalized: normalizePlate(query.plate), province: query.province, ...exclude },
            include: vehicleSummaryInclude,
            take: 5,
          })
        : [];
    const vinMatch = query.vin
      ? await this.prisma.vehicle.findFirst({ where: { vin: query.vin, ...exclude }, include: vehicleSummaryInclude })
      : null;

    return {
      plateMatchCount: plateMatches.length,
      byPlate: staff ? plateMatches.map(toVehicleSummary) : [],
      vinTaken: vinMatch !== null,
      byVin: staff && vinMatch ? toVehicleSummary(vinMatch) : null,
    };
  }

  /** Staff must name the customer; customers always add to their own record. */
  private resolveOwner(user: AuthUser, requestedCustomerId: string | undefined): string {
    if (isCustomer(user)) {
      if (!user.customerId) throw new ForbiddenException("Your account isn't linked to a customer profile");
      if (requestedCustomerId && requestedCustomerId !== user.customerId) {
        throw new ForbiddenException("You can only add vehicles to your own profile");
      }
      return user.customerId;
    }
    if (!requestedCustomerId) {
      throw new BadRequestException({ message: "Validation failed", errors: { customerId: ["Choose a customer"] } });
    }
    return requestedCustomerId;
  }

  private async assertVinFree(user: AuthUser, vin: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.vehicle.findFirst({
      where: { vin, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!existing) return;
    throw new ConflictException({
      message: isCustomer(user)
        ? "This VIN is already registered. Please contact the shop."
        : "This VIN is already registered to another vehicle",
      errors: { vin: ["This VIN is already registered"] },
      // Only staff learn which vehicle holds it.
      ...(isCustomer(user) ? {} : { vehicleId: existing.id }),
    });
  }
}
