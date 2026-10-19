import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import type {
  AuthUser,
  CreateStaffInput,
  Paginated,
  ResetPasswordInput,
  StaffListQuery,
  StaffUser,
  UpdateStaffInput,
} from "@motormate/types";
import { BCRYPT_ROUNDS } from "../auth/auth.service";
import { diffFields, writeAudit } from "../common/utils/audit";
import { pageArgs, paginated, searchTokens } from "../common/utils/pagination";
import { PrismaService } from "../prisma/prisma.service";

const STAFF_ROLES = ["ADMIN", "ADVISOR", "MECHANIC"] as const;

const staffSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/** Staff account management (ADMIN only). Customer logins are never returned or touched here. */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: StaffListQuery): Promise<Paginated<StaffUser>> {
    const where: Prisma.UserWhereInput = {
      role: query.role ?? { in: [...STAFF_ROLES] },
      ...(query.includeInactive ? {} : { isActive: true }),
      AND: searchTokens(query.q).map((token) => ({
        OR: [
          { firstName: { contains: token, mode: "insensitive" } },
          { lastName: { contains: token, mode: "insensitive" } },
          { email: { contains: token, mode: "insensitive" } },
        ],
      })),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: staffSelect,
        orderBy: [{ isActive: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(items as StaffUser[], total, query);
  }

  async create(actor: AuthUser, input: CreateStaffInput & { email: string }): Promise<StaffUser> {
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw new ConflictException({
        message: "An account with this email already exists",
        errors: { email: ["An account with this email already exists"] },
      });
    }
    const passwordHash = await bcrypt.hash(input.temporaryPassword, BCRYPT_ROUNDS);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          passwordHash,
        },
        select: staffSelect,
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "user.created",
        entity: "User",
        entityId: user.id,
        changes: { role: user.role },
      });
      return user as StaffUser;
    });
  }

  async update(actor: AuthUser, id: string, input: UpdateStaffInput): Promise<StaffUser> {
    const user = await this.findStaff(id);
    if (input.role && input.role !== user.role) {
      if (id === actor.id) throw new ForbiddenException("You can't change your own role");
      if (user.role === "ADMIN" && user.isActive) await this.assertNotLastAdmin();
    }

    const changes = diffFields(user, input);
    if (Object.keys(changes).length === 0) return user;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: input, select: staffSelect });
      await writeAudit(tx, { actorId: actor.id, action: "user.updated", entity: "User", entityId: id, changes });
      return updated as StaffUser;
    });
  }

  async deactivate(actor: AuthUser, id: string): Promise<StaffUser> {
    if (id === actor.id) throw new ForbiddenException("You can't deactivate your own account");
    const user = await this.findStaff(id);
    if (!user.isActive) return user; // already deactivated — nothing to do
    if (user.role === "ADMIN") await this.assertNotLastAdmin();

    return this.setActive(actor, id, false);
  }

  async reactivate(actor: AuthUser, id: string): Promise<StaffUser> {
    const user = await this.findStaff(id);
    if (user.isActive) return user; // already active — nothing to do
    return this.setActive(actor, id, true);
  }

  async resetPassword(actor: AuthUser, id: string, input: ResetPasswordInput): Promise<void> {
    await this.findStaff(id);
    const passwordHash = await bcrypt.hash(input.temporaryPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await writeAudit(tx, { actorId: actor.id, action: "user.passwordReset", entity: "User", entityId: id });
    });
  }

  private async setActive(actor: AuthUser, id: string, isActive: boolean): Promise<StaffUser> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { isActive }, select: staffSelect });
      await writeAudit(tx, {
        actorId: actor.id,
        action: isActive ? "user.reactivated" : "user.deactivated",
        entity: "User",
        entityId: id,
      });
      return updated as StaffUser;
    });
  }

  /** 404 for unknown ids and for customer accounts — they aren't managed here. */
  private async findStaff(id: string): Promise<StaffUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: staffSelect });
    if (!user || user.role === "CUSTOMER") throw new NotFoundException("Staff member not found");
    return user as StaffUser;
  }

  /** Called before an action would remove one active admin. */
  private async assertNotLastAdmin(): Promise<void> {
    const activeAdmins = await this.prisma.user.count({ where: { role: "ADMIN", isActive: true } });
    if (activeAdmins <= 1) {
      throw new ConflictException("There must always be at least one active administrator");
    }
  }
}
