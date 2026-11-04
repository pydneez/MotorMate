import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser, CreateServiceSchema, ServiceCatalogEntry, ServiceListQuery, UpdateServiceSchema } from "@motormate/types";
import type { z } from "zod";
import { diffFields, writeAudit } from "../common/utils/audit";
import { PrismaService } from "../prisma/prisma.service";

export type CreateServiceData = z.output<typeof CreateServiceSchema>;
export type UpdateServiceData = z.output<typeof UpdateServiceSchema>;

type ServiceRow = Prisma.ServiceCatalogItemGetPayload<object>;

export function toServiceEntry(row: ServiceRow): ServiceCatalogEntry {
  return { id: row.id, name: row.name, category: row.category, price: Number(row.price), bookable: row.bookable, isActive: row.isActive };
}

/**
 * The fixed-price list (Settings → Services & prices). Admins add and edit; services are
 * deactivated, never deleted, so old labour lines and bookings keep pointing at them.
 * Staff read the active list (admins can include deactivated ones); customers see only
 * active, bookable services, for booking.
 */
@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ServiceListQuery): Promise<ServiceCatalogEntry[]> {
    const where: Prisma.ServiceCatalogItemWhereInput =
      user.role === "CUSTOMER"
        ? { isActive: true, bookable: true }
        : query.includeInactive && user.role === "ADMIN"
          ? {}
          : { isActive: true };
    const rows = await this.prisma.serviceCatalogItem.findMany({ where, orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }] });
    return rows.map(toServiceEntry);
  }

  async create(actor: AuthUser, input: CreateServiceData): Promise<ServiceCatalogEntry> {
    await this.assertNameFree(input.name);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceCatalogItem.create({ data: input });
      await writeAudit(tx, { actorId: actor.id, action: "service.created", entity: "ServiceCatalogItem", entityId: row.id, changes: { ...input } });
      return row;
    });
    return toServiceEntry(created);
  }

  async update(actor: AuthUser, id: string, input: UpdateServiceData): Promise<ServiceCatalogEntry> {
    const existing = await this.prisma.serviceCatalogItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Service not found");
    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) await this.assertNameFree(input.name, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceCatalogItem.update({ where: { id }, data: input });
      await writeAudit(tx, {
        actorId: actor.id,
        action: input.isActive === false ? "service.deactivated" : "service.updated",
        entity: "ServiceCatalogItem",
        entityId: id,
        changes: diffFields(toServiceEntry(existing), input),
      });
      return row;
    });
    return toServiceEntry(updated);
  }

  /** Names are unique regardless of capitals, so the list can't hold "Oil change" twice. */
  private async assertNameFree(name: string, exceptId?: string) {
    const clash = await this.prisma.serviceCatalogItem.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      const message = "A service with this name already exists";
      throw new ConflictException({ message, errors: { name: [message] } });
    }
  }
}
