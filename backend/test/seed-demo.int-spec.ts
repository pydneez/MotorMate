import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { bangkokParts, calculateTotals, SHOP, UPCOMING_APPOINTMENT_STATUSES } from "@motormate/types";
import { testDatabaseUrl } from "./integration-env";

/** The demo seed (prisma/seed-demo.ts) on an empty database: it must follow the app's own rules. */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");
const { seedDemo } = require("../prisma/seed-demo") as typeof import("../prisma/seed-demo");

// Wednesday 4 Nov 2026, 10:00 in Bangkok.
const NOW = new Date("2026-11-04T03:00:00.000Z");
const OPEN = ["CHECKED_IN", "DIAGNOSING", "AWAITING_PARTS", "IN_PROGRESS", "QUALITY_CHECK"];

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;

async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();
  await expect(seedDemo(prisma, NOW)).resolves.toEqual({ skipped: false, workOrders: 50 });
}, 120_000);

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("demo seed", () => {
  it("runs only once", async () => {
    await expect(seedDemo(prisma, NOW)).resolves.toEqual({ skipped: true, workOrders: 0 });
    // 50 at the main shop, 3 at the second shop (Siam Garage).
    expect(await prisma.workOrder.count()).toBe(53);
  });

  it("invoices every completed job with totals that match its lines, and nothing else", async () => {
    const jobs = await prisma.workOrder.findMany({ include: { serviceItems: true, partsUsed: true, invoice: true } });
    const completed = jobs.filter((job) => job.status === "COMPLETED");
    expect(completed).toHaveLength(48);
    for (const job of jobs) {
      if (job.status !== "COMPLETED") {
        expect(job.invoice).toBeNull();
        continue;
      }
      const totals = calculateTotals(
        job.serviceItems.map((item) => Number(item.laborCost)),
        job.partsUsed.map((part) => ({ quantity: part.quantity, unitPrice: Number(part.unitPrice) })),
      );
      expect(job.invoice).not.toBeNull();
      expect([Number(job.invoice!.subtotal), Number(job.invoice!.vatAmount), Number(job.invoice!.total)]).toEqual([totals.subtotal, totals.vat, totals.total]);
      expect(job.completedAt!.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(job.invoice!.issuedAt.getTime()).toBe(job.completedAt!.getTime());
    }
    const unpaid = completed.filter((job) => job.invoice!.status === "UNPAID");
    expect(unpaid.length).toBeGreaterThan(0);
    expect(unpaid.length).toBeLessThan(completed.length / 3);
  });

  it("has one open job at each step, never two on one vehicle", async () => {
    const open = await prisma.workOrder.findMany({ where: { status: { in: OPEN as never } } });
    expect(open.map((job) => job.status).sort()).toEqual([...OPEN].sort());
    expect(new Set(open.map((job) => job.vehicleId)).size).toBe(open.length);
  });

  it("only changes stock through movements, and never below zero", async () => {
    const items = await prisma.inventoryItem.findMany({ include: { stockMovements: true } });
    for (const item of items) {
      expect(item.quantityOnHand).toBe(item.stockMovements.reduce((sum, move) => sum + move.quantityChange, 0));
      expect(item.quantityOnHand).toBeGreaterThanOrEqual(0);
    }
    const used = await prisma.partUsed.aggregate({ _sum: { quantity: true } });
    const out = await prisma.stockMovement.aggregate({ where: { reason: "WORK_ORDER" }, _sum: { quantityChange: true } });
    expect(out._sum.quantityChange).toBe(-(used._sum.quantity ?? 0));
    expect(items.filter((item) => item.quantityOnHand <= item.reorderLevel).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps mileage going up visit by visit, ending at the vehicle's reading", async () => {
    const vehicles = await prisma.vehicle.findMany({ include: { workOrders: { orderBy: { createdAt: "asc" } } } });
    for (const vehicle of vehicles) {
      const readings = vehicle.workOrders.map((job) => job.mileageIn);
      expect(readings).toEqual([...readings].sort((a, b) => a - b));
      expect(vehicle.mileage).toBe(Math.max(...readings));
    }
  });

  it("books appointments on shop slots, one upcoming per vehicle, requests only from customers", async () => {
    const appointments = await prisma.appointment.findMany();
    const statuses = new Set(appointments.map((a) => a.status));
    for (const status of ["REQUESTED", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED"]) expect(statuses).toContain(status);
    for (const a of appointments) {
      const { time, weekday } = bangkokParts(a.scheduledAt);
      expect(SHOP.hours.weekdays as readonly number[]).toContain(weekday);
      expect(time >= SHOP.hours.open && time < SHOP.hours.close && /:(00|30)$/.test(time)).toBe(true);
    }
    const upcoming = appointments.filter((a) => (UPCOMING_APPOINTMENT_STATUSES as readonly string[]).includes(a.status));
    expect(upcoming.every((a) => a.scheduledAt > NOW)).toBe(true);
    expect(new Set(upcoming.map((a) => a.vehicleId)).size).toBe(upcoming.length);
    const customerLogins = new Set((await prisma.user.findMany({ where: { role: "CUSTOMER" } })).map((u) => u.id));
    for (const a of appointments.filter((a) => a.status === "REQUESTED")) expect(customerLogins).toContain(a.createdById);
    for (const a of appointments.filter((a) => a.status === "CHECKED_IN" || a.status === "COMPLETED")) expect(a.workOrderId).not.toBeNull();
  });

  it("links the routine labour lines to the price list, at its prices", async () => {
    const linked = await prisma.serviceItem.findMany({ where: { catalogItemId: { not: null } }, include: { catalogItem: true } });
    expect(linked.length).toBeGreaterThan(20);
    for (const line of linked) {
      expect(line.description).toBe(line.catalogItem!.name);
      expect(Number(line.laborCost)).toBe(Number(line.catalogItem!.price));
    }
    // Each shop has its own price list, and its jobs only use that shop's services.
    expect(await prisma.serviceCatalogItem.groupBy({ by: ["shopId"], _count: { _all: true }, orderBy: { shopId: "asc" } })).toEqual([
      { shopId: "shop_main", _count: { _all: 8 } },
      { shopId: "shop_siam", _count: { _all: 8 } },
    ]);
    const jobShops = await prisma.serviceItem.findMany({
      where: { catalogItemId: { not: null } },
      select: { workOrder: { select: { shopId: true } }, catalogItem: { select: { shopId: true } } },
    });
    for (const line of jobShops) expect(line.catalogItem!.shopId).toBe(line.workOrder.shopId);
  });

  it("numbers each shop's work orders and invoices from 1, with the counters in step", async () => {
    for (const shop of await prisma.shop.findMany()) {
      const jobs = await prisma.workOrder.findMany({ where: { shopId: shop.id }, select: { number: true }, orderBy: { number: "asc" } });
      expect(jobs.map((job) => job.number)).toEqual(jobs.map((_, i) => i + 1));
      expect(shop.lastWorkOrderNumber).toBe(jobs.length);
      expect(shop.lastInvoiceNumber).toBe(await prisma.invoice.count({ where: { shopId: shop.id } }));
    }
  });

  it("gives the reports and reminders something to show", async () => {
    const login = await request(app.getHttpServer()).post("/auth/login").send({ email: "admin@motormate.example", password: "password123" }).expect(200);
    const { body } = await request(app.getHttpServer())
      .get("/reports/summary?from=2026-05-08&to=2026-11-04")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(body.revenue.invoiceCount).toBe(45);
    expect(body.revenue.series.filter((month: { count: number }) => month.count > 0).length).toBeGreaterThanOrEqual(5);
    expect(body.jobs.mechanics).toHaveLength(2);
    expect(body.bookings.repeatCustomers).toBeGreaterThan(0);
    expect(body.parts.turnover).toBeGreaterThan(0);
    expect(body.jobs.topLabour.length).toBeGreaterThanOrEqual(5);
    // Routine jobs come from the price list; the suspension work and brake fluid stay custom lines.
    expect(body.jobs.topLabour.filter((line: { custom: boolean }) => !line.custom).length).toBeGreaterThanOrEqual(5);
    expect(body.jobs.topLabour.at(-1)).toEqual(expect.objectContaining({ description: "Other (custom lines)", custom: true }));
    const states = await prisma.serviceRecommendation.groupBy({ by: ["status"], _count: { _all: true } });
    expect(states.map((s) => s.status).sort()).toEqual(["DISMISSED", "OPEN", "REMINDED"]);
  });

  it("adds the second shop to a database seeded before multi-shop", async () => {
    // What the demo account looked like: the main shop's history, no Siam Garage.
    const siam = { workOrder: { shopId: "shop_siam" } };
    await prisma.invoice.deleteMany({ where: { shopId: "shop_siam" } });
    await prisma.serviceItem.deleteMany({ where: siam });
    await prisma.workOrderStatusChange.deleteMany({ where: siam });
    await prisma.workOrder.deleteMany({ where: { shopId: "shop_siam" } });
    await prisma.vehicle.deleteMany({ where: { shopId: "shop_siam" } });
    await prisma.customer.deleteMany({ where: { shopId: "shop_siam" } });
    await prisma.serviceCatalogItem.deleteMany({ where: { shopId: "shop_siam" } });
    await prisma.user.deleteMany({ where: { shopId: "shop_siam" } });
    await prisma.shop.delete({ where: { id: "shop_siam" } });

    await expect(seedDemo(prisma, NOW)).resolves.toEqual({ skipped: false, workOrders: 3 });
    expect(await prisma.workOrder.count({ where: { shopId: "shop_siam" } })).toBe(3);
    expect(await prisma.workOrder.count({ where: { shopId: "shop_main" } })).toBe(50);
    await expect(seedDemo(prisma, NOW)).resolves.toEqual({ skipped: true, workOrders: 0 });
  });
});
