import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import type { AuthUser, PlatformShop, RegisterShopData, ShopOption } from "@motormate/types";
import { BCRYPT_ROUNDS } from "../auth/auth.service";
import { runUnscoped } from "../common/tenancy/tenancy";
import { writeAudit } from "../common/utils/audit";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shops on the platform: the public list customers pick from, self-registration (a shop and
 * its first admin, active at once), and the platform admin's list with suspend/reactivate.
 * Shop and User aren't shop-scoped tables; the counts are platform-wide on purpose
 * (runUnscoped).
 */
@Injectable()
export class ShopsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Open shops, A–Z — for sign-up and "link another shop". */
  async list(): Promise<ShopOption[]> {
    return this.prisma.shop.findMany({
      where: { isActive: true },
      select: { id: true, name: true, address: true, phone: true },
      orderBy: { name: "asc" },
    });
  }

  /** A new shop and its first admin, in one transaction; they then sign in as usual. */
  async register(input: RegisterShopData): Promise<ShopOption> {
    if (await this.prisma.user.findUnique({ where: { email: input.adminEmail } })) {
      const message = "An account with this email already exists. Use another email for the shop's admin.";
      throw new ConflictException({ message, errors: { adminEmail: [message] } });
    }
    const passwordHash = await bcrypt.hash(input.adminPassword, BCRYPT_ROUNDS);
    return this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: { name: input.name, address: input.address, phone: input.phone, email: input.email ?? null, taxId: input.taxId },
      });
      const admin = await tx.user.create({
        data: {
          shopId: shop.id,
          email: input.adminEmail,
          passwordHash,
          firstName: input.adminFirstName,
          lastName: input.adminLastName,
          role: "ADMIN",
        },
      });
      await writeAudit(tx, {
        actorId: admin.id,
        action: "shop.registered",
        entity: "Shop",
        entityId: shop.id,
        changes: { name: shop.name },
      });
      return { id: shop.id, name: shop.name, address: shop.address, phone: shop.phone };
    });
  }

  /** Platform admin: every shop, newest first, with a few numbers about each. */
  async platformList(): Promise<PlatformShop[]> {
    return runUnscoped(async () => {
      const since = new Date(Date.now() - 30 * DAY_MS);
      const [shops, staff, customers, recent, admins] = await Promise.all([
        this.prisma.shop.findMany({ orderBy: { createdAt: "desc" } }),
        this.prisma.user.groupBy({ by: ["shopId"], where: { shopId: { not: null }, isActive: true }, _count: { _all: true } }),
        this.prisma.customer.groupBy({ by: ["shopId"], _count: { _all: true } }),
        this.prisma.workOrder.groupBy({ by: ["shopId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        this.prisma.user.findMany({
          where: { role: "ADMIN", shopId: { not: null } },
          select: { shopId: true, firstName: true, lastName: true, email: true },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      const count = (rows: { shopId: string | null; _count: { _all: number } }[], id: string) =>
        rows.find((row) => row.shopId === id)?._count._all ?? 0;
      return shops.map((shop) => {
        const admin = admins.find((row) => row.shopId === shop.id);
        return {
          id: shop.id,
          name: shop.name,
          phone: shop.phone,
          isActive: shop.isActive,
          createdAt: shop.createdAt.toISOString(),
          staff: count(staff, shop.id),
          customers: count(customers, shop.id),
          recentWorkOrders: count(recent, shop.id),
          admin: admin ? { name: `${admin.firstName} ${admin.lastName}`, email: admin.email } : null,
        };
      });
    });
  }

  /** Platform admin: suspend (staff can't sign in, customers can't use it) or reactivate. */
  async setActive(actor: AuthUser, id: string, isActive: boolean): Promise<PlatformShop> {
    const shop = await this.prisma.shop.findUnique({ where: { id } });
    if (!shop) throw new NotFoundException("Shop not found");
    if (shop.isActive === isActive) {
      throw new BadRequestException(isActive ? "This shop is already active" : "This shop is already suspended");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.shop.update({ where: { id }, data: { isActive } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: isActive ? "shop.reactivated" : "shop.suspended",
        entity: "Shop",
        entityId: id,
      });
    });
    const updated = (await this.platformList()).find((row) => row.id === id);
    return updated!;
  }
}
