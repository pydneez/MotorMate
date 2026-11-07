import type { PrismaClient } from "@prisma/client";
import { nextNumber } from "../prisma/shops";

/**
 * The shop the integration tests work in. Each suite empties the database first, so it
 * creates the shop again (createTestShop) before its own data.
 */
export const TEST_SHOP_ID = "shop_test";

export async function createTestShop(prisma: PrismaClient, id = TEST_SHOP_ID, name = "Test Garage"): Promise<void> {
  await prisma.shop.create({
    data: { id, name, address: "1 Test Road\nBangkok 10110", phone: "+6621234567", taxId: "0-1055-12345-67-8" },
  });
}

/** Staff belong to the shop; customers' logins to none (their Customer record does). */
export function shopOf(role: string, shopId = TEST_SHOP_ID): { shopId?: string } {
  return role === "CUSTOMER" ? {} : { shopId };
}

/** The test shop's next WO-/INV- number, for rows the tests create directly. */
export function testNumber(prisma: PrismaClient, kind: "workOrder" | "invoice", shopId = TEST_SHOP_ID): Promise<number> {
  return nextNumber(prisma, shopId, kind);
}
