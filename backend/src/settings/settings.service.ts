import { Injectable, NotFoundException } from "@nestjs/common";
import { DEFAULT_SHOP_DETAILS, type AuthUser, type ShopDetails, type UpdateShopDetailsSchema } from "@motormate/types";
import type { z } from "zod";
import { requireShop } from "../common/tenancy/shop-records";
import { currentShopId } from "../common/tenancy/tenancy";
import { diffFields, writeAudit } from "../common/utils/audit";
import { PrismaService } from "../prisma/prisma.service";

export type UpdateShopDetailsData = z.output<typeof UpdateShopDetailsSchema>;

/**
 * The current shop's details (Settings → Shop details), from its Shop row. Invoices, the PDF,
 * emails and "call us" messages read them from here. Falls back to the defaults (the old SHOP
 * constant) if the row is missing.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** `shopId` defaults to the request's (or job's) shop — see common/tenancy. */
  async shop(shopId: string = currentShopId()): Promise<ShopDetails> {
    const row = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!row) return DEFAULT_SHOP_DETAILS;
    return { name: row.name, address: row.address, phone: row.phone, email: row.email, taxId: row.taxId };
  }

  async updateShop(actor: AuthUser, input: UpdateShopDetailsData): Promise<ShopDetails> {
    const shopId = requireShop(actor);
    if (!(await this.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } }))) {
      throw new NotFoundException("Shop not found");
    }
    const previous = await this.shop(shopId);
    const next: ShopDetails = { ...input, email: input.email ?? null };
    await this.prisma.$transaction(async (tx) => {
      await tx.shop.update({ where: { id: shopId }, data: next });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "settings.shopUpdated",
        entity: "Shop",
        entityId: shopId,
        changes: diffFields(previous, next),
      });
    });
    return next;
  }
}
