import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AuthUser,
  CreateInventoryItemSchema,
  InventoryItemDetail,
  InventoryItemSummary,
  InventoryListQuery,
  InventorySummary,
  Paginated,
  ReceiveStockSchema,
  StocktakeSchema,
  StockMovementEntry,
  StockMovementReason,
  UpdateInventoryItemSchema,
} from "@motormate/types";
import type { z } from "zod";
import { diffFields, writeAudit } from "../common/utils/audit";
import { pageArgs, paginated, searchTokens } from "../common/utils/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { StockService } from "./stock.service";

export type CreateInventoryItemData = z.output<typeof CreateInventoryItemSchema>;
export type UpdateInventoryItemData = z.output<typeof UpdateInventoryItemSchema>;
export type ReceiveStockData = z.output<typeof ReceiveStockSchema>;
export type StocktakeData = z.output<typeof StocktakeSchema>;

const MOVEMENT_LIMIT = 50;

type ItemRow = Prisma.InventoryItemGetPayload<object>;

function toSummary(item: ItemRow): InventoryItemSummary {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    category: item.category,
    quantityOnHand: item.quantityOnHand,
    unitCost: item.unitCost.toNumber(),
    unitPrice: item.unitPrice.toNumber(),
    supplier: item.supplier,
    reorderLevel: item.reorderLevel,
    isActive: item.isActive,
    isLowStock: item.quantityOnHand <= item.reorderLevel,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  /** Low stock = on hand ≤ reorder level (a column-to-column comparison). */
  private lowStockFilter(): Prisma.InventoryItemWhereInput {
    return { quantityOnHand: { lte: this.prisma.inventoryItem.fields.reorderLevel } };
  }

  async list(query: InventoryListQuery): Promise<Paginated<InventoryItemSummary>> {
    const where: Prisma.InventoryItemWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.category ? { category: { equals: query.category, mode: "insensitive" } } : {}),
      ...(query.lowStock ? this.lowStockFilter() : {}),
      AND: searchTokens(query.q).map((token) => ({
        OR: [
          { sku: { contains: token.toUpperCase() } },
          { name: { contains: token, mode: "insensitive" } },
          { supplier: { contains: token, mode: "insensitive" } },
          { category: { contains: token, mode: "insensitive" } },
        ],
      })),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    return paginated(rows.map(toSummary), total, query);
  }

  /** Distinct categories (active items), for the filter and the form's suggestions. */
  async categories(): Promise<string[]> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { isActive: true },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    });
    return rows.map((row) => row.category);
  }

  async summary(): Promise<InventorySummary> {
    const [activeItemCount, lowStockCount] = await Promise.all([
      this.prisma.inventoryItem.count({ where: { isActive: true } }),
      this.prisma.inventoryItem.count({ where: { isActive: true, ...this.lowStockFilter() } }),
    ]);
    return { activeItemCount, lowStockCount };
  }

  async findOne(id: string): Promise<InventoryItemDetail> {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        stockMovements: {
          orderBy: { createdAt: "desc" },
          take: MOVEMENT_LIMIT,
          include: {
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            workOrder: { select: { id: true, number: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException("Inventory item not found");
    const { stockMovements, ...fields } = item;
    const movements: StockMovementEntry[] = stockMovements.map((m) => ({
      id: m.id,
      quantityChange: m.quantityChange,
      reason: m.reason as StockMovementReason,
      note: m.note,
      createdAt: m.createdAt.toISOString(),
      createdBy: { id: m.createdBy.id, name: `${m.createdBy.firstName} ${m.createdBy.lastName}` },
      workOrder: m.workOrder,
    }));
    return { ...toSummary(fields), movements };
  }

  async create(actor: AuthUser, input: CreateInventoryItemData): Promise<InventoryItemSummary> {
    await this.assertSkuFree(input.sku);
    const { openingQuantity, ...fields } = input;

    const id = await this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({ data: { ...fields, quantityOnHand: 0 } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "inventory.created",
        entity: "InventoryItem",
        entityId: item.id,
        changes: { sku: item.sku },
      });
      // Opening stock goes through the same path as every other change, so it has a movement.
      if (openingQuantity > 0) {
        await this.stock.change(tx, {
          inventoryItemId: item.id,
          change: openingQuantity,
          reason: "PURCHASE",
          note: "Opening stock",
          actorId: actor.id,
        });
      }
      return item.id;
    });
    return toSummary(await this.prisma.inventoryItem.findUniqueOrThrow({ where: { id } }));
  }

  async update(actor: AuthUser, id: string, input: UpdateInventoryItemData): Promise<InventoryItemSummary> {
    const item = await this.findRow(id);
    if (input.sku && input.sku !== item.sku) await this.assertSkuFree(input.sku);

    // Compare money as numbers so "150" vs Decimal(150.00) isn't reported as a change.
    const comparable = { ...item, unitCost: item.unitCost.toNumber(), unitPrice: item.unitPrice.toNumber() };
    const changes = diffFields(comparable, input);
    if (Object.keys(changes).length === 0) return toSummary(item);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({ where: { id }, data: input });
      await writeAudit(tx, { actorId: actor.id, action: "inventory.updated", entity: "InventoryItem", entityId: id, changes });
      return toSummary(updated);
    });
  }

  async receive(actor: AuthUser, id: string, input: ReceiveStockData): Promise<InventoryItemSummary> {
    const item = await this.findRow(id);
    if (!item.isActive) throw new BadRequestException("Reactivate this item before receiving stock");
    await this.prisma.$transaction((tx) =>
      this.stock.change(tx, {
        inventoryItemId: id,
        change: input.quantity,
        reason: "PURCHASE",
        note: input.note,
        actorId: actor.id,
      }),
    );
    return toSummary(await this.findRow(id));
  }

  async stocktake(actor: AuthUser, id: string, input: StocktakeData): Promise<InventoryItemSummary> {
    const item = await this.findRow(id);
    const difference = input.countedQuantity - item.quantityOnHand;
    if (difference === 0) {
      throw new BadRequestException({
        message: `The count matches the system (${item.quantityOnHand}); nothing to adjust`,
        errors: { countedQuantity: ["Same as the current quantity"] },
      });
    }
    await this.prisma.$transaction((tx) =>
      this.stock.change(tx, {
        inventoryItemId: id,
        change: difference,
        reason: "ADJUSTMENT",
        note: input.reason,
        actorId: actor.id,
        expectedQuantity: item.quantityOnHand,
      }),
    );
    return toSummary(await this.findRow(id));
  }

  async setActive(actor: AuthUser, id: string, isActive: boolean): Promise<InventoryItemSummary> {
    const item = await this.findRow(id);
    if (item.isActive === isActive) return toSummary(item);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({ where: { id }, data: { isActive } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: isActive ? "inventory.reactivated" : "inventory.deactivated",
        entity: "InventoryItem",
        entityId: id,
      });
      return toSummary(updated);
    });
  }

  private async findRow(id: string): Promise<ItemRow> {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Inventory item not found");
    return item;
  }

  private async assertSkuFree(sku: string): Promise<void> {
    if (await this.prisma.inventoryItem.findUnique({ where: { sku }, select: { id: true } })) {
      throw new ConflictException({
        message: `SKU ${sku} is already used by another item`,
        errors: { sku: ["This SKU is already used by another item"] },
      });
    }
  }
}
