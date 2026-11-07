import type { PrismaClient } from "@prisma/client";

/**
 * The starting price list (Settings → Services & prices): routine jobs at a fixed price,
 * THB excl. VAT. Repairs that depend on what's found (suspension, electrical faults…) stay
 * custom labour lines. Used by the seed and the demo seed.
 */
export const PRICE_LIST: { name: string; category: string; price: number }[] = [
  { name: "Oil change", category: "Maintenance", price: 500 },
  { name: "Major service", category: "Maintenance", price: 1800 },
  { name: "Wiper blade fitting", category: "Maintenance", price: 150 },
  { name: "Front brake pads replacement", category: "Brakes", price: 800 },
  { name: "Battery test and replacement", category: "Electrical", price: 300 },
  { name: "A/C check and clean", category: "Air-con", price: 900 },
  { name: "Spark plug replacement", category: "Engine", price: 700 },
  { name: "Cooling system flush", category: "Engine", price: 1200 },
];

/**
 * Adds any of the shop's missing entries (matched by name) and leaves ones its admin edited
 * alone. Name → id.
 */
export async function upsertPriceList(prisma: PrismaClient, shopId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const service of PRICE_LIST) {
    const row = await prisma.serviceCatalogItem.upsert({
      where: { shopId_name: { shopId, name: service.name } },
      create: { ...service, shopId },
      update: {},
    });
    ids.set(row.name, row.id);
  }
  return ids;
}
