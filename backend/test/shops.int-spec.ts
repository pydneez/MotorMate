import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { testDatabaseUrl } from "./integration-env";
import { createTestShop, shopOf, testNumber } from "./test-shop";

/**
 * Multi-shop over real HTTP + Postgres: one shop can never see or change another's records
 * (the automatic shop filter), shops register themselves, the platform admin suspends them,
 * and a customer links to and switches between shops.
 */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";
process.env.JOB_TOKEN = "shops-test-job-token";

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");

const PASSWORD = "password123";
const A = "shop_a";
const B = "shop_b";

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const tokens: Record<string, string> = {};
/** Shop B's records, which shop A's staff try to reach. */
const b: Record<string, string> = {};
const ids: Record<string, string> = {};

async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

function api(token?: string) {
  const server = app.getHttpServer();
  const auth = (req: request.Test) => (token ? req.set("Authorization", `Bearer ${token}`) : req);
  return {
    get: (url: string) => auth(request(server).get(url)),
    post: (url: string, body?: object) => auth(request(server).post(url)).send(body),
    patch: (url: string, body?: object) => auth(request(server).patch(url)).send(body),
  };
}

const login = async (email: string) =>
  (await request(app.getHttpServer()).post("/auth/login").send({ email, password: PASSWORD }).expect(200)).body;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();
  await createTestShop(prisma, A, "Alpha Garage");
  await createTestShop(prisma, B, "Bravo Garage");

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = (email: string, role: "PLATFORM_ADMIN" | "ADMIN" | "ADVISOR" | "MECHANIC" | "CUSTOMER", shopId: string) =>
    prisma.user.create({ data: { email, role, firstName: email.split("@")[0], lastName: "Test", passwordHash, ...(role === "PLATFORM_ADMIN" ? {} : shopOf(role, shopId)) } });

  await user("platform@shops.test", "PLATFORM_ADMIN", "");
  await user("admin.a@shops.test", "ADMIN", A);
  await user("advisor.a@shops.test", "ADVISOR", A);
  ids.adminB = (await user("admin.b@shops.test", "ADMIN", B)).id;
  ids.mechanicB = (await user("mechanic.b@shops.test", "MECHANIC", B)).id;
  ids.jordanUser = (await user("jordan@shops.test", "CUSTOMER", A)).id;

  // Jordan is a customer of shop A only (to start with).
  ids.jordanA = (
    await prisma.customer.create({ data: { shopId: A, firstName: "Jordan", lastName: "Lee", phone: "+66812345678", email: "jordan@shops.test", userId: ids.jordanUser } })
  ).id;

  // Shop B: a customer, a car, a completed job with its invoice, an open booking, a part, a service.
  const customer = await prisma.customer.create({ data: { shopId: B, firstName: "Bee", lastName: "Bravo", phone: "+66899999999" } });
  const vehicle = await prisma.vehicle.create({
    data: { shopId: B, customerId: customer.id, vin: "JTDSHPB0000000001", plate: "9ขค 9999", plateNormalized: "9ขค9999", province: "กรุงเทพมหานคร", make: "Toyota", model: "Vios", year: 2020, mileage: 30000 },
  });
  const job = await prisma.workOrder.create({
    data: { shopId: B, number: await testNumber(prisma, "workOrder", B), vehicleId: vehicle.id, mileageIn: 30000, complaint: "Service", status: "COMPLETED", completedAt: new Date(), createdById: ids.adminB },
  });
  await prisma.serviceItem.create({ data: { workOrderId: job.id, description: "Labour", laborCost: 1000 } });
  const invoice = await prisma.invoice.create({
    data: { shopId: B, number: await testNumber(prisma, "invoice", B), workOrderId: job.id, subtotal: 1000, vatAmount: 70, total: 1070, issuedAt: new Date() },
  });
  const appointment = await prisma.appointment.create({
    data: { customerId: customer.id, vehicleId: vehicle.id, scheduledAt: new Date(Date.now() + 5 * 24 * 3600 * 1000), reason: "Check-up", status: "CONFIRMED", createdById: ids.adminB },
  });
  const part = await prisma.inventoryItem.create({
    data: { shopId: B, sku: "OIL-1", name: "Engine oil", category: "Fluids", quantityOnHand: 10, unitCost: 100, unitPrice: 150, reorderLevel: 2 },
  });
  const service = await prisma.serviceCatalogItem.create({ data: { shopId: B, name: "Oil change", category: "Maintenance", price: 450 } });
  Object.assign(b, { customer: customer.id, vehicle: vehicle.id, job: job.id, invoice: invoice.id, appointment: appointment.id, part: part.id, service: service.id });

  for (const email of ["platform", "admin.a", "advisor.a", "admin.b", "jordan"]) tokens[email] = (await login(`${email}@shops.test`)).accessToken;
});

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("isolation between shops", () => {
  it("returns 404 for every kind of another shop's record", async () => {
    const advisor = api(tokens["advisor.a"]);
    await advisor.get(`/customers/${b.customer}`).expect(404);
    await advisor.get(`/vehicles/${b.vehicle}`).expect(404);
    await advisor.get(`/work-orders/${b.job}`).expect(404);
    await advisor.get(`/invoices/${b.invoice}`).expect(404);
    await advisor.get(`/appointments/${b.appointment}`).expect(404);
    await advisor.get(`/inventory/${b.part}`).expect(404);
    await api(tokens["admin.a"]).patch(`/services/${b.service}`, { price: 1 }).expect(404);
    await api(tokens["admin.a"]).patch(`/users/${ids.mechanicB}`, { firstName: "Hacked" }).expect(404);
  });

  it("can't change or use another shop's records", async () => {
    const advisor = api(tokens["advisor.a"]);
    await advisor.patch(`/customers/${b.customer}`, { firstName: "Hacked" }).expect(404);
    await advisor.post(`/invoices/${b.invoice}/pay`).expect(404);
    await advisor.post(`/inventory/${b.part}/receive`, { quantity: 5 }).expect(404);
    await advisor.post("/work-orders", { vehicleId: b.vehicle, mileageIn: 31000, complaint: "Noise" }).expect(404);
    await advisor.post(`/appointments/${b.appointment}/cancel`, { reason: "Not ours" }).expect(404);

    expect(await prisma.customer.findUniqueOrThrow({ where: { id: b.customer } })).toEqual(expect.objectContaining({ firstName: "Bee" }));
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: b.invoice } })).toEqual(expect.objectContaining({ status: "UNPAID" }));
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: b.part } })).quantityOnHand).toBe(10);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: b.appointment } })).status).toBe("CONFIRMED");
    expect(await prisma.serviceCatalogItem.findUniqueOrThrow({ where: { id: b.service } })).toEqual(expect.objectContaining({ name: "Oil change" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.mechanicB } })).firstName).toBe("mechanic.b");
  });

  it("leaves another shop's records out of lists, searches and reports", async () => {
    const advisor = api(tokens["advisor.a"]);
    for (const url of ["/customers?q=Bee", "/vehicles?q=9999", "/work-orders", "/invoices", "/inventory", "/appointments?tab=all"]) {
      expect((await advisor.get(url).expect(200)).body.total).toBe(0);
    }
    expect((await advisor.get("/services").expect(200)).body).toEqual([]);
    expect((await api(tokens["admin.a"]).get("/users").expect(200)).body.items.map((u: { email: string }) => u.email).sort()).toEqual(["admin.a@shops.test", "advisor.a@shops.test"]);

    const month = new Date().toISOString().slice(0, 7);
    const range = `from=${month}-01&to=${new Date().toISOString().slice(0, 10)}`;
    expect((await api(tokens["admin.a"]).get(`/reports/revenue?${range}`).expect(200)).body.invoiceCount).toBe(0);
    expect((await api(tokens["admin.b"]).get(`/reports/revenue?${range}`).expect(200)).body.invoiceCount).toBe(1);
  });

  it("allows the same VIN and SKU in two shops, and numbers each shop's jobs from WO-0001", async () => {
    const advisor = api(tokens["advisor.a"]);
    const res = await advisor
      .post("/work-orders/walk-in", {
        firstName: "Bee",
        lastName: "Alpha",
        phone: "089-999-9999",
        vin: "JTDSHPB0000000001",
        plate: "9ขค 9999",
        province: "กรุงเทพมหานคร",
        make: "Toyota",
        model: "Vios",
        year: 2020,
        mileageIn: 30500,
        complaint: "Brakes squeal",
      })
      .expect(201);
    expect(res.body.number).toBe(1); // shown as WO-0001
    await api(tokens["admin.a"]).post("/inventory", { sku: "OIL-1", name: "Engine oil", category: "Fluids", unitCost: 90, unitPrice: 140, reorderLevel: 2, openingQuantity: 0 }).expect(201);
  });
});

