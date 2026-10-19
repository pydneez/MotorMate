import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";

const PASSWORD = "password123";

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "advisor@motormate.example",
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    firstName: "Alex",
    lastName: "Rivera",
    role: "ADVISOR",
    isActive: true,
    customer: null,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    customer: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  // Run transaction callbacks against the same mock.
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const jwt = { signAsync: jest.fn().mockResolvedValue("signed-token") };
  const service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);
  return { prisma, jwt, service };
}

describe("AuthService.login", () => {
  it("returns a token and the user for correct credentials", async () => {
    const { prisma, jwt, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());

    const result = await service.login({ email: "advisor@motormate.example", password: PASSWORD });

    expect(result.accessToken).toBe("signed-token");
    expect(result.user).toEqual(expect.objectContaining({ id: "user-1", role: "ADVISOR", customerId: null }));
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: "user-1", email: "advisor@motormate.example", role: "ADVISOR" });
  });

  it("rejects a wrong password with the same error as an unknown email", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValueOnce(makeUser()).mockResolvedValueOnce(null);

    const wrongPassword = service.login({ email: "advisor@motormate.example", password: "nope" });
    await expect(wrongPassword).rejects.toThrow(UnauthorizedException);
    await expect(service.login({ email: "ghost@example.com", password: PASSWORD })).rejects.toThrow(
      "Invalid email or password",
    );
  });

  it("rejects a deactivated account even with the right password", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser({ isActive: false }));

    await expect(service.login({ email: "advisor@motormate.example", password: PASSWORD })).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe("AuthService.register", () => {
  const input = {
    firstName: "Malee",
    lastName: "Srisuk",
    email: "malee.s@example.com",
    phone: "+66898765432",
    lineId: undefined,
    password: PASSWORD,
  };

  it("links to a shop-created customer when email AND phone match", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue({ id: "cust-1", userId: null, phone: input.phone, lineId: null });
    prisma.user.create.mockResolvedValue(makeUser({ id: "user-2", email: input.email, role: "CUSTOMER" }));
    prisma.customer.update.mockResolvedValue({ id: "cust-1" });

    const result = await service.register(input);

    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cust-1" }, data: expect.objectContaining({ userId: "user-2" }) }),
    );
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(result.user.customerId).toBe("cust-1");
  });

  it("refuses to link when the email matches but the phone does not", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue({ id: "cust-1", userId: null, phone: "+66811111111", lineId: null });

    await expect(service.register(input)).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("creates a new customer when the email is not on file", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.customer.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(makeUser({ id: "user-3", email: input.email, role: "CUSTOMER" }));
    prisma.customer.create.mockResolvedValue({ id: "cust-new" });

    const result = await service.register(input);

    expect(prisma.customer.create).toHaveBeenCalled();
    expect(result.user).toEqual(expect.objectContaining({ role: "CUSTOMER", customerId: "cust-new" }));
  });

  it("rejects an email that already has a login", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());

    await expect(service.register(input)).rejects.toThrow(ConflictException);
  });
});
