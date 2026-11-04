import { Injectable } from "@nestjs/common";
import { DEFAULT_SHOP_DETAILS, type AuthUser, type ShopDetails, type UpdateShopDetailsSchema } from "@motormate/types";
import type { z } from "zod";
import { diffFields, writeAudit } from "../common/utils/audit";
import { PrismaService } from "../prisma/prisma.service";

export type UpdateShopDetailsData = z.output<typeof UpdateShopDetailsSchema>;

const SHOP_ROW = 1;

/**
 * The shop's details (Settings → Shop details): one row, id 1, created by the migration.
 * Invoices, the PDF, emails and "call us" messages read them from here. Falls back to the
 * defaults (the old SHOP constant) when the row is missing, e.g. on a freshly emptied test DB.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async shop(): Promise<ShopDetails> {
    const row = await this.prisma.shopSettings.findUnique({ where: { id: SHOP_ROW } });
    if (!row) return DEFAULT_SHOP_DETAILS;
    return { name: row.name, address: row.address, phone: row.phone, email: row.email, taxId: row.taxId };
  }

  async updateShop(actor: AuthUser, input: UpdateShopDetailsData): Promise<ShopDetails> {
    const previous = await this.shop();
    const next: ShopDetails = { ...input, email: input.email ?? null };
    await this.prisma.$transaction(async (tx) => {
      await tx.shopSettings.upsert({ where: { id: SHOP_ROW }, create: { id: SHOP_ROW, ...next }, update: next });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "settings.shopUpdated",
        entity: "ShopSettings",
        entityId: String(SHOP_ROW),
        changes: diffFields(previous, next),
      });
    });
    return next;
  }
}
