import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { createPrismaMock, makeAuthUser, type PrismaMock } from "../../test/prisma-mock";
import { UsersService } from "./users.service";

const admin = makeAuthUser();

function staff(overrides: Record<string, unknown> = {}) {
  return {
    id: "advisor-1",
    email: "advisor@motormate.example",
    firstName: "Alex",
    lastName: "Rivera",
    role: "ADVISOR",
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date("2026-10-01"),
    ...overrides,
  };
}

function setup() {
  const { prisma, service } = createPrismaMock();
  return { prisma, users: new UsersService(service) };
}

function lastAudit(prisma: PrismaMock) {
  return prisma.auditLog.create.mock.calls.at(-1)?.[0].data;
}

describe("UsersService.list", () => {
  it("lists only active staff by default and never customers", async () => {
    const { prisma, users } = setup();
    prisma.user.findMany.mockResolvedValue([staff()]);
    prisma.user.count.mockResolvedValue(1);

    const result = await users.list({ page: 1, pageSize: 20 });

    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.role).toEqual({ in: ["ADMIN", "ADVISOR", "MECHANIC"] });
    expect(where.isActive).toBe(true);
    expect(result).toEqual({ items: [staff()], total: 1, page: 1, pageSize: 20 });
  });

  it("includes deactivated staff and filters by role when asked", async () => {
    const { prisma, users } = setup();
    await users.list({ page: 2, pageSize: 10, role: "MECHANIC", includeInactive: true, q: "sam nguyen" });

    const args = prisma.user.findMany.mock.calls[0][0];
    expect(args.where.role).toBe("MECHANIC");
    expect(args.where.isActive).toBeUndefined();
    expect(args.where.AND).toHaveLength(2); // one clause per search word
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });
});

describe("UsersService.create", () => {
  const input = {
    firstName: "Nok",
    lastName: "Chai",
    email: "nok@motormate.example",
    role: "MECHANIC" as const,
    temporaryPassword: "temp-pass-1",
  };

  it.each(["ADMIN", "ADVISOR", "MECHANIC"] as const)("creates a %s with a hashed temporary password", async (role) => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(({ data }) => Promise.resolve(staff({ ...data, id: "new-1" })));

    await users.create(admin, { ...input, role });

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.role).toBe(role);
    expect(data.passwordHash).not.toBe(input.temporaryPassword);
    expect(await bcrypt.compare(input.temporaryPassword, data.passwordHash)).toBe(true);
    expect(lastAudit(prisma)).toEqual(expect.objectContaining({ action: "user.created", actorId: admin.id }));
  });

  it("rejects an email that is already used by any account", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff());

    await expect(users.create(admin, input)).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("UsersService.update", () => {
  it("renames a staff member and records only the changed fields", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff());
    prisma.user.update.mockResolvedValue(staff({ firstName: "Alexa" }));

    await users.update(admin, "advisor-1", { firstName: "Alexa", lastName: "Rivera" });

    expect(lastAudit(prisma).changes).toEqual({ firstName: { from: "Alex", to: "Alexa" } });
  });

  it("does nothing when no field actually changes", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff());

    await users.update(admin, "advisor-1", { firstName: "Alex" });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("blocks an admin from changing their own role", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff({ id: admin.id, role: "ADMIN" }));

    await expect(users.update(admin, admin.id, { role: "ADVISOR" })).rejects.toThrow(ForbiddenException);
  });

  it("blocks demoting the last active admin", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff({ id: "admin-2", role: "ADMIN" }));
    prisma.user.count.mockResolvedValue(1);

    await expect(users.update(admin, "admin-2", { role: "MECHANIC" })).rejects.toThrow(ConflictException);
  });

  it("allows demoting an admin when another active admin remains", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff({ id: "admin-2", role: "ADMIN" }));
    prisma.user.count.mockResolvedValue(2);
    prisma.user.update.mockResolvedValue(staff({ id: "admin-2", role: "MECHANIC" }));

    await expect(users.update(admin, "admin-2", { role: "MECHANIC" })).resolves.toEqual(
      expect.objectContaining({ role: "MECHANIC" }),
    );
  });

  it("treats a customer account as not found", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff({ role: "CUSTOMER" }));

    await expect(users.update(admin, "advisor-1", { firstName: "X" })).rejects.toThrow(NotFoundException);
  });

  it("returns not found for an unknown id", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(users.update(admin, "nope", { firstName: "X" })).rejects.toThrow(NotFoundException);
  });
});

describe("UsersService.deactivate / reactivate", () => {
  it("deactivates a staff member and audits it", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff());
    prisma.user.update.mockResolvedValue(staff({ isActive: false }));

    const result = await users.deactivate(admin, "advisor-1");

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ isActive: false });
    expect(result.isActive).toBe(false);
    expect(lastAudit(prisma).action).toBe("user.deactivated");
  });

  it("blocks an admin from deactivating themselves", async () => {
    const { prisma, users } = setup();

    await expect(users.deactivate(admin, admin.id)).rejects.toThrow(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("blocks deactivating the last active admin", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff({ id: "admin-2", role: "ADMIN" }));
    prisma.user.count.mockResolvedValue(1);

    await expect(users.deactivate(admin, "admin-2")).rejects.toThrow(ConflictException);
  });

  it("is a no-op for an already deactivated user", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff({ isActive: false }));

    await expect(users.deactivate(admin, "advisor-1")).resolves.toEqual(expect.objectContaining({ isActive: false }));
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("reactivates a deactivated user", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff({ isActive: false }));
    prisma.user.update.mockResolvedValue(staff({ isActive: true }));

    await users.reactivate(admin, "advisor-1");

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ isActive: true });
    expect(lastAudit(prisma).action).toBe("user.reactivated");
  });

  it("is a no-op when reactivating an already active user", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff());

    await users.reactivate(admin, "advisor-1");

    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("UsersService.resetPassword", () => {
  it("stores a new hash and audits without the password", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff());

    await users.resetPassword(admin, "advisor-1", { temporaryPassword: "new-temp-123" });

    const { passwordHash } = prisma.user.update.mock.calls[0][0].data;
    expect(await bcrypt.compare("new-temp-123", passwordHash)).toBe(true);
    const audit = lastAudit(prisma);
    expect(audit.action).toBe("user.passwordReset");
    expect(JSON.stringify(audit)).not.toContain("new-temp-123");
  });

  it("refuses to reset a customer's password through staff management", async () => {
    const { prisma, users } = setup();
    prisma.user.findUnique.mockResolvedValue(staff({ role: "CUSTOMER" }));

    await expect(users.resetPassword(admin, "advisor-1", { temporaryPassword: "new-temp-123" })).rejects.toThrow(
      NotFoundException,
    );
  });
});
