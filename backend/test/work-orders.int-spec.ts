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

  it("keeps Completed and Cancelled for advisors", async () => {
    await api(tokens.sam).post(`/work-orders/${woId}/status`, { status: "QUALITY_CHECK" }).expect(200);
    await api(tokens.sam).post(`/work-orders/${woId}/status`, { status: "CANCELLED" }).expect(403);
    await api(tokens.sam).post(`/work-orders/${woId}/status`, { status: "COMPLETED" }).expect(403);
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

describe("walk-in check-in", () => {
  const car = (vin: string, plate: string) => ({
    vin,
    plate,
    province: "เชียงใหม่",
    make: "Toyota",
    model: "Yaris",
    year: "2020",
    mileageIn: "30500",
    complaint: "Air-con blows warm",
  });
  const counts = async () => [await prisma.customer.count(), await prisma.vehicle.count(), await prisma.workOrder.count()];

  it("creates the customer, the vehicle and the work order in one request", async () => {
    const res = await api(tokens.advisor)
      .post("/work-orders/walk-in", { firstName: "Mali", lastName: "Suksan", phone: "089 111 2222", ...car("JTDKB20U093000001", "5กก 5555") })
      .expect(201);

    expect(res.body).toEqual(expect.objectContaining({ status: "CHECKED_IN", mileageIn: 30500, customer: expect.objectContaining({ name: "Mali Suksan" }) }));
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: res.body.vehicle.id }, include: { customer: true } });
    expect(vehicle).toEqual(expect.objectContaining({ mileage: 30500, plateNormalized: "5กก5555" }));
    expect(vehicle.customer.phone).toBe("+66891112222");
  });

  it("creates nothing when the VIN is already registered", async () => {
    const before = await counts();

    const res = await api(tokens.advisor)
      .post("/work-orders/walk-in", { firstName: "Dup", lastName: "Vin", phone: "089 333 4444", ...car("MRHFC1650KP000001", "6กก 6666") })
      .expect(409);

    expect(res.body.errors.vin).toBeDefined();
    expect(await counts()).toEqual(before);
  });

  it("adds a new car to an existing customer", async () => {
    const jordan = await prisma.customer.findFirstOrThrow({ where: { email: "jordan@wo.test" } });

    const res = await api(tokens.advisor)
      .post("/work-orders/walk-in", { customerId: jordan.id, ...car("JTDKB20U093000002", "7กก 7777") })
      .expect(201);

    expect(res.body.customer.id).toBe(jordan.id);
    expect(await prisma.customer.count({ where: { phone: "+66812345678" } })).toBe(1);
  });

  it("is for advisors and admins only", async () => {
    await api(tokens.sam).post("/work-orders/walk-in", { firstName: "A", lastName: "B", phone: "0890000000", ...car("JTDKB20U093000003", "8กก 8888") }).expect(403);
  });
});

