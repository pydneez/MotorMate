import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { testDatabaseUrl } from "./integration-env";

/** Work-order lifecycle over real HTTP + Postgres: roles, status moves, parts and stock. */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");

const PASSWORD = "password123";

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const tokens: Record<"advisor" | "sam" | "nok" | "customer", string> = {} as never;
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
    delete: (url: string) => request(server).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

const onHand = async (sku: string) => (await prisma.inventoryItem.findUniqueOrThrow({ where: { sku } })).quantityOnHand;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = (email: string, role: "ADVISOR" | "MECHANIC" | "CUSTOMER", firstName: string) =>
    prisma.user.create({ data: { email, role, firstName, lastName: "Test", passwordHash } });
  await user("advisor@wo.test", "ADVISOR", "Alex");
  ids.sam = (await user("sam@wo.test", "MECHANIC", "Sam")).id;
  ids.nok = (await user("nok@wo.test", "MECHANIC", "Nok")).id;
  const customerUser = await user("jordan@wo.test", "CUSTOMER", "Jordan");

  const customer = await prisma.customer.create({
    data: { firstName: "Jordan", lastName: "Lee", phone: "+66812345678", email: "jordan@wo.test", userId: customerUser.id },
  });
  const vehicle = (vin: string, plate: string, mileage: number) =>
    prisma.vehicle.create({
      data: { customerId: customer.id, vin, plate, plateNormalized: plate.replace(/[\s-]/g, ""), province: "กรุงเทพมหานคร", make: "Honda", model: "Civic", year: 2019, mileage },
    });
  ids.civic = (await vehicle("MRHFC1650KP000001", "1กข 1234", 42000)).id;
  ids.jazz = (await vehicle("MRHFC1650KP000002", "2กข 2222", 10000)).id;
  ids.city = (await vehicle("MRHFC1650KP000003", "3กข 3333", 5000)).id;

  const item = (sku: string, quantityOnHand: number, unitPrice: number) =>
    prisma.inventoryItem.create({ data: { sku, name: `Part ${sku}`, category: "Brakes", quantityOnHand, unitCost: 1, unitPrice, reorderLevel: 0 } });
  ids.pads = (await item("PADS", 6, 1500)).id;
  ids.fluid = (await item("FLUID", 5, 320.5)).id;

  for (const [key, email] of [["advisor", "advisor@wo.test"], ["sam", "sam@wo.test"], ["nok", "nok@wo.test"], ["customer", "jordan@wo.test"]] as const) {
    tokens[key] = (await request(app.getHttpServer()).post("/auth/login").send({ email, password: PASSWORD }).expect(200)).body.accessToken;
  }
});

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("work order lifecycle", () => {
  let woId = "";

  it("checks a car in, refusing lower mileage and a second open job", async () => {
    await api(tokens.advisor).post("/work-orders", { vehicleId: ids.civic, mileageIn: "41000", complaint: "Squeal" }).expect(400);

    const res = await api(tokens.advisor)
      .post("/work-orders", { vehicleId: ids.civic, mileageIn: "45200", complaint: "Brakes squeal when stopping", mechanicId: ids.sam })
      .expect(201);
    woId = res.body.id;
    expect(res.body).toEqual(
      expect.objectContaining({ number: 1, status: "CHECKED_IN", mileageIn: 45200, mechanic: expect.objectContaining({ name: "Sam Test" }) }),
    );
    expect(res.body.history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: "CHECKED_IN", changedBy: "Alex Test" })]);

    const again = await api(tokens.advisor).post("/work-orders", { vehicleId: ids.civic, mileageIn: "45200", complaint: "x" }).expect(409);
    expect(again.body.message).toContain("WO-0001");
  });

  it("lets the assigned mechanic work the job, and nobody else", async () => {
    await api(tokens.sam).post(`/work-orders/${woId}/status`, { status: "DIAGNOSING" }).expect(200);
    await api(tokens.sam).patch(`/work-orders/${woId}`, { diagnosis: "Front pads worn to 2 mm" }).expect(200);
    await api(tokens.sam).post(`/work-orders/${woId}/status`, { status: "IN_PROGRESS" }).expect(200);

    await api(tokens.nok).patch(`/work-orders/${woId}`, { diagnosis: "hijack" }).expect(403);
    await api(tokens.nok).post(`/work-orders/${woId}/status`, { status: "QUALITY_CHECK" }).expect(403);
    await api(tokens.nok).get(`/work-orders/${woId}`).expect(200); // other mechanics can still look
    await api(tokens.customer).get(`/work-orders/${woId}`).expect(403);
    await api(tokens.customer).get("/work-orders").expect(403);
  });

  it("deducts stock for parts, prices them at the current price, and returns stock on removal", async () => {
    const withPads = await api(tokens.sam).post(`/work-orders/${woId}/parts`, { inventoryItemId: ids.pads, quantity: "1" }).expect(201);
    await api(tokens.sam).post(`/work-orders/${woId}/parts`, { inventoryItemId: ids.fluid, quantity: "2" }).expect(201);
    expect(await onHand("PADS")).toBe(5);
    expect(await onHand("FLUID")).toBe(3);
    expect(withPads.body.parts[0]).toEqual(expect.objectContaining({ sku: "PADS", quantity: 1, unitPrice: 1500, lineTotal: 1500 }));

    // A later catalogue price change doesn't affect a part already on the job.
    await prisma.inventoryItem.update({ where: { id: ids.pads }, data: { unitPrice: 9999 } });

    const labour = await api(tokens.sam).post(`/work-orders/${woId}/labour`, { description: "Replace front pads", laborCost: "600" }).expect(201);
    expect(labour.body.totals).toEqual({ labour: 600, parts: 2141, subtotal: 2741, vatRate: 0.07, vat: 191.87, total: 2932.87 });

    const fluidLine = labour.body.parts.find((p: { sku: string }) => p.sku === "FLUID");
    await api(tokens.sam).delete(`/work-orders/${woId}/parts/${fluidLine.id}`).expect(200);
    expect(await onHand("FLUID")).toBe(5);

    await api(tokens.sam).post(`/work-orders/${woId}/parts`, { inventoryItemId: ids.pads, quantity: "99" }).expect(409);
    expect(await onHand("PADS")).toBe(5);

    const movements = await prisma.stockMovement.findMany({ where: { workOrderId: woId }, orderBy: { createdAt: "asc" } });
    expect(movements.map((m) => [m.quantityChange, m.note])).toEqual([
      [-1, "Used on WO-0001"],
      [-2, "Used on WO-0001"],
      [2, "Returned from WO-0001"],
    ]);
  });

  it("keeps Completed and Cancelled for advisors, and doesn't complete yet", async () => {
    await api(tokens.sam).post(`/work-orders/${woId}/status`, { status: "QUALITY_CHECK" }).expect(200);
    await api(tokens.sam).post(`/work-orders/${woId}/status`, { status: "CANCELLED" }).expect(403);
    await api(tokens.advisor).post(`/work-orders/${woId}/status`, { status: "COMPLETED" }).expect(400);
    await api(tokens.advisor).post(`/work-orders/${woId}/status`, { status: "IN_PROGRESS", note: "Still squeals" }).expect(200);
  });

  it("returns all parts to stock on cancel and then locks the job", async () => {
    const res = await api(tokens.advisor).post(`/work-orders/${woId}/status`, { status: "CANCELLED", note: "Customer declined" }).expect(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.parts).toEqual([]);
    expect(await onHand("PADS")).toBe(6);

    await api(tokens.advisor).patch(`/work-orders/${woId}`, { notes: "late" }).expect(409);
    await api(tokens.advisor).post(`/work-orders/${woId}/parts`, { inventoryItemId: ids.pads, quantity: 1 }).expect(409);
    // The car can be checked in again once the job is closed.
    await api(tokens.advisor).post("/work-orders", { vehicleId: ids.civic, mileageIn: "45200", complaint: "Second visit" }).expect(201);
  });
});

