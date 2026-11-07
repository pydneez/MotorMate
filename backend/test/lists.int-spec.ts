import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { testDatabaseUrl } from "./integration-env";
import { createTestShop, shopOf, TEST_SHOP_ID, testNumber } from "./test-shop";

/** List filters over real HTTP + Postgres: invoice and work-order date ranges, inventory sorting. */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");

const PASSWORD = "password123";

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const tokens: Record<"advisor" | "mechanic" | "customer", string> = {} as never;
const customerIds = { jo: "", kim: "" };

async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

const get = (token: string, url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);
const numbers = (body: { items: { number: number }[] }) => body.items.map((item) => item.number);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();
  await createTestShop(prisma);

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const users = {} as Record<keyof typeof tokens, { id: string }>;
  for (const [key, role] of [["advisor", "ADVISOR"], ["mechanic", "MECHANIC"], ["customer", "CUSTOMER"]] as const) {
    users[key] = await prisma.user.create({ data: { email: `${key}@lists.test`, role, firstName: "Test", lastName: "Lists", passwordHash, ...shopOf(role) } });
  }
  const signIn = async (key: keyof typeof tokens) => {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email: `${key}@lists.test`, password: PASSWORD }).expect(200);
    tokens[key] = res.body.accessToken;
  };
  await signIn("advisor");
  await signIn("mechanic");

  const vehicleFor = async (name: string, phone: string, vin: string, userId?: string) => {
    const customer = await prisma.customer.create({ data: { shopId: TEST_SHOP_ID, firstName: name, lastName: "Lists", phone, userId } });
    return prisma.vehicle.create({
      data: { shopId: TEST_SHOP_ID, customerId: customer.id, vin, plate: "1กข 1234", plateNormalized: "1กข1234", province: "กรุงเทพมหานคร", make: "Honda", model: "City", year: 2020, mileage: 50000 },
    });
  };
  const mine = await vehicleFor("Jo", "+66810000011", "VINLISTS000000001", users.customer.id);
  const other = await vehicleFor("Kim", "+66810000012", "VINLISTS000000002");
  customerIds.jo = mine.customerId;
  customerIds.kim = other.customerId;
  // A customer signs in once their login is linked to a Customer record in a shop.
  await signIn("customer");

  // WO-0001..0004 and INV-0001..0004, each checked in and invoiced at `at`.
  const job = async (vehicleId: string, at: string) => {
    const when = new Date(at);
    const workOrder = await prisma.workOrder.create({
      data: { shopId: TEST_SHOP_ID, number: await testNumber(prisma, "workOrder"), vehicleId, mileageIn: 50000, complaint: "Service", status: "COMPLETED", completedAt: when, createdById: users.advisor.id, createdAt: when },
    });
    await prisma.invoice.create({ data: { shopId: TEST_SHOP_ID, number: await testNumber(prisma, "invoice"), workOrderId: workOrder.id, subtotal: 100, vatAmount: 7, total: 107, issuedAt: when } });
  };
  await job(mine.id, "2026-09-30T16:30:00Z"); // 30 Sep 23:30 Bangkok — before October
  await job(mine.id, "2026-10-01T00:30:00Z"); // 1 Oct 07:30 — inside
  await job(other.id, "2026-10-31T16:30:00Z"); // 31 Oct 23:30 — inside
  await job(other.id, "2026-10-31T17:30:00Z"); // 1 Nov 00:30 — after

  // Appointments: Jo booked one online (still requested) and one that became a no-show;
  // staff booked one for Kim by phone, completed. All in October except the request.
  const booking = (vehicle: { id: string; customerId: string }, at: string, status: string, createdById: string) =>
    prisma.appointment.create({
      data: { customerId: vehicle.customerId, vehicleId: vehicle.id, scheduledAt: new Date(at), reason: "Service", status: status as never, createdById },
    });
  await booking(mine, "2026-10-05T03:00:00Z", "NO_SHOW", users.customer.id);
  await booking(other, "2026-10-31T10:30:00Z", "COMPLETED", users.advisor.id); // 31 Oct 17:30 Bangkok
  await booking(mine, "2026-11-20T03:00:00Z", "REQUESTED", users.customer.id);

  const item = (sku: string, name: string, quantityOnHand: number, unitPrice: number, isActive = true) => ({
    shopId: TEST_SHOP_ID, sku, name, category: "Filters", quantityOnHand, unitCost: 50, unitPrice, reorderLevel: 1, isActive,
  });
  await prisma.inventoryItem.createMany({
    data: [
      item("SKU-C", "Cabin filter", 3, 300),
      item("SKU-A", "Air filter", 9, 200),
      item("SKU-D", "Drain plug", 3, 50),
      item("SKU-B", "Brake fluid", 1, 450),
      item("SKU-E", "Old part", 0, 10, false),
    ],
  });
});

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("invoice date range", () => {
  it("includes whole Bangkok days at both ends", async () => {
    const { body } = await get(tokens.advisor, "/invoices?from=2026-10-01&to=2026-10-31").expect(200);
    expect(numbers(body)).toEqual([3, 2]);
    expect(body.total).toBe(2);
  });

  it("works with only a start or only an end", async () => {
    expect(numbers((await get(tokens.advisor, "/invoices?from=2026-11-01").expect(200)).body)).toEqual([4]);
    expect(numbers((await get(tokens.advisor, "/invoices?to=2026-09-30").expect(200)).body)).toEqual([1]);
  });

  it("keeps a customer to their own invoices", async () => {
    const { body } = await get(tokens.customer, "/invoices?from=2026-10-01&to=2026-10-31").expect(200);
    expect(numbers(body)).toEqual([2]);
  });

  it("rejects an end before the start and impossible dates", async () => {
    const res = await get(tokens.advisor, "/invoices?from=2026-10-31&to=2026-10-01").expect(400);
    expect(JSON.stringify(res.body)).toContain("The end date can't be before the start date");
    await get(tokens.advisor, "/invoices?from=2026-02-30").expect(400);
  });
});

