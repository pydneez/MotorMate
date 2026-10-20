import type { AuthUser } from "@motormate/types";
import type { PrismaService } from "../src/prisma/prisma.service";

/** A jest.fn() for every Prisma method the services call, per model. */
function model() {
  return {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete: jest.fn(),
  };
}

/**
 * Minimal PrismaService mock for unit tests. `$transaction` supports both forms the
 * services use: an array of promises, and an interactive callback (run against the same mock).
 */
export function createPrismaMock() {
  const prisma = {
    user: model(),
    customer: model(),
    vehicle: model(),
    appointment: model(),
    // `fields` stands in for Prisma field references (e.g. quantityOnHand <= reorderLevel).
    inventoryItem: { ...model(), fields: { reorderLevel: "<ref:reorderLevel>" } },
    stockMovement: model(),
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof prisma) => unknown)(prisma),
  );
  return { prisma, service: prisma as unknown as PrismaService };
}

export type PrismaMock = ReturnType<typeof createPrismaMock>["prisma"];

export function makeAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "admin-1",
    email: "admin@motormate.example",
    firstName: "Somchai",
    lastName: "Jaidee",
    role: "ADMIN",
    customerId: null,
    ...overrides,
  };
}
