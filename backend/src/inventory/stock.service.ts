import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { StockMovementReason } from "@motormate/types";
import { writeAudit } from "../common/utils/audit";

export type StockChange = {
  inventoryItemId: string;
  /** Signed: negative takes stock out, positive puts it in. Never 0. */
  change: number;
  reason: StockMovementReason;
  note?: string | null;
  workOrderId?: string | null;
  actorId: string;
  /**
   * Optimistic check: only apply if the quantity on hand is still this value. Used by
   * stocktake, which computes the difference from what the user saw.
   */
  expectedQuantity?: number;
};

const AUDIT_ACTION: Record<StockMovementReason, string> = {
  PURCHASE: "inventory.received",
  ADJUSTMENT: "inventory.stocktake",
  WORK_ORDER: "inventory.usedOnWorkOrder",
};

/**
 * The ONLY way stock levels change (receive, stocktake, and — from Step 4 — parts used on
 * work orders). Must be called inside a transaction: it changes the quantity, records a
 * StockMovement and writes the audit log together.
 *
 * Stock can never go negative, even with two people taking the last part at the same time:
 * the decrement is a single conditional UPDATE ("… WHERE quantityOnHand >= n"), so the
 * database serialises concurrent requests and the second one matches no row.
 */
@Injectable()
export class StockService {
  async change(tx: Prisma.TransactionClient, input: StockChange): Promise<number> {
    const { inventoryItemId: id, change } = input;
    if (!Number.isInteger(change) || change === 0) throw new Error("Stock change must be a non-zero integer");

    const where: Prisma.InventoryItemWhereInput = { id };
    if (input.expectedQuantity !== undefined) where.quantityOnHand = input.expectedQuantity;
    else if (change < 0) where.quantityOnHand = { gte: -change };

    const updated = await tx.inventoryItem.updateMany({ where, data: { quantityOnHand: { increment: change } } });
    if (updated.count === 0) {
      const item = await tx.inventoryItem.findUnique({ where: { id }, select: { quantityOnHand: true, name: true } });
      if (!item) throw new NotFoundException("Inventory item not found");
      if (input.expectedQuantity !== undefined) {
        throw new ConflictException(
          `Stock for ${item.name} changed to ${item.quantityOnHand} while you were counting. Please check and try again.`,
        );
      }
      throw new ConflictException(`Not enough stock: only ${item.quantityOnHand} ${item.name} left`);
    }

    const { quantityOnHand } = await tx.inventoryItem.findUniqueOrThrow({ where: { id }, select: { quantityOnHand: true } });
    await tx.stockMovement.create({
      data: {
        inventoryItemId: id,
        quantityChange: change,
        reason: input.reason,
        note: input.note ?? null,
        workOrderId: input.workOrderId ?? null,
        createdById: input.actorId,
      },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: AUDIT_ACTION[input.reason],
      entity: "InventoryItem",
      entityId: id,
      changes: { change, quantityOnHand: { from: quantityOnHand - change, to: quantityOnHand }, note: input.note ?? null },
    });
    return quantityOnHand;
  }
}
