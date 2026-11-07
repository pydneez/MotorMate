import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { bangkokParts, SHOP } from "@motormate/types";
import { testDatabaseUrl } from "./integration-env";
import { createTestShop, shopOf, TEST_SHOP_ID } from "./test-shop";

/**
 * Settings over real HTTP + Postgres: shop details, the price list, services booked with an
 * appointment becoming the job's labour lines, and who may change a list price.
 */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");

const PASSWORD = "password123";

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const tokens: Record<"admin" | "advisor" | "sam" | "jordan", string> = {} as never;
const ids: Record<string, string> = {};

async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

function api(token: string) {
  const server = app.getHttpServer();
  return {
    get: (url: string) => request(server).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string, body?: object) => request(server).post(url).set("Authorization", `Bearer ${token}`).send(body),
    patch: (url: string, body?: object) => request(server).patch(url).set("Authorization", `Bearer ${token}`).send(body),
  };
}

/** The next shop day at least two days away (Bangkok), as yyyy-mm-dd. */
function shopDay(): string {
  for (let days = 2; ; days++) {
    const { date, weekday } = bangkokParts(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
    if ((SHOP.hours.weekdays as readonly number[]).includes(weekday)) return date;
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();
  await createTestShop(prisma);

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = (email: string, role: "ADMIN" | "ADVISOR" | "MECHANIC" | "CUSTOMER", firstName: string) =>
    prisma.user.create({ data: { email, role, firstName, lastName: "Test", passwordHash, ...shopOf(role) } });
  await user("admin@price.test", "ADMIN", "Ada");
  await user("advisor@price.test", "ADVISOR", "Alex");
  ids.sam = (await user("sam@price.test", "MECHANIC", "Sam")).id;
  const jordanUser = await user("jordan@price.test", "CUSTOMER", "Jordan");

  const jordan = await prisma.customer.create({ data: { shopId: TEST_SHOP_ID, firstName: "Jordan", lastName: "Lee", phone: "+66812345678", userId: jordanUser.id } });
  ids.civic = (
    await prisma.vehicle.create({
      data: { shopId: TEST_SHOP_ID,
        customerId: jordan.id,
        vin: "MRHFC1650KP000201",
        plate: "1กข 1234",
        plateNormalized: "1กข1234",
        province: "กรุงเทพมหานคร",
        make: "Honda",
        model: "Civic",
        year: 2019,
        mileage: 42000,
      },
    })
  ).id;

  for (const key of ["admin", "advisor", "sam", "jordan"] as const) {
    tokens[key] = (await request(app.getHttpServer()).post("/auth/login").send({ email: `${key}@price.test`, password: PASSWORD }).expect(200)).body
      .accessToken;
  }
});

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("shop details", () => {
  const details = { name: "Siam Garage", address: "1 Rama IV Road\nBangkok 10500", phone: "081-234-5678", email: "", taxId: "0-1055-12345-67-8" };

  it("shows the shop's own details (from its registration) to anyone signed in", async () => {
    expect((await api(tokens.jordan).get("/settings/shop").expect(200)).body).toEqual({
      name: "Test Garage", address: "1 Test Road\nBangkok 10110", phone: "+6621234567", email: null, taxId: "0-1055-12345-67-8",
    });
    await api(tokens.advisor).patch("/settings/shop", details).expect(403);
    const bad = await api(tokens.admin).patch("/settings/shop", { ...details, taxId: "123" }).expect(400);
    expect(bad.body.errors.taxId).toBeDefined();
  });

  it("saves them (phone stored as E.164), audited", async () => {
    const res = await api(tokens.admin).patch("/settings/shop", details).expect(200);
    expect(res.body).toEqual({ ...details, phone: "+66812345678", email: null });
    expect((await api(tokens.sam).get("/settings/shop").expect(200)).body.name).toBe("Siam Garage");
    expect(await prisma.auditLog.count({ where: { action: "settings.shopUpdated" } })).toBe(1);
  });
});

describe("price list", () => {
  it("is managed by admins only, with unique names", async () => {
    await api(tokens.advisor).post("/services", { name: "Oil change", category: "Maintenance", price: 450 }).expect(403);
    ids.oil = (await api(tokens.admin).post("/services", { name: "Oil change", category: "Maintenance", price: 450 }).expect(201)).body.id;
    ids.ac = (await api(tokens.admin).post("/services", { name: "A/C regas", category: "Air-con", price: 1200, bookable: false }).expect(201)).body.id;
    const taken = await api(tokens.admin).post("/services", { name: "OIL CHANGE", category: "Maintenance", price: 1 }).expect(409);
    expect(taken.body.errors.name).toBeDefined();
  });

  it("shows customers only what they can book", async () => {
    expect((await api(tokens.jordan).get("/services").expect(200)).body.map((s: { name: string }) => s.name)).toEqual(["Oil change"]);
    expect((await api(tokens.sam).get("/services").expect(200)).body).toHaveLength(2);
  });
});

describe("booking services → the job's labour", () => {
  let workOrderId = "";

  it("snapshots the services and their prices on the appointment", async () => {
    await api(tokens.jordan).post("/appointments", { vehicleId: ids.civic, date: shopDay(), time: "10:00", serviceIds: [ids.ac] }).expect(400);
    const res = await api(tokens.jordan).post("/appointments", { vehicleId: ids.civic, date: shopDay(), time: "10:00", serviceIds: [ids.oil] }).expect(201);
    expect(res.body).toEqual(expect.objectContaining({ reason: "Oil change", services: [{ id: ids.oil, name: "Oil change", price: 450 }] }));
    ids.appointment = res.body.id;

    // A later price change doesn't touch what the customer was quoted.
    await api(tokens.admin).patch(`/services/${ids.oil}`, { price: 500 }).expect(200);
    expect((await api(tokens.jordan).get(`/appointments/${ids.appointment}`).expect(200)).body.services[0].price).toBe(450);
  });

  it("turns the booked services into labour lines at check-in, at the quoted price", async () => {
    const res = await api(tokens.advisor)
      .post("/work-orders", { vehicleId: ids.civic, mileageIn: 43000, complaint: "Oil change", appointmentId: ids.appointment, mechanicId: ids.sam })
      .expect(201);
    workOrderId = res.body.id;
    expect(res.body.labour).toEqual([expect.objectContaining({ description: "Oil change", laborCost: 450, catalogItemId: ids.oil })]);
  });

  it("takes list prices as they are now; only staff may change one", async () => {
    const listed = await api(tokens.sam).post(`/work-orders/${workOrderId}/labour`, { catalogItemId: ids.oil }).expect(201);
    expect(listed.body.labour.at(-1)).toEqual(
      expect.objectContaining({ laborCost: 500, catalogItemId: ids.oil, addedBy: expect.objectContaining({ id: ids.sam, role: "MECHANIC" }) }),
    );
    const refused = await api(tokens.sam).post(`/work-orders/${workOrderId}/labour`, { catalogItemId: ids.oil, laborCost: 300 }).expect(400);
    expect(refused.body.errors.laborCost).toBeDefined();
    const noReason = await api(tokens.advisor).post(`/work-orders/${workOrderId}/labour`, { catalogItemId: ids.oil, laborCost: 400 }).expect(400);
    expect(noReason.body.errors.priceReason).toEqual(["Say why the price is different"]);
    const changed = await api(tokens.advisor)
      .post(`/work-orders/${workOrderId}/labour`, { catalogItemId: ids.oil, laborCost: 400, priceReason: " Regular customer " })
      .expect(201);
    expect(changed.body.labour.at(-1)).toEqual(
      expect.objectContaining({ laborCost: 400, priceChange: { listPrice: 500, reason: "Regular customer" } }),
    );
    expect(listed.body.labour.at(-1).priceChange).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "workOrder.labourAdded" }, orderBy: { createdAt: "desc" } });
    expect(audit?.changes).toEqual(expect.objectContaining({ laborCost: 400, listPrice: 500, priceReason: "Regular customer" }));
  });

  it("lets the assigned mechanic add a custom line, marked as such", async () => {
    const res = await api(tokens.sam).post(`/work-orders/${workOrderId}/labour`, { description: "Free up seized caliper", laborCost: 650 }).expect(201);
    expect(res.body.labour.at(-1)).toEqual(expect.objectContaining({ catalogItemId: null, addedBy: expect.objectContaining({ role: "MECHANIC" }) }));
  });

  it("can't pick a deactivated service", async () => {
    await api(tokens.admin).patch(`/services/${ids.oil}`, { isActive: false }).expect(200);
    await api(tokens.sam).post(`/work-orders/${workOrderId}/labour`, { catalogItemId: ids.oil }).expect(400);
    expect((await api(tokens.jordan).get("/services").expect(200)).body).toEqual([]);
    expect((await api(tokens.admin).get("/services?includeInactive=true").expect(200)).body).toHaveLength(2);
  });
});
