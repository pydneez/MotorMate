import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";

const PASSWORD = "password123";
const SHOP = { id: "shop-1", name: "MotorMate Auto Service", isActive: true };

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "advisor@motormate.example",
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    firstName: "Alex",
    lastName: "Rivera",
    role: "ADVISOR",
    isActive: true,
    shopId: "shop-1",
    lastShopId: null,
    shop: SHOP,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    shop: { findUnique: jest.fn().mockResolvedValue(SHOP) },
    customer: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn() },
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
    expect(result.user).toEqual(expect.objectContaining({ id: "user-1", role: "ADVISOR", shopId: "shop-1", customerId: null }));
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: "user-1", email: "advisor@motormate.example", role: "ADVISOR", shopId: "shop-1" });
  });

  it("refuses staff of a suspended shop", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser({ shop: { ...SHOP, isActive: false } }));

    await expect(service.login({ email: "advisor@motormate.example", password: PASSWORD })).rejects.toThrow("suspended");
  });

  it("signs the platform admin in without a shop", async () => {
    const { prisma, jwt, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser({ role: "PLATFORM_ADMIN", shopId: null, shop: null }));

    const result = await service.login({ email: "advisor@motormate.example", password: PASSWORD });
    expect(result.user).toEqual(expect.objectContaining({ role: "PLATFORM_ADMIN", shopId: null }));
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ shopId: null }));
  });

  it("signs a customer into the shop they used last, if it's open", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser({ role: "CUSTOMER", shopId: null, shop: null, lastShopId: "shop-2" }));
    prisma.customer.findMany.mockResolvedValue([
      { id: "cust-a", shop: SHOP },
      { id: "cust-b", shop: { id: "shop-2", name: "Siam Garage", isActive: true } },
    ]);

    const result = await service.login({ email: "advisor@motormate.example", password: PASSWORD });
    expect(result.user).toEqual(expect.objectContaining({ shopId: "shop-2", shopName: "Siam Garage", customerId: "cust-b" }));
  });

  it("falls back to a customer's open shop when the last one is suspended", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser({ role: "CUSTOMER", shopId: null, shop: null, lastShopId: "shop-2" }));
    prisma.customer.findMany.mockResolvedValue([
      { id: "cust-a", shop: SHOP },
      { id: "cust-b", shop: { id: "shop-2", name: "Siam Garage", isActive: false } },
    ]);

    const result = await service.login({ email: "advisor@motormate.example", password: PASSWORD });
    expect(result.user).toEqual(expect.objectContaining({ shopId: "shop-1", customerId: "cust-a" }));
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
    shopId: "shop-1",
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
    prisma.customer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "cust-1", userId: null, phone: input.phone, lineId: null });
    prisma.user.create.mockResolvedValue(makeUser({ id: "user-2", email: input.email, role: "CUSTOMER" }));
    prisma.customer.update.mockResolvedValue({ id: "cust-1" });

    const result = await service.register(input);

    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cust-1" }, data: expect.objectContaining({ userId: "user-2" }) }),
    );
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(result.user).toEqual(expect.objectContaining({ customerId: "cust-1", shopId: "shop-1" }));
  });

  it("refuses to link when the email matches but the phone does not", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.customer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "cust-1", userId: null, phone: "+66811111111", lineId: null });

    await expect(service.register(input)).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("creates a new customer when the email is not on file", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(makeUser({ id: "user-3", email: input.email, role: "CUSTOMER" }));
    prisma.customer.create.mockResolvedValue({ id: "cust-new" });

    const result = await service.register(input);

    expect(prisma.customer.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ shopId: "shop-1", userId: "user-3" }));
    expect(prisma.user.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ role: "CUSTOMER", lastShopId: "shop-1" }));
    expect(result.user).toEqual(expect.objectContaining({ role: "CUSTOMER", customerId: "cust-new" }));
  });

  it("refuses a shop that doesn't exist or is suspended, as a shop field error", async () => {
    const { prisma, service } = setup();
    prisma.shop.findUnique.mockResolvedValue({ ...SHOP, isActive: false });

    const error = await service.register(input).catch((e) => e);
    expect(error.getResponse().errors.shopId).toBeDefined();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejects an email that already has a login", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());

    await expect(service.register(input)).rejects.toThrow(ConflictException);
  });

  it("rejects a phone that is already linked to an online account, as a phone field error", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.customer.findFirst.mockResolvedValue({ id: "cust-with-login" });

    const error = await service.register({ ...input, email: "second.account@example.com" }).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().errors.phone[0]).toContain("already linked to an online account");
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: input.phone, userId: { not: null } } }),
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("still allows sign-up when the phone only matches a shop record without a login", async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.customer.findFirst.mockResolvedValue(null); // the walk-in record has no login
    prisma.user.create.mockResolvedValue(makeUser({ id: "user-4", email: input.email, role: "CUSTOMER" }));
    prisma.customer.create.mockResolvedValue({ id: "cust-new" });

    await expect(service.register(input)).resolves.toEqual(expect.objectContaining({ accessToken: "signed-token" }));
  });
});