describe("shops register themselves", () => {
  it("lists only open shops publicly", async () => {
    const res = await api().get("/shops").expect(200);
    expect(res.body.map((s: { id: string }) => s.id).sort()).toEqual([A, B]);
    expect(Object.keys(res.body[0]).sort()).toEqual(["address", "id", "name", "phone"]);
  });

  it("creates the shop and its admin, who can sign in straight away", async () => {
    const body = {
      name: "Charlie Motors",
      address: "3 Charlie Road\nBangkok 10200",
      phone: "02-333-3333",
      email: "",
      taxId: "0-1055-33333-33-3",
      adminFirstName: "Chai",
      adminLastName: "Charoen",
      adminEmail: "chai@charlie.test",
      adminPassword: PASSWORD,
    };
    const res = await api().post("/shops/register", body).expect(201);
    ids.shopC = res.body.id;
    const session = await login("chai@charlie.test");
    expect(session.user).toEqual(expect.objectContaining({ role: "ADMIN", shopId: ids.shopC, shopName: "Charlie Motors" }));
    expect((await api(session.accessToken).get("/customers").expect(200)).body.total).toBe(0);

    const taken = await api().post("/shops/register", { ...body, name: "Charlie Two" }).expect(409);
    expect(taken.body.errors.adminEmail).toBeDefined();
    expect(await prisma.shop.count({ where: { name: "Charlie Two" } })).toBe(0);
  });
});

