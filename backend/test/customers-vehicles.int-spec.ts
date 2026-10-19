import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { testDatabaseUrl } from "./integration-env";

/**
 * End-to-end through the real HTTP stack (guards, validation pipe, controllers) and a real
 * Postgres — mainly to prove the search and duplicate queries, which mocks can't.
 */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");

const PASSWORD = "password123";

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const tokens: Record<"admin" | "advisor" | "mechanic" | "jordan" | "malee", string> = {} as never;
const ids: Record<string, string> = {};

async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

async function login(email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password: PASSWORD }).expect(200);
  return res.body.accessToken;
}

function api(token: string) {
  const server = app.getHttpServer();
  return {
    get: (url: string) => request(server).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string, body?: object) => request(server).post(url).set("Authorization", `Bearer ${token}`).send(body),
    patch: (url: string, body?: object) => request(server).patch(url).set("Authorization", `Bearer ${token}`).send(body),
  };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = (email: string, role: "ADMIN" | "ADVISOR" | "MECHANIC" | "CUSTOMER", firstName: string) =>
    prisma.user.create({ data: { email, role, firstName, lastName: "Test", passwordHash } });

  await user("admin@test.example", "ADMIN", "Ada");
  await user("advisor@test.example", "ADVISOR", "Alex");
  await user("mechanic@test.example", "MECHANIC", "Sam");
  const jordanUser = await user("jordan@test.example", "CUSTOMER", "Jordan");
  const maleeUser = await user("malee@test.example", "CUSTOMER", "Malee");

  const jordan = await prisma.customer.create({
    data: { firstName: "Jordan", lastName: "Lee", phone: "+66812345678", email: "jordan@test.example", userId: jordanUser.id },
  });
  const malee = await prisma.customer.create({
    data: { firstName: "Malee", lastName: "Srisuk", phone: "+66898765432", email: "malee@test.example", userId: maleeUser.id },
  });
  const civic = await prisma.vehicle.create({
    data: {
      customerId: jordan.id,
      vin: "MRHFC1650KP000001",
      plate: "1กข 1234",
      plateNormalized: "1กข1234",
      province: "กรุงเทพมหานคร",
      make: "Honda",
      model: "Civic",
      year: 2019,
      mileage: 42000,
    },
  });
  const almera = await prisma.vehicle.create({
    data: {
      customerId: malee.id,
      vin: "MNTBB7A90K0000003",
      plate: "3กพ 9012",
      plateNormalized: "3กพ9012",
      province: "เชียงใหม่",
      make: "Nissan",
      model: "Almera",
      year: 2021,
      mileage: 23000,
    },
  });
  Object.assign(ids, { jordan: jordan.id, malee: malee.id, civic: civic.id, almera: almera.id });

  tokens.admin = await login("admin@test.example");
  tokens.advisor = await login("advisor@test.example");
  tokens.mechanic = await login("mechanic@test.example");
  tokens.jordan = await login("jordan@test.example");
  tokens.malee = await login("malee@test.example");
});

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("customer search (real SQL)", () => {
  it.each(["0812345678", "081-234-5678", "081 234 5678", "+66 81 234 5678", "234-56"])(
    "finds Jordan by phone typed as %p",
    async (q) => {
      const res = await api(tokens.advisor).get(`/customers?q=${encodeURIComponent(q)}`).expect(200);
      expect(res.body.items.map((c: { firstName: string }) => c.firstName)).toEqual(["Jordan"]);
    },
  );

  it.each(["1กข1234", "1กข-1234", "1กข 1234", "mrhfc1650", "jordan lee", "JORDAN"])(
    "finds Jordan by %p (plate, VIN or name)",
    async (q) => {
      const res = await api(tokens.advisor).get(`/customers?q=${encodeURIComponent(q)}`).expect(200);
      expect(res.body.items.map((c: { firstName: string }) => c.firstName)).toEqual(["Jordan"]);
    },
  );

  it("returns nothing for a name that doesn't exist, and an empty page past the end", async () => {
    const none = await api(tokens.advisor).get("/customers?q=zzzz").expect(200);
    expect(none.body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });

    const past = await api(tokens.advisor).get("/customers?page=9").expect(200);
    expect(past.body.items).toEqual([]);
    expect(past.body.total).toBe(2);
  });

  it("rejects an invalid page number", async () => {
    await api(tokens.advisor).get("/customers?page=0").expect(400);
  });
});

