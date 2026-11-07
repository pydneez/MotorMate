import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { testDatabaseUrl } from "./integration-env";
import { createTestShop, shopOf, TEST_SHOP_ID, testNumber } from "./test-shop";

/** Reports over real HTTP + Postgres: exact totals for a Bangkok month, repeat customers, CSV, roles. */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");

const PASSWORD = "password123";
const OCTOBER = "from=2026-10-01&to=2026-10-31";

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const tokens: Record<"admin" | "advisor" | "mechanic" | "customer", string> = {} as never;

async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

const get = (token: string, url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();
  await createTestShop(prisma);

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const users = {} as Record<keyof typeof tokens, { id: string }>;
  for (const [key, role] of [["admin", "ADMIN"], ["advisor", "ADVISOR"], ["mechanic", "MECHANIC"], ["customer", "CUSTOMER"]] as const) {
    users[key] = await prisma.user.create({
      data: { email: `${key}@reports.test`, role, firstName: key === "mechanic" ? "Sam" : "Test", lastName: "Reports", passwordHash, ...shopOf(role) },
    });
    // A customer signs in through their Customer record in a shop.
    if (role === "CUSTOMER") {
      await prisma.customer.create({ data: { shopId: TEST_SHOP_ID, firstName: "Test", lastName: "Reports", phone: "+66810000099", userId: users[key].id } });
    }
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email: `${key}@reports.test`, password: PASSWORD }).expect(200);
    tokens[key] = res.body.accessToken;
  }

  const vehicleFor = async (name: string, phone: string, vin: string) => {
    const customer = await prisma.customer.create({ data: { shopId: TEST_SHOP_ID, firstName: name, lastName: "Reports", phone } });
    return prisma.vehicle.create({
      data: { shopId: TEST_SHOP_ID, customerId: customer.id, vin, plate: "1กข 1234", plateNormalized: "1กข1234", province: "กรุงเทพมหานคร", make: "Honda", model: "City", year: 2020, mileage: 50000 },
    });
  };
  const returning = await vehicleFor("Ann", "+66810000001", "VINREPORTS0000001");
  const firstVisit = await vehicleFor("Ben", "+66810000002", "VINREPORTS0000002");

  // One completed job with its invoice; `at` is both completion and issue time.
  const job = async (vehicleId: string, at: string, subtotal: number, status: "PAID" | "UNPAID", mechanicId?: string) => {
    const done = new Date(at);
    const workOrder = await prisma.workOrder.create({
      data: { shopId: TEST_SHOP_ID, number: await testNumber(prisma, "workOrder"), vehicleId, mileageIn: 50000, complaint: "Service", status: "COMPLETED", completedAt: done, createdById: users.admin.id, mechanicId, createdAt: done },
    });
    await prisma.serviceItem.create({ data: { workOrderId: workOrder.id, description: "Labour", laborCost: subtotal } });
    const vat = Math.round(subtotal * 7) / 100;
    await prisma.invoice.create({
      data: { shopId: TEST_SHOP_ID, number: await testNumber(prisma, "invoice"), workOrderId: workOrder.id, subtotal, vatAmount: vat, total: subtotal + vat, status, issuedAt: done, paidAt: status === "PAID" ? done : null },
    });
  };
  await job(returning.id, "2026-09-20T03:00:00Z", 100, "PAID"); // September — outside, but makes Ann a returning customer
  await job(returning.id, "2026-10-10T03:00:00Z", 1000, "PAID", users.mechanic.id);
  await job(firstVisit.id, "2026-10-31T16:30:00Z", 500, "UNPAID"); // 31 Oct 23:30 Bangkok — inside
  await job(firstVisit.id, "2026-10-31T17:30:00Z", 200, "UNPAID"); // 1 Nov 00:30 Bangkok — outside
});

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("reports", () => {
  it("adds up October in Bangkok time", async () => {
    const { body } = await get(tokens.admin, `/reports/summary?${OCTOBER}`).expect(200);
    expect(body.range).toEqual({ from: "2026-10-01", to: "2026-10-31", days: 31, bucket: "day" });
    expect(body.revenue).toEqual(
      expect.objectContaining({
        invoiceCount: 2,
        subtotal: 1500,
        vat: 105,
        total: 1605,
        paid: { count: 1, total: 1070 },
        unpaid: { count: 1, total: 535 },
        labour: 1500,
        parts: 0,
      }),
    );
    expect(body.revenue.series).toHaveLength(31);
    expect(body.revenue.series.find((day: { start: string }) => day.start === "2026-10-31")).toEqual({ start: "2026-10-31", total: 535, count: 1 });
    expect(body.jobs.completed).toBe(2);
    expect(body.jobs.mechanics).toEqual([expect.objectContaining({ name: "Sam Reports", completed: 1, labour: 1000 })]);
  });

  it("counts a customer with an earlier completed job as a repeat customer", async () => {
    const { body } = await get(tokens.admin, `/reports/summary?${OCTOBER}`).expect(200);
    expect(body.bookings).toEqual(expect.objectContaining({ servedCustomers: 2, repeatCustomers: 1, repeatRate: 0.5 }));

    const september = await get(tokens.admin, "/reports/summary?from=2026-09-01&to=2026-09-30").expect(200);
    expect(september.body.bookings).toEqual(expect.objectContaining({ servedCustomers: 1, repeatCustomers: 0, repeatRate: 0 }));
  });

  it("returns the same totals from the light revenue endpoint", async () => {
    const { body } = await get(tokens.admin, `/reports/revenue?${OCTOBER}`).expect(200);
    expect(body).toEqual({ invoiceCount: 2, total: 1605, paid: { count: 1, total: 1070 }, unpaid: { count: 1, total: 535 } });
  });

  it("exports invoices as an Excel-friendly CSV", async () => {
    const res = await get(tokens.admin, `/reports/export/invoices?${OCTOBER}`).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="motormate-invoices-2026-10-01_2026-10-31.csv"');
    expect(res.text.startsWith("﻿")).toBe(true);
    const lines = res.text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Invoice,Work order,Issued,Status,Customer,Phone,Plate,Province,Vehicle,Subtotal,VAT,Total,Paid at");
    expect(lines.slice(1)).toEqual([expect.stringMatching(/^INV-0002,WO-0002,2026-10-10 10:00,Paid,Ann Reports,081-000-0001,1กข 1234,/), expect.stringMatching(/^INV-0003,WO-0003,2026-10-31 23:30,Unpaid,/)]);
  });

  it("rejects unknown exports and bad ranges", async () => {
    await get(tokens.admin, `/reports/export/customers?${OCTOBER}`).expect(400);
    await get(tokens.admin, "/reports/summary?from=2026-10-31&to=2026-10-01").expect(400);
    await get(tokens.admin, "/reports/revenue?from=2025-01-01&to=2026-10-31").expect(400);
  });

  it("counts price-list services by service, custom lines together, and has no turnover without stock", async () => {
    // A list service on another October job, renamed since; 0 so the totals above don't move.
    const job = await prisma.workOrder.findFirstOrThrow({ where: { number: 3 } });
    const service = await prisma.serviceCatalogItem.create({ data: { shopId: TEST_SHOP_ID, name: "Oil change", category: "Maintenance", price: 0 } });
    await prisma.serviceItem.create({ data: { workOrderId: job.id, description: "Oil change", laborCost: 0, catalogItemId: service.id } });
    await prisma.serviceCatalogItem.update({ where: { id: service.id }, data: { name: "Oil & filter change" } });

    const { body } = await get(tokens.admin, `/reports/summary?${OCTOBER}`).expect(200);
    expect(body.jobs.topLabour).toEqual([
      { description: "Oil & filter change", count: 1, amount: 0, custom: false },
      { description: "Other (custom lines)", count: 2, amount: 1500, custom: true },
    ]);
    expect(body.parts).toEqual(expect.objectContaining({ costOfPartsUsed: 0, stockValueAtCost: 0, turnover: null }));
  });

  it.each(["advisor", "mechanic", "customer"] as const)("is admin only (%s gets 403)", async (role) => {
    await get(tokens[role], `/reports/summary?${OCTOBER}`).expect(403);
    await get(tokens[role], `/reports/revenue?${OCTOBER}`).expect(403);
    await get(tokens[role], `/reports/export/invoices?${OCTOBER}`).expect(403);
  });
});
