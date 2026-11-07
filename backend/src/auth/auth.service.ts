import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import type { AuthUser, ChangePasswordInput, JwtClaims, LoginInput, LoginResponse, MyShop, RegisterData } from "@motormate/types";
import { writeAudit } from "../common/utils/audit";
import { runAsShop, runUnscoped } from "../common/tenancy/tenancy";
import { NotifierService } from "../notifications/notifier.service";
import { PrismaService } from "../prisma/prisma.service";

/** Access token lifetime — roughly one shop shift. */
export const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export const BCRYPT_ROUNDS = 10;

const SUSPENDED = "This shop has been suspended. Please contact MotorMate support.";

type UserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: AuthUser["role"];
};

type ShopRow = { id: string; name: string; isActive: boolean };

function toAuthUser(user: UserRow, shop: ShopRow | null, customerId: string | null): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    shopId: shop?.id ?? null,
    shopName: shop?.name ?? null,
    customerId,
  };
}

const shopSelect = { select: { id: true, name: true, isActive: true } } as const;

/**
 * Sign-in and accounts across shops. Staff work in their own shop; a customer's login is
 * linked to one Customer record per shop and works in one of them at a time (the token's
 * shopId — switched with switchShop); the platform admin works in none. See CLAUDE.md
 * "Auth architecture" and "Multi-shop".
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    // Optional so unit tests can build the service without it.
    @Optional() private readonly notifier?: NotifierService,
  ) {}

  async login({ email, password }: LoginInput): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { shop: shopSelect } });
    // Same message for unknown email and wrong password, so emails can't be probed.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    if (!user.isActive) {
      throw new ForbiddenException("This account has been deactivated. Please contact the shop.");
    }

    let authUser: AuthUser;
    if (user.role === "PLATFORM_ADMIN") {
      authUser = toAuthUser(user, null, null);
    } else if (user.role === "CUSTOMER") {
      authUser = await this.customerSession(user, user.lastShopId);
    } else {
      if (!user.shop?.isActive) throw new ForbiddenException(SUSPENDED);
      authUser = toAuthUser(user, user.shop, null);
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueToken(authUser);
  }

  /**
   * Customer self-registration with their first shop. Links to an existing Customer record
   * in that shop only when both email and phone match, and allows one online account per
   * phone number (across all shops — see CLAUDE.md "Auth architecture").
   */
  async register(data: RegisterData): Promise<LoginResponse> {
    const shop = await this.activeShop(data.shopId);
    if (await this.prisma.user.findUnique({ where: { email: data.email } })) {
      throw new ConflictException("An account with this email already exists. Please sign in.");
    }

    // One online account per phone: a second sign-up with the same phone would create two
    // logins that can never be merged. Shop records without a login are fine (that's the
    // walk-in case, linked below or merged by staff).
    const phoneHasAccount = await runUnscoped(() =>
      this.prisma.customer.findFirst({ where: { phone: data.phone, userId: { not: null } }, select: { id: true } }),
    );
    if (phoneHasAccount) {
      const message = "This phone number is already linked to an online account. Sign in instead, or contact the shop.";
      throw new ConflictException({ message, errors: { phone: [message] } });
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const result = await runAsShop(shop.id, async () => {
      const existingCustomer = await this.prisma.customer.findFirst({ where: { email: data.email } });
      if (existingCustomer && (existingCustomer.userId || existingCustomer.phone !== data.phone)) {
        // Email is on file with a different phone (or already claimed): don't link, and the
        // unique email means we can't create a second record either — staff must resolve it.
        throw new ConflictException(
          "This email is already registered with the shop under different details. Please contact the shop to activate your account.",
        );
      }

      return this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: data.email,
            passwordHash,
            firstName: data.firstName,
            lastName: data.lastName,
            role: "CUSTOMER",
            lastShopId: shop.id,
          },
        });
        const customer = existingCustomer
          ? await tx.customer.update({
              where: { id: existingCustomer.id },
              data: { userId: created.id, lineId: existingCustomer.lineId ?? data.lineId },
            })
          : await tx.customer.create({
              data: {
                shopId: shop.id,
                firstName: data.firstName,
                lastName: data.lastName,
                email: data.email,
                phone: data.phone,
                lineId: data.lineId,
                userId: created.id,
              },
            });
        await writeAudit(tx, {
          actorId: created.id,
          action: existingCustomer ? "customer.portalLinked" : "customer.selfRegistered",
          entity: "Customer",
          entityId: customer.id,
        });
        return { user: created, customerId: customer.id };
      });
    });

    // Subscribe their email to notifications (AWS emails them a confirmation link).
    await runAsShop(shop.id, () => this.notifier?.syncCustomer(result.customerId));
    return this.issueToken(toAuthUser(result.user, shop, result.customerId));
  }

  /**
   * A signed-in customer links their account to another shop: their existing record there
   * (same email and phone, no login yet — e.g. a walk-in) or a new one with their details.
   * Then they're switched to it.
   */
  async linkShop(current: AuthUser, shopId: string): Promise<LoginResponse> {
    if (current.role !== "CUSTOMER") throw new ForbiddenException("Only customers link to shops");
    const shop = await this.activeShop(shopId);
    const already = await runAsShop(shop.id, () => this.prisma.customer.findFirst({ where: { userId: current.id } }));
    if (already) return this.switchShop(current, shop.id);

    const profile = current.customerId
      ? await this.prisma.customer.findUnique({ where: { id: current.customerId } })
      : null;
    if (!profile) throw new NotFoundException("Your customer record wasn't found");

    const customerId = await runAsShop(shop.id, async () => {
      const onFile = profile.email ? await this.prisma.customer.findFirst({ where: { email: profile.email } }) : null;
      if (onFile && (onFile.userId || onFile.phone !== profile.phone)) {
        throw new ConflictException(
          "This shop has your email on file under different details. Please contact the shop to link your account.",
        );
      }
      return this.prisma.$transaction(async (tx) => {
        const customer = onFile
          ? await tx.customer.update({ where: { id: onFile.id }, data: { userId: current.id } })
          : await tx.customer.create({
              data: {
                shopId: shop.id,
                firstName: profile.firstName,
                lastName: profile.lastName,
                email: profile.email,
                phone: profile.phone,
                lineId: profile.lineId,
                userId: current.id,
              },
            });
        await writeAudit(tx, {
          actorId: current.id,
          action: onFile ? "customer.portalLinked" : "customer.shopLinked",
          entity: "Customer",
          entityId: customer.id,
        });
        return customer.id;
      });
    });
    await runAsShop(shop.id, () => this.notifier?.syncCustomer(customerId));
    return this.switchShop(current, shop.id);
  }

  /** A customer works in another of their shops from now on (a new token for it). */
  async switchShop(current: AuthUser, shopId: string): Promise<LoginResponse> {
    if (current.role !== "CUSTOMER") throw new ForbiddenException("Only customers switch shops");
    const user = await this.prisma.user.findUnique({ where: { id: current.id } });
    if (!user) throw new UnauthorizedException("Session is no longer valid");
    const authUser = await this.customerSession(user, shopId, true);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastShopId: shopId } });
    return this.issueToken(authUser);
  }

  /** The shops a customer is linked to, the current one marked. */
  async myShops(current: AuthUser): Promise<MyShop[]> {
    if (current.role !== "CUSTOMER") return [];
    const records = await runUnscoped(() =>
      this.prisma.customer.findMany({
        where: { userId: current.id, shop: { isActive: true } },
        select: { shop: { select: { id: true, name: true, address: true, phone: true } } },
        orderBy: { createdAt: "asc" },
      }),
    );
    return records.map(({ shop }) => ({ ...shop, current: shop.id === current.shopId }));
  }

  /** Any signed-in user changing their own password; the current one must be correct. */
  async changePassword(userId: string, { currentPassword, newPassword }: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    // 400 rather than 401, so the frontend doesn't treat it as an expired session.
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException({
        message: "Current password is incorrect",
        errors: { currentPassword: ["Current password is incorrect"] },
      });
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await writeAudit(tx, { actorId: userId, action: "user.passwordChanged", entity: "User", entityId: userId });
    });
  }

  /**
   * Used by JwtStrategy on every authenticated request: the user must still be active, and
   * the token's shop still theirs and not suspended — so deactivating someone or suspending a
   * shop takes effect at once instead of when the 8h token expires.
   */
  async findActiveUser(claims: Pick<JwtClaims, "sub" | "shopId">): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub }, include: { shop: shopSelect } });
    if (!user || !user.isActive) return null;
    if (user.role === "PLATFORM_ADMIN") return toAuthUser(user, null, null);
    if (user.role !== "CUSTOMER") {
      return user.shop?.isActive && user.shop.id === claims.shopId ? toAuthUser(user, user.shop, null) : null;
    }
    if (!claims.shopId) return null;
    const customer = await runAsShop(claims.shopId, () =>
      this.prisma.customer.findFirst({ where: { userId: user.id }, select: { id: true, shop: shopSelect } }),
    );
    return customer?.shop.isActive ? toAuthUser(user, customer.shop, customer.id) : null;
  }

  /**
   * A customer's session in one of their shops: `preferred` if it's theirs and open,
   * otherwise (unless `strict`) their first open one.
   */
  private async customerSession(user: UserRow, preferred: string | null, strict = false): Promise<AuthUser> {
    const records = await runUnscoped(() =>
      this.prisma.customer.findMany({
        where: { userId: user.id },
        select: { id: true, shop: shopSelect },
        orderBy: { createdAt: "asc" },
      }),
    );
    const open = records.filter((record) => record.shop.isActive);
    const chosen = open.find((record) => record.shop.id === preferred) ?? (strict ? undefined : open[0]);
    if (!chosen) {
      if (strict) throw new NotFoundException("You're not linked to that shop");
      throw new ForbiddenException(
        records.length > 0 ? "Your shop isn't available on MotorMate right now. Please contact the shop." : "This account isn't linked to a shop.",
      );
    }
    return toAuthUser(user, chosen.shop, chosen.id);
  }

  /** A shop that exists and isn't suspended (sign-up, linking). */
  private async activeShop(shopId: string): Promise<ShopRow> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true, isActive: true } });
    if (!shop || !shop.isActive) {
      const message = "That shop isn't available. Choose another one.";
      throw new BadRequestException({ message, errors: { shopId: [message] } });
    }
    return shop;
  }

  private async issueToken(user: AuthUser): Promise<LoginResponse> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role, shopId: user.shopId });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, user };
  }
}
