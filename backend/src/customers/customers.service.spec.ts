import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createPrismaMock, makeAuthUser } from "../../test/prisma-mock";
import { CustomersService } from "./customers.service";

const advisor = makeAuthUser({ id: "advisor-1", role: "ADVISOR" });

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cust-1",
    firstName: "Malee",
    lastName: "Srisuk",
    phone: "+66898765432",
    email: "malee.s@example.com",
    lineId: null,
    notes: null,
    userId: null,
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    _count: { vehicles: 1 },
    ...overrides,
  };
}

function setup() {
  const { prisma, service } = createPrismaMock();
  return { prisma, customers: new CustomersService(service) };
}

describe("CustomersService.list", () => {
  it("maps rows to summaries with vehicle count and portal flag", async () => {
    const { prisma, customers } = setup();
    prisma.customer.findMany.mockResolvedValue([customerRow({ userId: "u-1" })]);
    prisma.customer.count.mockResolvedValue(1);

    const result = await customers.list({ page: 1, pageSize: 20 });

    expect(result.items[0]).toEqual(expect.objectContaining({ vehicleCount: 1, hasPortalAccount: true }));
    expect(result.items[0]).not.toHaveProperty("_count");
  });

  it("matches an E.164-stored phone however the number is typed", async () => {
    const { prisma, customers } = setup();

    for (const typed of ["0898765432", "089-876-5432", "+66 89 876 5432"]) {
      prisma.customer.findMany.mockClear();
      await customers.list({ q: typed, page: 1, pageSize: 20 });
      const clause = prisma.customer.findMany.mock.calls[0][0].where.AND[0].OR;
      expect(clause).toContainEqual({ phone: { contains: "898765432" } });
    }
  });

  it("searches plates without spaces or dashes", async () => {
    const { prisma, customers } = setup();

    await customers.list({ q: "กข-1234", page: 1, pageSize: 20 });

    const clause = prisma.customer.findMany.mock.calls[0][0].where.AND[0].OR;
    expect(clause).toContainEqual({ vehicles: { some: { plateNormalized: { contains: "กข1234" } } } });
  });

  it("returns everything for an empty search and an empty page past the end", async () => {
    const { prisma, customers } = setup();
    prisma.customer.count.mockResolvedValue(3);

    const result = await customers.list({ page: 5, pageSize: 20 });

    expect(prisma.customer.findMany.mock.calls[0][0].where.AND).toEqual([]);
    expect(prisma.customer.findMany.mock.calls[0][0].skip).toBe(80);
    expect(result).toEqual({ items: [], total: 3, page: 5, pageSize: 20 });
  });
});

describe("CustomersService.create", () => {
  const input = { firstName: "Niran", lastName: "Wongsa", phone: "+6621234567" };

  it("creates a customer without an email (walk-in)", async () => {
    const { prisma, customers } = setup();
    prisma.customer.create.mockResolvedValue(customerRow({ ...input, email: null, _count: { vehicles: 0 } }));

    const result = await customers.create(advisor, input);

    expect(result.email).toBeNull();
    expect(prisma.customer.findFirst).not.toHaveBeenCalled(); // no email → no uniqueness check
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe("customer.created");
  });

  it("rejects an email that another customer already uses", async () => {
    const { prisma, customers } = setup();
    prisma.customer.findFirst.mockResolvedValue({ id: "cust-9" });

    await expect(customers.create(advisor, { ...input, email: "taken@example.com" })).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });
});

describe("CustomersService.update", () => {
  it("keeps a portal customer's login email in step with their record", async () => {
    const { prisma, customers } = setup();
    prisma.customer.findUnique.mockResolvedValue(customerRow({ userId: "u-1" }));
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.customer.update.mockResolvedValue(customerRow({ userId: "u-1", email: "new@example.com" }));

    await customers.update(advisor, "cust-1", { email: "new@example.com" });

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-1" }, data: { email: "new@example.com" } });
  });

  it("refuses an email that belongs to another login", async () => {
    const { prisma, customers } = setup();
    prisma.customer.findUnique.mockResolvedValue(customerRow({ userId: "u-1" }));
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({ id: "u-2" });

    await expect(customers.update(advisor, "cust-1", { email: "advisor@motormate.example" })).rejects.toThrow(
      ConflictException,
    );
  });

  it("refuses to clear the email of a portal customer", async () => {
    const { prisma, customers } = setup();
    prisma.customer.findUnique.mockResolvedValue(customerRow({ userId: "u-1" }));

    await expect(customers.update(advisor, "cust-1", { email: null })).rejects.toThrow(BadRequestException);
  });

  it("allows clearing the email of a walk-in customer", async () => {
    const { prisma, customers } = setup();
    prisma.customer.findUnique.mockResolvedValue(customerRow());
    prisma.customer.update.mockResolvedValue(customerRow({ email: null }));

    await expect(customers.update(advisor, "cust-1", { email: null })).resolves.toEqual(
      expect.objectContaining({ email: null }),
    );
  });

  it("returns not found for an unknown customer", async () => {
    const { prisma, customers } = setup();
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(customers.update(advisor, "nope", { firstName: "X" })).rejects.toThrow(NotFoundException);
  });
});

describe("CustomersService.duplicates", () => {
  it("normalizes the phone before matching and returns a warning, not an error", async () => {
    const { prisma, customers } = setup();
    prisma.customer.findMany.mockResolvedValue([customerRow()]);

    const result = await customers.duplicates({ phone: "089-876-5432" });

    expect(prisma.customer.findMany.mock.calls[0][0].where.phone).toBe("+66898765432");
    expect(result.byPhone).toHaveLength(1);
    expect(result.byEmail).toBeNull();
  });

  it("excludes the record being edited", async () => {
    const { prisma, customers } = setup();

    await customers.duplicates({ phone: "0898765432", excludeId: "cust-1" });

    expect(prisma.customer.findMany.mock.calls[0][0].where.id).toEqual({ not: "cust-1" });
  });

  it("skips the phone lookup for an invalid number", async () => {
    const { prisma, customers } = setup();

    await customers.duplicates({ phone: "12" });

    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });
});

describe("CustomersService own profile", () => {
  it("returns not found when a customer login has no linked record", async () => {
    const { customers } = setup();
    const unlinked = makeAuthUser({ role: "CUSTOMER", customerId: null });

    await expect(customers.findOwn(unlinked)).rejects.toThrow(NotFoundException);
    await expect(customers.updateOwn(unlinked, { phone: "+66811111111" })).rejects.toThrow(NotFoundException);
  });

  it("updates only the signed-in customer's own record", async () => {
    const { prisma, customers } = setup();
    const me = makeAuthUser({ id: "u-1", role: "CUSTOMER", customerId: "cust-1" });
    prisma.customer.findUnique.mockResolvedValue(customerRow({ userId: "u-1" }));
    prisma.customer.update.mockResolvedValue(customerRow({ userId: "u-1", lineId: "malee" }));

    await customers.updateOwn(me, { lineId: "malee" });

    expect(prisma.customer.update.mock.calls[0][0].where).toEqual({ id: "cust-1" });
  });
});