describe("platform admin", () => {
  it("is the only one who sees all shops, with counts, and works in none", async () => {
    await api(tokens["admin.a"]).get("/platform/shops").expect(403);
    const res = await api(tokens.platform).get("/platform/shops").expect(200);
    const bravo = res.body.find((s: { id: string }) => s.id === B);
    expect(bravo).toEqual(expect.objectContaining({ name: "Bravo Garage", isActive: true, staff: 2, customers: 1 }));
    // Without a shop, a shop's data is refused rather than shown across shops.
    await api(tokens.platform).get("/customers").expect(403);
  });

  it("suspends a shop: its staff are signed out and can't sign in, until it's reactivated", async () => {
    await api(tokens.platform).post(`/platform/shops/${B}/suspend`).expect(200);
    await api(tokens["admin.b"]).get("/customers").expect(401);
    const refused = await request(app.getHttpServer()).post("/auth/login").send({ email: "admin.b@shops.test", password: PASSWORD }).expect(403);
    expect(refused.body.message).toContain("suspended");
    expect((await api().get("/shops").expect(200)).body.map((s: { id: string }) => s.id)).not.toContain(B);
    expect(await prisma.auditLog.count({ where: { action: "shop.suspended", entityId: B } })).toBe(1);

    await api(tokens.platform).post(`/platform/shops/${B}/reactivate`).expect(200);
    tokens["admin.b"] = (await login("admin.b@shops.test")).accessToken;
    await api(tokens["admin.b"]).get("/customers").expect(200);
  });
});

describe("customers in several shops", () => {
  it("signs up with a chosen shop", async () => {
    const bad = await api().post("/auth/register", { firstName: "New", lastName: "Person", email: "new@shops.test", phone: "081-111-0000", password: PASSWORD, shopId: "nope" }).expect(400);
    expect(bad.body.errors.shopId).toBeDefined();
    const res = await api().post("/auth/register", { firstName: "New", lastName: "Person", email: "new@shops.test", phone: "081-111-0000", password: PASSWORD, shopId: B }).expect(201);
    expect(res.body.user).toEqual(expect.objectContaining({ role: "CUSTOMER", shopId: B, shopName: "Bravo Garage" }));
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: res.body.user.customerId } })).shopId).toBe(B);
  });

  it("links another shop, then switches between them, each with its own records", async () => {
    const jordan = api(tokens.jordan);
    expect((await jordan.get("/auth/shops").expect(200)).body).toEqual([expect.objectContaining({ id: A, current: true })]);

    const linked = await jordan.post("/auth/shops", { shopId: B }).expect(200);
    expect(linked.body.user).toEqual(expect.objectContaining({ shopId: B, shopName: "Bravo Garage" }));
    expect(linked.body.user.customerId).not.toBe(ids.jordanA);
    const inB = api(linked.body.accessToken);
    expect((await inB.get("/auth/shops").expect(200)).body.map((s: { id: string; current: boolean }) => [s.id, s.current])).toEqual([
      [A, false],
      [B, true],
    ]);
    // Shop B's own customers stay hidden from Jordan.
    await inB.get(`/vehicles/${b.vehicle}`).expect(404);
    expect((await inB.get("/vehicles").expect(200)).body.total).toBe(0);

    // The next sign-in opens the shop used last; switching back works.
    expect((await login("jordan@shops.test")).user.shopId).toBe(B);
    const back = await inB.post("/auth/switch-shop", { shopId: A }).expect(200);
    expect(back.body.user).toEqual(expect.objectContaining({ shopId: A, customerId: ids.jordanA }));
    await inB.post("/auth/switch-shop", { shopId: ids.shopC }).expect(404);
  });

  it("refuses a token for a shop the customer isn't linked to", async () => {
    const jwt = app.get((await import("@nestjs/jwt")).JwtService);
    const forged = await jwt.signAsync({ sub: ids.jordanUser, email: "jordan@shops.test", role: "CUSTOMER", shopId: ids.shopC });
    await api(forged).get("/vehicles").expect(401);
  });

  it("staff can't link or switch shops", async () => {
    await api(tokens["advisor.a"]).post("/auth/shops", { shopId: B }).expect(403);
    await api(tokens["advisor.a"]).post("/auth/switch-shop", { shopId: B }).expect(403);
  });
});

describe("daily jobs", () => {
  it("run once per open shop", async () => {
    const res = await request(app.getHttpServer()).post("/jobs/close-day").set("x-job-token", process.env.JOB_TOKEN!).expect(200);
    expect(res.body).toEqual({ noShows: expect.any(Number), expired: expect.any(Number) });
  });
});