describe("work order lists and counts", () => {
  it("filters by status, mechanic, number and plate, and counts for the dashboard", async () => {
    await api(tokens.advisor).post("/work-orders", { vehicleId: ids.jazz, mileageIn: 10500, complaint: "Oil change", mechanicId: ids.sam }).expect(201);

    const mine = await api(tokens.sam).get("/work-orders?status=open&mechanic=me").expect(200);
    expect(mine.body.items.map((w: { vehicle: { plate: string } }) => w.vehicle.plate)).toEqual(["2กข 2222"]);

    const byNumber = await api(tokens.advisor).get("/work-orders?q=WO-0001").expect(200);
    expect(byNumber.body.items.map((w: { number: number }) => w.number)).toEqual([1]);

    const byPlate = await api(tokens.advisor).get(`/work-orders?q=${encodeURIComponent("1กข-1234")}&status=open`).expect(200);
    expect(byPlate.body.items.map((w: { number: number }) => w.number)).toEqual([2]);

    const closed = await api(tokens.advisor).get("/work-orders?status=closed").expect(200);
    expect(closed.body.items.map((w: { status: string }) => w.status)).toEqual(["CANCELLED"]);

    const counts = await api(tokens.sam).get("/work-orders/counts").expect(200);
    expect(counts.body).toEqual({ open: 2, awaitingParts: 0, qualityCheck: 0, mine: 1 });

    const mechanics = await api(tokens.advisor).get("/work-orders/mechanics").expect(200);
    expect(mechanics.body).toEqual([
      expect.objectContaining({ name: "Nok Test", openJobs: 0 }),
      expect.objectContaining({ name: "Sam Test", openJobs: 1 }),
    ]);
    await api(tokens.sam).get("/work-orders/mechanics").expect(403);
  });

  it("never lets two jobs take the same last parts at once", async () => {
    await prisma.inventoryItem.update({ where: { id: ids.fluid }, data: { quantityOnHand: 3 } });
    const jobA = (await api(tokens.advisor).post("/work-orders", { vehicleId: ids.city, mileageIn: 5000, complaint: "A" }).expect(201)).body.id;
    const open = await api(tokens.advisor).get("/work-orders?status=open&q=2กข2222").expect(200);
    const jobB = open.body.items[0].id;

    const results = await Promise.all([
      api(tokens.advisor).post(`/work-orders/${jobA}/parts`, { inventoryItemId: ids.fluid, quantity: 2 }),
      api(tokens.advisor).post(`/work-orders/${jobB}/parts`, { inventoryItemId: ids.fluid, quantity: 2 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await onHand("FLUID")).toBe(1);
    expect(await prisma.partUsed.count({ where: { inventoryItemId: ids.fluid } })).toBe(1);
  });
});
