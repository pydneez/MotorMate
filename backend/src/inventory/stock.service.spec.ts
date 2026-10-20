import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createPrismaMock } from "../../test/prisma-mock";
import { StockService } from "./stock.service";

function setup(updatedCount = 1, quantityAfter = 13) {
  const { prisma } = createPrismaMock();
  prisma.inventoryItem.updateMany.mockResolvedValue({ count: updatedCount });
  prisma.inventoryItem.findUniqueOrThrow.mockResolvedValue({ quantityOnHand: quantityAfter });
  const tx = prisma as unknown as Prisma.TransactionClient;
  return { prisma, tx, stock: new StockService() };
}

const base = { inventoryItemId: "item-1", actorId: "advisor-1" };

describe("StockService.change", () => {
  it("adds stock without a condition and records a movement and audit entry", async () => {
    const { prisma, tx, stock } = setup(1, 13);

    const quantity = await stock.change(tx, { ...base, change: 10, reason: "PURCHASE", note: "INV-9001" });

    expect(quantity).toBe(13);
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { quantityOnHand: { increment: 10 } },
    });
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantityChange: 10, reason: "PURCHASE", note: "INV-9001", createdById: "advisor-1" }),
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ action: "inventory.received", changes: expect.objectContaining({ quantityOnHand: { from: 3, to: 13 } }) }),
    );
  });

  it("only takes stock out when enough is on hand (single conditional update)", async () => {
    const { prisma, tx, stock } = setup(1, 2);

    await stock.change(tx, { ...base, change: -3, reason: "WORK_ORDER", workOrderId: "wo-1" });

    expect(prisma.inventoryItem.updateMany.mock.calls[0][0].where).toEqual({ id: "item-1", quantityOnHand: { gte: 3 } });
    expect(prisma.stockMovement.create.mock.calls[0][0].data.workOrderId).toBe("wo-1");
  });

  it("refuses to go below zero and says how many are left", async () => {
    const { prisma, tx, stock } = setup(0);
    prisma.inventoryItem.findUnique.mockResolvedValue({ quantityOnHand: 2, name: "Oil filter" });

    await expect(stock.change(tx, { ...base, change: -3, reason: "WORK_ORDER" })).rejects.toThrow(
      "Not enough stock: only 2 Oil filter left",
    );
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("applies a stocktake only if the quantity hasn't changed since it was read", async () => {
    const { prisma, tx, stock } = setup(1, 2);

    await stock.change(tx, { ...base, change: -1, reason: "ADJUSTMENT", expectedQuantity: 3 });

    expect(prisma.inventoryItem.updateMany.mock.calls[0][0].where).toEqual({ id: "item-1", quantityOnHand: 3 });
  });

  it("reports a conflict when the quantity changed during the stocktake", async () => {
    const { prisma, tx, stock } = setup(0);
    prisma.inventoryItem.findUnique.mockResolvedValue({ quantityOnHand: 5, name: "Oil filter" });

    await expect(stock.change(tx, { ...base, change: -1, reason: "ADJUSTMENT", expectedQuantity: 3 })).rejects.toThrow(
      ConflictException,
    );
  });

  it("returns not found for an unknown item", async () => {
    const { prisma, tx, stock } = setup(0);
    prisma.inventoryItem.findUnique.mockResolvedValue(null);

    await expect(stock.change(tx, { ...base, change: -1, reason: "WORK_ORDER" })).rejects.toThrow(NotFoundException);
  });

  it.each([0, 1.5])("rejects a change of %p", async (change) => {
    const { tx, stock } = setup();

    await expect(stock.change(tx, { ...base, change, reason: "PURCHASE" })).rejects.toThrow("non-zero integer");
  });
});