describe("completion, invoice and payment", () => {
  let jobId = "";
  let invoiceId = "";
  let vehicleId = "";
  let otherCustomerToken = "";

  beforeAll(async () => {
    const jordan = await prisma.customer.findFirstOrThrow({ where: { email: "jordan@wo.test" } });
    vehicleId = (
      await prisma.vehicle.create({
        data: { customerId: jordan.id, vin: "MRHFC1650KP000099", plate: "9กข 9999", plateNormalized: "9กข9999", province: "กรุงเทพมหานคร", make: "Honda", model: "HR-V", year: 2021, mileage: 20000 },
      })
    ).id;
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const other = await prisma.user.create({ data: { email: "other@wo.test", role: "CUSTOMER", firstName: "Other", lastName: "Test", passwordHash } });
    await prisma.customer.create({ data: { firstName: "Other", lastName: "Test", phone: "+66899999999", userId: other.id } });
    otherCustomerToken = (await request(app.getHttpServer()).post("/auth/login").send({ email: "other@wo.test", password: PASSWORD }).expect(200)).body.accessToken;
  });

  it("works the job up to quality check, with a recommendation", async () => {
    const mechanicApi = api(tokens.sam);
    jobId = (await api(tokens.advisor).post("/work-orders", { vehicleId, mileageIn: "24500", complaint: "Service", mechanicId: ids.sam }).expect(201)).body.id;
    await mechanicApi.post(`/work-orders/${jobId}/status`, { status: "DIAGNOSING" }).expect(200);
    await mechanicApi.post(`/work-orders/${jobId}/labour`, { description: "Brake fluid flush", laborCost: "500" }).expect(201);
    await mechanicApi.post(`/work-orders/${jobId}/parts`, { inventoryItemId: ids.fluid, quantity: "1" }).expect(201);

    await mechanicApi.post(`/work-orders/${jobId}/recommendations`, { description: "Check pads", dueMileage: "24000" }).expect(400);
    const rec = await mechanicApi.post(`/work-orders/${jobId}/recommendations`, { description: "Brake pads check", dueMileage: "34500", dueDate: "" }).expect(201);
    expect(rec.body.recommendations).toEqual([expect.objectContaining({ description: "Brake pads check", dueMileage: 34500, dueDate: null })]);

    await mechanicApi.post(`/work-orders/${jobId}/status`, { status: "IN_PROGRESS" }).expect(200);
    await mechanicApi.post(`/work-orders/${jobId}/status`, { status: "QUALITY_CHECK" }).expect(200);
  });

  it("completes: invoice issued, vehicle mileage and history updated, job locked", async () => {
    const res = await api(tokens.advisor).post(`/work-orders/${jobId}/status`, { status: "COMPLETED", note: "QC passed" }).expect(200);

    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.completedAt).not.toBeNull();
    // 500 + 320.50 = 820.50; VAT 57.435 → 57.44; total 877.94
    expect(res.body.totals).toEqual(expect.objectContaining({ subtotal: 820.5, vat: 57.44, total: 877.94 }));
    expect(res.body.invoice).toEqual(expect.objectContaining({ status: "UNPAID" }));
    invoiceId = res.body.invoice.id;

    const vehicle = await api(tokens.advisor).get(`/vehicles/${vehicleId}`).expect(200);
    expect(vehicle.body.mileage).toBe(24500);
    expect(vehicle.body.history[0]).toEqual(
      expect.objectContaining({ workOrderId: jobId, status: "COMPLETED", invoiceId, total: 877.94, recommendations: [expect.objectContaining({ dueMileage: 34500 })] }),
    );

    await api(tokens.advisor).post(`/work-orders/${jobId}/status`, { status: "COMPLETED" }).expect(409);
    await api(tokens.advisor).post(`/work-orders/${jobId}/labour`, { description: "Extra", laborCost: "1" }).expect(409);
  });

  it("refuses to complete a job with nothing on it", async () => {
    const empty = (await api(tokens.advisor).post("/work-orders", { vehicleId, mileageIn: "24500", complaint: "Noise" }).expect(201)).body.id;
    for (const status of ["DIAGNOSING", "IN_PROGRESS", "QUALITY_CHECK"]) {
      await api(tokens.advisor).post(`/work-orders/${empty}/status`, { status }).expect(200);
    }
    const res = await api(tokens.advisor).post(`/work-orders/${empty}/status`, { status: "COMPLETED" }).expect(400);
    expect(res.body.message).toContain("at least one labour line or part");
    await api(tokens.advisor).post(`/work-orders/${empty}/status`, { status: "CANCELLED" }).expect(200);
  });

  it("shows the invoice to staff and its owner only", async () => {
    const invoice = await api(tokens.advisor).get(`/invoices/${invoiceId}`).expect(200);
    expect(invoice.body).toEqual(
      expect.objectContaining({
        status: "UNPAID",
        subtotal: 820.5,
        vat: 57.44,
        total: 877.94,
        customer: expect.objectContaining({ name: "Jordan Lee", phone: "+66812345678" }),
        labour: [expect.objectContaining({ description: "Brake fluid flush", laborCost: 500 })],
        parts: [expect.objectContaining({ sku: "FLUID", quantity: 1, unitPrice: 320.5 })],
      }),
    );

    await api(tokens.customer).get(`/invoices/${invoiceId}`).expect(200);
    const mine = await api(tokens.customer).get("/invoices").expect(200);
    expect(mine.body.items.map((i: { id: string }) => i.id)).toContain(invoiceId);

    await api(otherCustomerToken).get(`/invoices/${invoiceId}`).expect(404);
    expect((await api(otherCustomerToken).get("/invoices").expect(200)).body.total).toBe(0);
    await api(tokens.sam).get("/invoices").expect(403);
  });

  it("is marked paid once, by staff, with who and when", async () => {
    await api(tokens.customer).post(`/invoices/${invoiceId}/pay`).expect(403);

    const paid = await api(tokens.advisor).post(`/invoices/${invoiceId}/pay`).expect(200);
    expect(paid.body).toEqual(expect.objectContaining({ status: "PAID", paidAt: expect.any(String), paidBy: "Alex Test" }));
    await api(tokens.advisor).post(`/invoices/${invoiceId}/pay`).expect(409);

    const unpaid = await api(tokens.advisor).get("/invoices?status=UNPAID").expect(200);
    expect(unpaid.body.items.map((i: { id: string }) => i.id)).not.toContain(invoiceId);
  });
});
