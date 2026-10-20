import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { testDatabaseUrl } from "./integration-env";

/** Inventory over real HTTP + Postgres: search, low-stock filter, roles, and concurrent stock changes. */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");
const { StockService } = require("../src/inventory/stock.service") as typeof import("../src/inventory/stock.service");

const PASSWORD = "password123";

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const tokens: Record<"advisor" | "mechanic" | "customer", string> = {} as never;
let advisorId = "";

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

const item = (sku: string, overrides: Record<string, unknown> = {}) => ({
  sku,
  name: `Part ${sku}`,
  category: "Filters",
  unitCost: "100",
  unitPrice: "180.50",
  supplier: "Bosch",
  reorderLevel: "2",
  openingQuantity: "5",
  ...overrides,
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const advisor = await prisma.user.create({
    data: { email: "advisor@inv.test", role: "ADVISOR", firstName: "Alex", lastName: "Test", passwordHash },
  });
  advisorId = advisor.id;
  await prisma.user.create({ data: { email: "mechanic@inv.test", role: "MECHANIC", firstName: "Sam", lastName: "Test", passwordHash } });
  await prisma.user.create({ data: { email: "customer@inv.test", role: "CUSTOMER", firstName: "Jo", lastName: "Test", passwordHash } });

  for (const [key, email] of [["advisor", "advisor@inv.test"], ["mechanic", "mechanic@inv.test"], ["customer", "customer@inv.test"]] as const) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password: PASSWORD }).expect(200);
    tokens[key] = res.body.accessToken;
  }
});

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("inventory", () => {
  let filterId = "";

  it("creates an item with an opening-stock movement, normalising the SKU", async () => {
    const res = await api(tokens.advisor).post("/inventory", item("flt-oil-hon", { name: "Oil filter Honda" })).expect(201);
    filterId = res.body.id;
    expect(res.body).toEqual(expect.objectContaining({ sku: "FLT-OIL-HON", quantityOnHand: 5, unitPrice: 180.5, isLowStock: false }));

    const detail = await api(tokens.advisor).get(`/inventory/${filterId}`).expect(200);
    expect(detail.body.movements).toEqual([
      expect.objectContaining({ quantityChange: 5, reason: "PURCHASE", note: "Opening stock", createdBy: expect.objectContaining({ name: "Alex Test" }) }),
    ]);
  });

  it("rejects a duplicate SKU regardless of case, and a direct quantity edit", async () => {
    await api(tokens.advisor).post("/inventory", item("FLT-OIL-HON")).expect(409);
    await api(tokens.advisor).patch(`/inventory/${filterId}`, { quantityOnHand: 99 }).expect(400);
  });

  it("receives stock and records a stocktake, newest movement first", async () => {
    await api(tokens.advisor).post(`/inventory/${filterId}/receive`, { quantity: "10", note: "INV-9001" }).expect(200);
    const afterCount = await api(tokens.advisor)
      .post(`/inventory/${filterId}/stocktake`, { countedQuantity: "14", reason: "Damaged box" })
      .expect(200);
    expect(afterCount.body.quantityOnHand).toBe(14);

    const detail = await api(tokens.advisor).get(`/inventory/${filterId}`).expect(200);
    expect(detail.body.movements.map((m: { quantityChange: number; reason: string }) => [m.quantityChange, m.reason])).toEqual([
      [-1, "ADJUSTMENT"],
      [10, "PURCHASE"],
      [5, "PURCHASE"],
    ]);
    await api(tokens.advisor).post(`/inventory/${filterId}/stocktake`, { countedQuantity: "14", reason: "Recount" }).expect(400);
  });

  it("filters low stock by each item's own reorder level, and searches SKU, name and supplier", async () => {
    await api(tokens.advisor).post("/inventory", item("BAT-60AH", { name: "Battery 60Ah", category: "Electrical", supplier: "GS Battery", openingQuantity: "2", reorderLevel: "2" })).expect(201);
    await api(tokens.advisor).post("/inventory", item("WPR-24", { name: "Wiper 24in", category: "Accessories", openingQuantity: "9", reorderLevel: "4" })).expect(201);

    const low = await api(tokens.advisor).get("/inventory?lowStock=true").expect(200);
    expect(low.body.items.map((i: { sku: string }) => i.sku)).toEqual(["BAT-60AH"]);

    for (const [q, sku] of [["bat-60", "BAT-60AH"], ["wiper", "WPR-24"], ["gs batt", "BAT-60AH"]]) {
      const res = await api(tokens.advisor).get(`/inventory?q=${encodeURIComponent(q)}`).expect(200);
      expect(res.body.items.map((i: { sku: string }) => i.sku)).toEqual([sku]);
    }

    const summary = await api(tokens.advisor).get("/inventory/summary").expect(200);
    expect(summary.body).toEqual({ activeItemCount: 3, lowStockCount: 1 });
    const categories = await api(tokens.mechanic).get("/inventory/categories").expect(200);
    expect(categories.body).toEqual(["Accessories", "Electrical", "Filters"]);
  });

  it("hides deactivated items unless asked, and blocks receiving them", async () => {
    const wiper = (await api(tokens.advisor).get("/inventory?q=WPR-24").expect(200)).body.items[0];
    await api(tokens.advisor).post(`/inventory/${wiper.id}/deactivate`).expect(200);

    expect((await api(tokens.advisor).get("/inventory?q=WPR-24").expect(200)).body.items).toHaveLength(0);
    expect((await api(tokens.advisor).get("/inventory?q=WPR-24&includeInactive=true").expect(200)).body.items).toHaveLength(1);
    await api(tokens.advisor).post(`/inventory/${wiper.id}/receive`, { quantity: 1 }).expect(400);
    await api(tokens.advisor).post(`/inventory/${wiper.id}/reactivate`).expect(200);
  });

  it("lets mechanics look things up but not change them, and keeps customers out", async () => {
    await api(tokens.mechanic).get("/inventory").expect(200);
    await api(tokens.mechanic).get(`/inventory/${filterId}`).expect(200);
    await api(tokens.mechanic).post("/inventory", item("NEW-1")).expect(403);
    await api(tokens.mechanic).post(`/inventory/${filterId}/receive`, { quantity: 1 }).expect(403);
    await api(tokens.mechanic).post(`/inventory/${filterId}/stocktake`, { countedQuantity: 1, reason: "nope" }).expect(403);
    await api(tokens.mechanic).get("/inventory/summary").expect(403);
    await api(tokens.customer).get("/inventory").expect(403);
  });

  it("never lets two simultaneous deductions push stock below zero", async () => {
    const created = await api(tokens.advisor).post("/inventory", item("RACE-1", { openingQuantity: "5" })).expect(201);
    const stock = app.get(StockService);
    const takeThree = () =>
      prisma.$transaction((tx) =>
        stock.change(tx, { inventoryItemId: created.body.id, change: -3, reason: "WORK_ORDER", actorId: advisorId }),
      );

    const results = await Promise.allSettled([takeThree(), takeThree()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain("Not enough stock: only 2");
    const after = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(after.quantityOnHand).toBe(2);
    expect(await prisma.stockMovement.count({ where: { inventoryItemId: created.body.id, reason: "WORK_ORDER" } })).toBe(1);
  });
});
