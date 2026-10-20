import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createPrismaMock, makeAuthUser } from "../../test/prisma-mock";
import { InventoryService } from "./inventory.service";
import type { StockService } from "./stock.service";

const advisor = makeAuthUser({ id: "advisor-1", role: "ADVISOR" });

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    sku: "FLT-CAB-UNI",
    name: "Cabin air filter",
    category: "Filters",
    quantityOnHand: 3,
    unitCost: new Prisma.Decimal(150),
    unitPrice: new Prisma.Decimal(290),
    supplier: "Bosch",
    reorderLevel: 5,
    isActive: true,
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    ...overrides,
  };
}

function setup() {
  const { prisma, service } = createPrismaMock();
  const stock = { change: jest.fn().mockResolvedValue(0) };
  const inventory = new InventoryService(service, stock as unknown as StockService);
  return { prisma, stock, inventory };
}

const newItem = {
  sku: "BRK-PAD-RR",
  name: "Rear brake pads",
  category: "Brakes",
  unitCost: 700,
  unitPrice: 1200,
  supplier: "Brembo",
  reorderLevel: 2,
  openingQuantity: 4,
};

describe("InventoryService.list / summary", () => {
  it("maps rows with money as numbers and a low-stock flag", async () => {
    const { prisma, inventory } = setup();
    prisma.inventoryItem.findMany.mockResolvedValue([itemRow(), itemRow({ id: "item-2", quantityOnHand: 24 })]);
    prisma.inventoryItem.count.mockResolvedValue(2);

    const result = await inventory.list({ page: 1, pageSize: 20 });

    expect(result.items[0]).toEqual(expect.objectContaining({ unitCost: 150, unitPrice: 290, isLowStock: true }));
    expect(result.items[1].isLowStock).toBe(false);
    expect(prisma.inventoryItem.findMany.mock.calls[0][0].where.isActive).toBe(true);
  });

  it("filters low stock by comparing on-hand with each item's reorder level", async () => {
    const { prisma, inventory } = setup();

    await inventory.list({ page: 1, pageSize: 20, lowStock: true, category: "filters", includeInactive: true, q: "bosch" });

    const where = prisma.inventoryItem.findMany.mock.calls[0][0].where;
    expect(where.quantityOnHand).toEqual({ lte: "<ref:reorderLevel>" });
    expect(where.category).toEqual({ equals: "filters", mode: "insensitive" });
    expect(where.isActive).toBeUndefined();
    expect(where.AND[0].OR).toContainEqual({ supplier: { contains: "bosch", mode: "insensitive" } });
  });

  it("counts active and low-stock items for the dashboard", async () => {
    const { prisma, inventory } = setup();
    prisma.inventoryItem.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3);

    await expect(inventory.summary()).resolves.toEqual({ activeItemCount: 10, lowStockCount: 3 });
  });
});

describe("InventoryService.create", () => {
  it("creates the item at 0 and records the opening quantity as a stock movement", async () => {
    const { prisma, stock, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(null);
    prisma.inventoryItem.create.mockResolvedValue(itemRow({ id: "new-1", sku: newItem.sku, quantityOnHand: 0 }));
    prisma.inventoryItem.findUniqueOrThrow.mockResolvedValue(itemRow({ id: "new-1", quantityOnHand: 4 }));

    const result = await inventory.create(advisor, newItem);

    expect(prisma.inventoryItem.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ sku: "BRK-PAD-RR", quantityOnHand: 0 }),
    );
    expect(prisma.inventoryItem.create.mock.calls[0][0].data).not.toHaveProperty("openingQuantity");
    expect(stock.change).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inventoryItemId: "new-1", change: 4, reason: "PURCHASE", note: "Opening stock" }),
    );
    expect(result.quantityOnHand).toBe(4);
  });

  it("records no movement for an opening quantity of 0", async () => {
    const { prisma, stock, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(null);
    prisma.inventoryItem.create.mockResolvedValue(itemRow({ id: "new-1", quantityOnHand: 0 }));
    prisma.inventoryItem.findUniqueOrThrow.mockResolvedValue(itemRow({ id: "new-1", quantityOnHand: 0 }));

    await inventory.create(advisor, { ...newItem, openingQuantity: 0 });

    expect(stock.change).not.toHaveBeenCalled();
  });

  it("rejects a SKU that is already used", async () => {
    const { prisma, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: "other" });

    const error = await inventory.create(advisor, newItem).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().errors.sku).toBeDefined();
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });
});

