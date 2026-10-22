import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { bangkokParts, SHOP } from "@motormate/types";
import { testDatabaseUrl } from "./integration-env";

/** Appointments over real HTTP + Postgres: booking, scoping, confirm, check-in → job → completion. */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");

const PASSWORD = "password123";

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const tokens: Record<"advisor" | "sam" | "jordan" | "other", string> = {} as never;
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

/** The `n`th next shop day (Bangkok), as yyyy-mm-dd — always more than a day away, so bookable. */
function shopDay(n: number): string {
  let found = 0;
  for (let days = 2; ; days++) {
    const { date, weekday } = bangkokParts(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
    if ((SHOP.hours.weekdays as readonly number[]).includes(weekday) && ++found === n) return date;
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = (email: string, role: "ADVISOR" | "MECHANIC" | "CUSTOMER", firstName: string) =>
    prisma.user.create({ data: { email, role, firstName, lastName: "Test", passwordHash } });
  await user("advisor@appt.test", "ADVISOR", "Alex");
  await user("sam@appt.test", "MECHANIC", "Sam");
  const jordanUser = await user("jordan@appt.test", "CUSTOMER", "Jordan");
  const otherUser = await user("other@appt.test", "CUSTOMER", "Other");

  const jordan = await prisma.customer.create({ data: { firstName: "Jordan", lastName: "Lee", phone: "+66812345678", userId: jordanUser.id } });
  await prisma.customer.create({ data: { firstName: "Other", lastName: "Test", phone: "+66899999999", userId: otherUser.id } });
  const vehicle = (vin: string, plate: string) =>
    prisma.vehicle.create({
      data: { customerId: jordan.id, vin, plate, plateNormalized: plate.replace(/[\s-]/g, ""), province: "กรุงเทพมหานคร", make: "Honda", model: "Civic", year: 2019, mileage: 42000 },
    });
  ids.civic = (await vehicle("MRHFC1650KP000101", "1กข 1234")).id;
  ids.jazz = (await vehicle("MRHFC1650KP000102", "2กข 2222")).id;

  for (const [key, email] of [["advisor", "advisor@appt.test"], ["sam", "sam@appt.test"], ["jordan", "jordan@appt.test"], ["other", "other@appt.test"]] as const) {
    tokens[key] = (await request(app.getHttpServer()).post("/auth/login").send({ email, password: PASSWORD }).expect(200)).body.accessToken;
  }
});

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("appointments", () => {
  let appointmentId = "";

  it("lets a customer request a time for their own car, once per car", async () => {
    const res = await api(tokens.jordan)
      .post("/appointments", { vehicleId: ids.civic, date: shopDay(1), time: "10:00", reason: "Brake inspection" })
      .expect(201);
    expect(res.body).toEqual(expect.objectContaining({ status: "REQUESTED", reason: "Brake inspection", customer: expect.objectContaining({ name: "Jordan Lee" }) }));
    expect(bangkokParts(res.body.scheduledAt)).toEqual(expect.objectContaining({ date: shopDay(1), time: "10:00" }));
    appointmentId = res.body.id;

    await api(tokens.jordan).post("/appointments", { vehicleId: ids.civic, date: shopDay(2), time: "10:00", reason: "Again" }).expect(409);
    // Outside shop hours → a field error on the time.
    const late = await api(tokens.jordan).post("/appointments", { vehicleId: ids.jazz, date: shopDay(1), time: "18:00", reason: "x" }).expect(400);
    expect(late.body.errors.time).toBeDefined();
  });

  it("shows it to staff and its owner only", async () => {
    await api(tokens.jordan).get(`/appointments/${appointmentId}`).expect(200);
    await api(tokens.other).get(`/appointments/${appointmentId}`).expect(404);
    expect((await api(tokens.other).get("/appointments").expect(200)).body.total).toBe(0);
    await api(tokens.other).post("/appointments", { vehicleId: ids.jazz, date: shopDay(1), time: "11:00", reason: "x" }).expect(404);
    await api(tokens.sam).get("/appointments").expect(403);

    const requests = await api(tokens.advisor).get("/appointments?view=requests").expect(200);
    expect(requests.body.items.map((a: { id: string }) => a.id)).toEqual([appointmentId]);
    expect((await api(tokens.advisor).get("/appointments/counts").expect(200)).body.requests).toBe(1);
  });

  it("lets the customer move a request, but not once it's confirmed", async () => {
    await api(tokens.jordan).patch(`/appointments/${appointmentId}`, { date: shopDay(2), time: "09:30" }).expect(200);
    await api(tokens.jordan).post(`/appointments/${appointmentId}/confirm`).expect(403);

    const confirmed = await api(tokens.advisor).post(`/appointments/${appointmentId}/confirm`).expect(200);
    expect(confirmed.body.status).toBe("CONFIRMED");
    await api(tokens.jordan).patch(`/appointments/${appointmentId}`, { date: shopDay(3), time: "09:30" }).expect(400);
  });

  it("checks in as a work order, and completes with the job", async () => {
    const job = await api(tokens.advisor)
      .post("/work-orders", { vehicleId: ids.civic, mileageIn: "43000", complaint: "Brake inspection", appointmentId })
      .expect(201);
    const checkedIn = await api(tokens.jordan).get(`/appointments/${appointmentId}`).expect(200);
    expect(checkedIn.body).toEqual(expect.objectContaining({ status: "CHECKED_IN", workOrder: { id: job.body.id, number: job.body.number } }));

    // Can't be checked in twice, or for another car.
    await api(tokens.advisor).post("/work-orders", { vehicleId: ids.jazz, mileageIn: "43000", complaint: "x", appointmentId }).expect(400);

    const advisor = api(tokens.advisor);
    await advisor.post(`/work-orders/${job.body.id}/labour`, { description: "Brake inspection", laborCost: "300" }).expect(201);
    for (const status of ["DIAGNOSING", "IN_PROGRESS", "QUALITY_CHECK", "COMPLETED"]) {
      await advisor.post(`/work-orders/${job.body.id}/status`, { status }).expect(200);
    }
    expect((await api(tokens.jordan).get(`/appointments/${appointmentId}`).expect(200)).body.status).toBe("COMPLETED");
  });

  it("lets a customer cancel their own, and staff book a confirmed one", async () => {
    const mine = await api(tokens.jordan).post("/appointments", { vehicleId: ids.jazz, date: shopDay(1), time: "14:00", reason: "Oil change" }).expect(201);
    await api(tokens.other).post(`/appointments/${mine.body.id}/cancel`, {}).expect(404);
    const cancelled = await api(tokens.jordan).post(`/appointments/${mine.body.id}/cancel`, { reason: "Changed my mind" }).expect(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    await api(tokens.jordan).post(`/appointments/${mine.body.id}/cancel`, {}).expect(400);

    const booked = await api(tokens.advisor).post("/appointments", { vehicleId: ids.jazz, date: shopDay(1), time: "15:00", reason: "Phone booking" }).expect(201);
    expect(booked.body.status).toBe("CONFIRMED");
    // A confirmed appointment in the future can't be a no-show yet.
    await api(tokens.advisor).post(`/appointments/${booked.body.id}/no-show`).expect(400);
  });
});