describe("customer duplicates and uniqueness", () => {
  it("warns about an existing phone in any format without blocking", async () => {
    const res = await api(tokens.advisor).get("/customers/duplicates?phone=089-876-5432").expect(200);
    expect(res.body.byPhone).toHaveLength(1);
    expect(res.body.byPhone[0].firstName).toBe("Malee");
  });

  it("lets staff create a customer with an existing phone (warning only)", async () => {
    const res = await api(tokens.advisor)
      .post("/customers", { firstName: "Malee", lastName: "Duplicate", phone: "0898765432" })
      .expect(201);
    expect(res.body.phone).toBe("+66898765432");
  });

  it("blocks a customer email that is already taken", async () => {
    const res = await api(tokens.advisor)
      .post("/customers", { firstName: "X", lastName: "Y", phone: "0811111111", email: "JORDAN@test.example" })
      .expect(409);
    expect(res.body.errors.email).toBeDefined();
  });
});

describe("vehicle search and duplicates", () => {
  it("finds a vehicle by plate regardless of spaces and dashes", async () => {
    const res = await api(tokens.advisor).get(`/vehicles?q=${encodeURIComponent("3กพ-9012")}`).expect(200);
    expect(res.body.items.map((v: { model: string }) => v.model)).toEqual(["Almera"]);
  });

  it("warns about the same plate in the same province only", async () => {
    const same = await api(tokens.advisor)
      .get(`/vehicles/duplicates?plate=${encodeURIComponent("1กข-1234")}&province=${encodeURIComponent("กรุงเทพมหานคร")}`)
      .expect(200);
    expect(same.body.plateMatchCount).toBe(1);

    const otherProvince = await api(tokens.advisor)
      .get(`/vehicles/duplicates?plate=${encodeURIComponent("1กข 1234")}&province=${encodeURIComponent("นนทบุรี")}`)
      .expect(200);
    expect(otherProvince.body.plateMatchCount).toBe(0);
  });

  it("blocks a duplicate VIN even when typed in lowercase", async () => {
    await api(tokens.advisor)
      .post("/vehicles", {
        customerId: ids.malee,
        vin: "mrhfc1650kp000001",
        plate: "9กก 9999",
        province: "ชลบุรี",
        make: "Honda",
        model: "Civic",
        year: 2019,
        mileage: 1,
      })
      .expect(409);
  });
});