describe("InventoryService.update", () => {
  it("records only fields that changed, comparing money as numbers", async () => {
    const { prisma, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(itemRow());
    prisma.inventoryItem.update.mockResolvedValue(itemRow({ unitPrice: new Prisma.Decimal(320) }));

    await inventory.update(advisor, "item-1", { unitCost: 150, unitPrice: 320, name: "Cabin air filter" });

    expect(prisma.auditLog.create.mock.calls[0][0].data.changes).toEqual({ unitPrice: { from: 290, to: 320 } });
  });

  it("does nothing when nothing changed", async () => {
    const { prisma, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(itemRow());

    await inventory.update(advisor, "item-1", { unitCost: 150, reorderLevel: 5 });

    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });

  it("rejects changing the SKU to one another item uses", async () => {
    const { prisma, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValueOnce(itemRow()).mockResolvedValueOnce({ id: "other" });

    await expect(inventory.update(advisor, "item-1", { sku: "OIL-5W30-4L" })).rejects.toThrow(ConflictException);
  });

  it("returns not found for an unknown item", async () => {
    const { prisma, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(null);

    await expect(inventory.update(advisor, "nope", { name: "X" })).rejects.toThrow(NotFoundException);
  });
});

describe("InventoryService.receive / stocktake", () => {
  it("receives stock through the stock service", async () => {
    const { prisma, stock, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(itemRow());

    await inventory.receive(advisor, "item-1", { quantity: 10, note: "INV-BOSCH-9001" });

    expect(stock.change).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ change: 10, reason: "PURCHASE", note: "INV-BOSCH-9001", actorId: "advisor-1" }),
    );
  });

  it("refuses to receive stock for a deactivated item", async () => {
    const { prisma, stock, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(itemRow({ isActive: false }));

    await expect(inventory.receive(advisor, "item-1", { quantity: 1, note: null })).rejects.toThrow(BadRequestException);
    expect(stock.change).not.toHaveBeenCalled();
  });

  it.each([
    [2, -1],
    [8, 5],
  ])("turns a count of %p (system says 3) into a change of %p, guarded by the quantity read", async (counted, change) => {
    const { prisma, stock, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(itemRow());

    await inventory.stocktake(advisor, "item-1", { countedQuantity: counted, reason: "Monthly count" });

    expect(stock.change).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ change, reason: "ADJUSTMENT", note: "Monthly count", expectedQuantity: 3 }),
    );
  });

  it("rejects a stocktake that matches the system quantity", async () => {
    const { prisma, stock, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(itemRow());

    await expect(inventory.stocktake(advisor, "item-1", { countedQuantity: 3, reason: "Monthly count" })).rejects.toThrow(
      BadRequestException,
    );
    expect(stock.change).not.toHaveBeenCalled();
  });
});

describe("InventoryService.setActive", () => {
  it("deactivates and audits", async () => {
    const { prisma, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(itemRow());
    prisma.inventoryItem.update.mockResolvedValue(itemRow({ isActive: false }));

    await inventory.setActive(advisor, "item-1", false);

    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe("inventory.deactivated");
  });

  it("is a no-op when already in that state", async () => {
    const { prisma, inventory } = setup();
    prisma.inventoryItem.findUnique.mockResolvedValue(itemRow());

    await inventory.setActive(advisor, "item-1", true);

    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });
});