describe("work order check-in date range", () => {
  it("filters on the Bangkok check-in day, with any status", async () => {
    const { body } = await get(tokens.advisor, "/work-orders?status=COMPLETED&from=2026-10-01&to=2026-10-31").expect(200);
    expect(numbers(body)).toEqual([3, 2]);
  });

  it("rejects impossible dates", async () => {
    await get(tokens.advisor, "/work-orders?from=2026-13-01").expect(400);
  });
});

describe("appointment filters", () => {
  const statuses = (body: { items: { status: string }[] }) => body.items.map((row) => row.status);

  it("lists everything on the All tab, newest first", async () => {
    const { body } = await get(tokens.advisor, "/appointments?view=all").expect(200);
    expect(statuses(body)).toEqual(["REQUESTED", "COMPLETED", "NO_SHOW"]);
  });

  it("filters by status, scheduled month and who booked it", async () => {
    expect(statuses((await get(tokens.advisor, "/appointments?view=all&status=NO_SHOW,COMPLETED").expect(200)).body)).toEqual(["COMPLETED", "NO_SHOW"]);
    expect(statuses((await get(tokens.advisor, "/appointments?view=all&from=2026-10-01&to=2026-10-31").expect(200)).body)).toEqual(["COMPLETED", "NO_SHOW"]);
    expect(statuses((await get(tokens.advisor, "/appointments?view=all&bookedBy=staff").expect(200)).body)).toEqual(["COMPLETED"]);
    expect(statuses((await get(tokens.advisor, "/appointments?view=all&bookedBy=customer").expect(200)).body)).toEqual(["REQUESTED", "NO_SHOW"]);
  });

  it("only narrows a tab, never widens it", async () => {
    const { body } = await get(tokens.advisor, "/appointments?view=requests&status=COMPLETED").expect(200);
    expect(body.items).toEqual([]);
  });

  it("keeps customers to their own appointments", async () => {
    const { body } = await get(tokens.customer, "/appointments?view=all&bookedBy=staff").expect(200);
    expect(body.items).toEqual([]);
  });

  it("rejects unknown statuses and sources", async () => {
    await get(tokens.advisor, "/appointments?view=all&status=LATE").expect(400);
    await get(tokens.advisor, "/appointments?view=all&bookedBy=phone").expect(400);
  });
});

describe("customer visits", () => {
  it("lists a customer's jobs, newest first, with the invoice", async () => {
    const { body } = await get(tokens.advisor, `/customers/${customerIds.kim}/visits`).expect(200);
    expect(body.total).toBe(2);
    expect(numbers(body)).toEqual([4, 3]);
    expect(body.items[0]).toEqual(
      expect.objectContaining({ status: "COMPLETED", complaint: "Service", invoice: expect.objectContaining({ number: 4, total: 107, status: "UNPAID" }) }),
    );
    expect(body.items[0]).not.toHaveProperty("mechanic");
  });

  it("pages", async () => {
    const page2 = await get(tokens.advisor, `/customers/${customerIds.jo}/visits?pageSize=1&page=2`).expect(200);
    expect(numbers(page2.body)).toEqual([1]);
  });

  it("is staff only, and 404s an unknown customer", async () => {
    await get(tokens.customer, `/customers/${customerIds.jo}/visits`).expect(403);
    await get(tokens.mechanic, `/customers/${customerIds.jo}/visits`).expect(403);
    await get(tokens.advisor, "/customers/does-not-exist/visits").expect(404);
  });
});

describe("inventory sorting", () => {
  const skus = (body: { items: { sku: string }[] }) => body.items.map((row) => row.sku);

  it("sorts by on hand with a stable order across pages", async () => {
    const page1 = await get(tokens.mechanic, "/inventory?sort=quantity&dir=asc&pageSize=2").expect(200);
    const page2 = await get(tokens.mechanic, "/inventory?sort=quantity&dir=asc&pageSize=2&page=2").expect(200);
    // Cabin filter and Drain plug both have 3 on hand: the name decides.
    expect([...skus(page1.body), ...skus(page2.body)]).toEqual(["SKU-B", "SKU-C", "SKU-D", "SKU-A"]);
  });

  it("sorts by price, name and SKU in either direction", async () => {
    expect(skus((await get(tokens.advisor, "/inventory?sort=price&dir=desc").expect(200)).body)).toEqual(["SKU-B", "SKU-C", "SKU-A", "SKU-D"]);
    expect(skus((await get(tokens.advisor, "/inventory?sort=name").expect(200)).body)).toEqual(["SKU-A", "SKU-B", "SKU-C", "SKU-D"]);
    expect(skus((await get(tokens.advisor, "/inventory?sort=sku&dir=desc").expect(200)).body)).toEqual(["SKU-D", "SKU-C", "SKU-B", "SKU-A"]);
  });

  it("keeps deactivated items last when they're shown", async () => {
    const { body } = await get(tokens.advisor, "/inventory?sort=quantity&includeInactive=true").expect(200);
    expect(skus(body)).toEqual(["SKU-B", "SKU-C", "SKU-D", "SKU-A", "SKU-E"]);
  });

  it("rejects columns that aren't on the list", async () => {
    await get(tokens.advisor, "/inventory?sort=unitCost").expect(400);
  });
});