describe("role and ownership rules over HTTP", () => {
  it("shows a customer only their own vehicles", async () => {
    const res = await api(tokens.jordan).get("/vehicles").expect(200);
    expect(res.body.items.map((v: { model: string }) => v.model)).toEqual(["Civic"]);
  });

  it("returns 404, not 403, for another customer's vehicle", async () => {
    await api(tokens.jordan).get(`/vehicles/${ids.almera}`).expect(404);
  });

  it("lets a customer add a vehicle to their own record only", async () => {
    const vehicle = {
      vin: "JHMCM56557C404453",
      plate: "5ขค 5555",
      province: "ภูเก็ต",
      make: "Toyota",
      model: "Yaris",
      year: 2022,
      mileage: 8000,
    };
    await api(tokens.jordan).post("/vehicles", { ...vehicle, customerId: ids.malee }).expect(403);
    const res = await api(tokens.jordan).post("/vehicles", vehicle).expect(201);
    expect(res.body.owner.id).toBe(ids.jordan);
  });

  it("blocks customers and mechanics from staff-only endpoints", async () => {
    await api(tokens.jordan).get("/customers").expect(403);
    await api(tokens.mechanic).patch(`/vehicles/${ids.civic}`, { color: "Blue" }).expect(403);
    await api(tokens.advisor).get("/users").expect(403);
    await api(tokens.advisor).post(`/vehicles/${ids.civic}/mileage-correction`, { mileage: 1, reason: "nope" }).expect(403);
  });

  it("refuses mileage on a normal edit but allows an admin correction", async () => {
    await api(tokens.advisor).patch(`/vehicles/${ids.civic}`, { mileage: 1000 }).expect(400);
    const res = await api(tokens.admin)
      .post(`/vehicles/${ids.civic}/mileage-correction`, { mileage: 41200, reason: "Typo at check-in" })
      .expect(200);
    expect(res.body.mileage).toBe(41200);

    const audit = await prisma.auditLog.findFirst({ where: { action: "vehicle.mileageCorrected", entityId: ids.civic } });
    expect(audit?.changes).toEqual({ mileage: { from: 42000, to: 41200 }, reason: "Typo at check-in" });
  });

  it("refuses a customer changing their own email", async () => {
    await api(tokens.jordan).patch("/customers/me", { email: "new@test.example" }).expect(400);
    const res = await api(tokens.jordan).patch("/customers/me", { lineId: "jordan.lee" }).expect(200);
    expect(res.body.lineId).toBe("jordan.lee");
  });
});

describe("clearing optional fields (what the edit forms send)", () => {
  it("clears LINE ID, email and notes on a walk-in customer when the form sends null", async () => {
    const created = await api(tokens.advisor)
      .post("/customers", { firstName: "Walk", lastName: "In", phone: "0899999999", email: "walk@test.example", lineId: "walkin", notes: "x" })
      .expect(201);

    const res = await api(tokens.advisor)
      .patch(`/customers/${created.body.id}`, {
        firstName: "Walk",
        lastName: "In",
        phone: "+66899999999",
        email: null,
        lineId: null,
        notes: null,
      })
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ email: null, lineId: null, notes: null }));
  });

  it("clears a vehicle's color and a customer's own LINE ID", async () => {
    const vehicle = await api(tokens.advisor).patch(`/vehicles/${ids.civic}`, { color: null }).expect(200);
    expect(vehicle.body.color).toBeNull();

    const me = await api(tokens.jordan).patch("/customers/me", { phone: "+66812345678", lineId: null }).expect(200);
    expect(me.body.lineId).toBeNull();
  });
});

describe("staff management over HTTP", () => {
  it("cuts off a deactivated user's existing token immediately", async () => {
    const created = await api(tokens.admin)
      .post("/users", {
        firstName: "Temp",
        lastName: "Mechanic",
        email: "temp@test.example",
        role: "MECHANIC",
        temporaryPassword: "temp-pass-1",
      })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "temp@test.example", password: "temp-pass-1" })
      .expect(200);
    const tempToken = res.body.accessToken;
    await api(tempToken).get("/auth/me").expect(200);

    await api(tokens.admin).post(`/users/${created.body.id}/deactivate`).expect(200);

    await api(tempToken).get("/auth/me").expect(401);
  });

  it("never lets the only admin lock themselves out", async () => {
    const me = await api(tokens.admin).get("/auth/me").expect(200);
    await api(tokens.admin).post(`/users/${me.body.id}/deactivate`).expect(403);
    await api(tokens.admin).patch(`/users/${me.body.id}`, { role: "ADVISOR" }).expect(403);
  });

  it("changes a user's own password and the old one stops working", async () => {
    await api(tokens.mechanic)
      .patch("/auth/me/password", { currentPassword: PASSWORD, newPassword: "a-new-password" })
      .expect(204);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "mechanic@test.example", password: PASSWORD })
      .expect(401);
  });
});
