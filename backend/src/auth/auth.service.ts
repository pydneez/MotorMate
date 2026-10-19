import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import type { AuthUser, ChangePasswordInput, LoginInput, LoginResponse, RegisterData } from "@motormate/types";
import { writeAudit } from "../common/utils/audit";
import { PrismaService } from "../prisma/prisma.service";

/** Access token lifetime — roughly one shop shift. */
export const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export const BCRYPT_ROUNDS = 10;

type UserWithCustomer = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: AuthUser["role"];
  customer: { id: string } | null;
};

function toAuthUser(user: UserWithCustomer): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    customerId: user.customer?.id ?? null,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login({ email, password }: LoginInput): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { customer: { select: { id: true } } },
    });
    // Same message for unknown email and wrong password, so emails can't be probed.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    if (!user.isActive) {
      throw new ForbiddenException("This account has been deactivated. Please contact the shop.");
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueToken(toAuthUser(user));
  }

  /**
   * Customer self-registration. Links to an existing shop-created Customer only when both
   * email and phone match (see CLAUDE.md "Auth architecture").
   */
  async register(data: RegisterData): Promise<LoginResponse> {
    if (await this.prisma.user.findUnique({ where: { email: data.email } })) {
      throw new ConflictException("An account with this email already exists. Please sign in.");
    }

    const existingCustomer = await this.prisma.customer.findUnique({ where: { email: data.email } });
    if (existingCustomer && (existingCustomer.userId || existingCustomer.phone !== data.phone)) {
      // Email is on file with a different phone (or already claimed): don't link, and the
      // unique email means we can't create a second record either — staff must resolve it.
      throw new ConflictException(
        "This email is already registered with the shop under different details. Please contact the shop to activate your account.",
      );
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          role: "CUSTOMER",
        },
      });

      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: { userId: created.id, lineId: existingCustomer.lineId ?? data.lineId },
          })
        : await tx.customer.create({
            data: {
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              phone: data.phone,
              lineId: data.lineId,
              userId: created.id,
            },
          });

      await tx.auditLog.create({
        data: {
          actorId: created.id,
          action: existingCustomer ? "customer.portalLinked" : "customer.selfRegistered",
          entity: "Customer",
          entityId: customer.id,
        },
      });

      return { ...created, customer: { id: customer.id } };
    });

    return this.issueToken(toAuthUser(user));
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

  /** Used by JwtStrategy on every authenticated request. */
  async findActiveUser(id: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { customer: { select: { id: true } } },
    });
    if (!user || !user.isActive) return null;
    return toAuthUser(user);
  }

  private async issueToken(user: AuthUser): Promise<LoginResponse> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, user };
  }
}
