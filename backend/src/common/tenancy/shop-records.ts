import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthUser } from "@motormate/types";

/** The shop a staff member or customer acts for — creates stamp it on the new record. */
export function requireShop(actor: Pick<AuthUser, "shopId">): string {
  if (!actor.shopId) throw new ForbiddenException("No shop selected for this request");
  return actor.shopId;
}

/**
 * The next WO-/INV- number for a shop: one atomic increment of the shop's counter inside
 * the caller's transaction, so two check-ins at once never get the same number and each
 * shop starts at 1.
 */
export async function nextShopNumber(
  tx: Prisma.TransactionClient,
  shopId: string,
  kind: "workOrder" | "invoice",
): Promise<number> {
  if (kind === "workOrder") {
    const shop = await tx.shop.update({
      where: { id: shopId },
      data: { lastWorkOrderNumber: { increment: 1 } },
      select: { lastWorkOrderNumber: true },
    });
    return shop.lastWorkOrderNumber;
  }
  const shop = await tx.shop.update({
    where: { id: shopId },
    data: { lastInvoiceNumber: { increment: 1 } },
    select: { lastInvoiceNumber: true },
  });
  return shop.lastInvoiceNumber;
}
