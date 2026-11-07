import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_SHOP_DETAILS, type ShopDetails } from "@motormate/types";

/** Shop #1 — the id the multi-shop migration gave all data that existed before it. */
export const MAIN_SHOP_ID = "shop_main";

/** The demo's second shop (seed-demo.ts), so the platform list and switching have two. */
export const SECOND_SHOP_ID = "shop_siam";
export const SECOND_SHOP: ShopDetails = {
  name: "Siam Garage",
  address: "88 Rama IV Road\nPathum Wan, Bangkok 10330",
  phone: "+6622345678",
  email: "hello@siamgarage.example",
  taxId: "0-1055-88888-01-2",
};

type Db = PrismaClient | Prisma.TransactionClient;

/** Creates the shop if it doesn't exist; an existing one is left as the admin edited it. */
export function upsertShop(prisma: Db, id: string, details: ShopDetails = DEFAULT_SHOP_DETAILS) {
  return prisma.shop.upsert({ where: { id }, update: {}, create: { id, ...details } });
}

/** The shop's next WO-/INV- number (same counter the API uses — common/tenancy/shop-records.ts). */
export async function nextNumber(prisma: Db, shopId: string, kind: "workOrder" | "invoice"): Promise<number> {
  if (kind === "workOrder") {
    const shop = await prisma.shop.update({ where: { id: shopId }, data: { lastWorkOrderNumber: { increment: 1 } } });
    return shop.lastWorkOrderNumber;
  }
  const shop = await prisma.shop.update({ where: { id: shopId }, data: { lastInvoiceNumber: { increment: 1 } } });
  return shop.lastInvoiceNumber;
}
