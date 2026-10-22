import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request = require("supertest");
import { bangkokDateTime, bangkokParts } from "@motormate/types";
import { testDatabaseUrl } from "./integration-env";

/**
 * Reminders over real HTTP + Postgres: the job endpoint's token, the staff page's API, the
 * morning job's emails (logged, no SNS topic) and the end-of-day job.
 */

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= "integration-test-secret";
process.env.JOB_TOKEN = "integration-job-token";
delete process.env.NOTIFY_TOPIC_ARN;

// Imported after DATABASE_URL is pointed at the test database.
const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
const { PrismaService } = require("../src/prisma/prisma.service") as typeof import("../src/prisma/prisma.service");

const PASSWORD = "password123";
const DAY_MS = 24 * 60 * 60 * 1000;

let app: INestApplication;
let prisma: InstanceType<typeof PrismaService>;
const tokens: Record<"advisor" | "sam" | "jordan", string> = {} as never;
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

/** Bangkok calendar day `offset` days from today, as yyyy-mm-dd. */
const bangkokDay = (offset: number) => bangkokParts(new Date(Date.now() + offset * DAY_MS)).date;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  await resetDatabase();

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = (email: string, role: "ADVISOR" | "MECHANIC" | "CUSTOMER", firstName: string) =>
    prisma.user.create({ data: { email, role, firstName, lastName: "Test", passwordHash } });
  const advisor = await user("advisor@rem.test", "ADVISOR", "Alex");
  await user("sam@rem.test", "MECHANIC", "Sam");
  const jordanUser = await user("jordan@rem.test", "CUSTOMER", "Jordan");

  const jordan = await prisma.customer.create({
    data: { firstName: "Jordan", lastName: "Lee", phone: "+66812345678", email: "jordan@rem.test", userId: jordanUser.id },
  });
  ids.jordan = jordan.id;
  const vehicle = await prisma.vehicle.create({
    data: { customerId: jordan.id, vin: "MRHFC1650KP000201", plate: "1กข 1234", plateNormalized: "1กข1234", province: "กรุงเทพมหานคร", make: "Honda", model: "Civic", year: 2019, mileage: 42000 },
  });
  ids.vehicle = vehicle.id;
  const rec = (description: string, data: { dueMileage?: number; dueDate?: Date }) =>
    prisma.serviceRecommendation.create({ data: { vehicleId: vehicle.id, description, createdById: advisor.id, ...data } });
  ids.dueByDate = (await rec("Coolant flush", { dueDate: new Date(`${bangkokDay(3)}T00:00:00.000Z`) })).id;
  ids.dueByKm = (await rec("Brake pads check", { dueMileage: 42_500 })).id;
  ids.upcoming = (await rec("Timing belt", { dueMileage: 90_000 })).id;

  const appointment = (date: string, time: string, status: "REQUESTED" | "CONFIRMED") =>
    prisma.appointment.create({
      data: { customerId: jordan.id, vehicleId: vehicle.id, scheduledAt: bangkokDateTime(date, time)!, reason: "Oil change", status, createdById: jordanUser.id },
    });
  ids.missed = (await appointment(bangkokDay(-2), "10:00", "CONFIRMED")).id;
  ids.unconfirmed = (await appointment(bangkokDay(-2), "11:00", "REQUESTED")).id;
  ids.tomorrow = (await appointment(bangkokDay(1), "10:00", "CONFIRMED")).id;

  for (const [key, email] of [["advisor", "advisor@rem.test"], ["sam", "sam@rem.test"], ["jordan", "jordan@rem.test"]] as const) {
    tokens[key] = (await request(app.getHttpServer()).post("/auth/login").send({ email, password: PASSWORD }).expect(200)).body.accessToken;
  }
});

afterAll(async () => {
  await resetDatabase();
  await app.close();
});

describe("reminders", () => {
  it("lists what's due for staff only", async () => {
    const res = await api(tokens.advisor).get("/reminders?view=due").expect(200);
    expect(res.body.items.map((item: { id: string }) => item.id).sort()).toEqual([ids.dueByDate, ids.dueByKm].sort());
    expect(res.body.items[0].customer).toEqual(expect.objectContaining({ name: "Jordan Lee", notify: "local" }));
    await api(tokens.advisor).get("/reminders/counts").expect(200, { due: 2, overdue: 0 });
    await api(tokens.sam).get("/reminders").expect(403);
    await api(tokens.jordan).get("/reminders").expect(403);
  });

  it("shows a customer their own items", async () => {
    const res = await api(tokens.jordan).get("/reminders/mine").expect(200);
    expect(res.body).toHaveLength(3);
    await api(tokens.advisor).get("/reminders/mine").expect(403);
  });

  it("only runs a job with the right token", async () => {
    const server = app.getHttpServer();
    await request(server).post("/jobs/morning").expect(403);
    await request(server).post("/jobs/morning").set("x-job-token", "wrong").expect(403);
    await request(server).post("/jobs/nope").set("x-job-token", "integration-job-token").expect(404);
  });

  it("closes past days: confirmed → no-show, unconfirmed → cancelled", async () => {
    const res = await request(app.getHttpServer()).post("/jobs/close-day").set("x-job-token", "integration-job-token").expect(200);
    expect(res.body).toEqual({ noShows: 1, expired: 1 });
    const statuses = await prisma.appointment.findMany({ select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map((a) => [a.id, a.status]))).toEqual({ [ids.missed]: "NO_SHOW", [ids.unconfirmed]: "CANCELLED", [ids.tomorrow]: "CONFIRMED" });
    const audit = await prisma.auditLog.findFirst({ where: { entityId: ids.missed } });
    expect(audit).toEqual(expect.objectContaining({ actorId: null, action: "appointment.noShow" }));
  });

  it("emails what's due once, plus tomorrow's appointment, and records it", async () => {
    const run = () => request(app.getHttpServer()).post("/jobs/morning").set("x-job-token", "integration-job-token").expect(200);
    expect((await run()).body).toEqual(expect.objectContaining({ reminders: 2, followUps: 0, appointmentReminders: 1, failed: 0 }));
    expect((await run()).body).toEqual(expect.objectContaining({ reminders: 0, appointmentReminders: 0 }));

    const logs = await prisma.notificationLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((log) => [log.type, log.status, log.recommendationId ?? log.appointmentId])).toEqual(
      expect.arrayContaining([
        ["SERVICE_REMINDER", "SENT", ids.dueByDate],
        ["SERVICE_REMINDER", "SENT", ids.dueByKm],
        ["APPOINTMENT_REMINDER", "SENT", ids.tomorrow],
      ]),
    );
    expect(logs).toHaveLength(3);
    const reminded = await prisma.serviceRecommendation.findMany({ where: { status: "REMINDED" }, select: { id: true } });
    expect(reminded.map((r) => r.id).sort()).toEqual([ids.dueByDate, ids.dueByKm].sort());

    const history = await api(tokens.advisor).get("/reminders/history").expect(200);
    expect(history.body.total).toBe(2); // the two items went out in one email
    expect(history.body.items[0].customer).toEqual({ id: ids.jordan, name: "Jordan Lee" });
  });

  it("lets staff close an item as done or dismissed, once", async () => {
    await api(tokens.advisor).patch(`/reminders/recommendations/${ids.dueByKm}`, { status: "DONE" }).expect(204);
    await api(tokens.advisor).patch(`/reminders/recommendations/${ids.dueByKm}`, { status: "DISMISSED" }).expect(400);
    await api(tokens.advisor).patch(`/reminders/recommendations/${ids.upcoming}`, { status: "NOPE" }).expect(400);
    await api(tokens.sam).patch(`/reminders/recommendations/${ids.upcoming}`, { status: "DONE" }).expect(403);
    await api(tokens.advisor).patch("/reminders/recommendations/missing", { status: "DONE" }).expect(404);
    expect(await prisma.auditLog.count({ where: { action: "recommendation.done", entityId: ids.dueByKm } })).toBe(1);
  });

  it("runs both jobs from the button (admin/advisor)", async () => {
    const res = await api(tokens.advisor).post("/reminders/run").expect(200);
    expect(res.body).toEqual({ morning: expect.objectContaining({ reminders: 0 }), closeDay: { noShows: 0, expired: 0 } });
    await api(tokens.sam).post("/reminders/run").expect(403);
  });

  it("emails the customer when staff confirm an appointment", async () => {
    const request = await prisma.appointment.create({
      data: {
        customerId: ids.jordan,
        vehicleId: (await prisma.vehicle.create({
          data: { customerId: ids.jordan, vin: "MRHFC1650KP000202", plate: "2กข 2222", plateNormalized: "2กข2222", province: "กรุงเทพมหานคร", make: "Honda", model: "Jazz", year: 2020, mileage: 10000 },
        })).id,
        scheduledAt: bangkokDateTime(bangkokDay(5), "10:00")!,
        reason: "Oil change",
        createdById: (await prisma.user.findFirstOrThrow({ where: { email: "jordan@rem.test" } })).id,
      },
    });
    await api(tokens.advisor).post(`/appointments/${request.id}/confirm`).expect(200);
    const log = await prisma.notificationLog.findFirst({ where: { appointmentId: request.id } });
    expect(log).toEqual(expect.objectContaining({ type: "APPOINTMENT_CONFIRMED", status: "SENT", recipientEmail: "jordan@rem.test" }));
  });

  it("records an appointment email it couldn't send, so staff know to call", async () => {
    const walkIn = await prisma.customer.create({ data: { firstName: "Walk", lastName: "In", phone: "+66811111111" } });
    const vehicle = await prisma.vehicle.create({
      data: { customerId: walkIn.id, vin: "MRHFC1650KP000203", plate: "3กข 3333", plateNormalized: "3กข3333", province: "กรุงเทพมหานคร", make: "Toyota", model: "Vios", year: 2018, mileage: 50000 },
    });
    const booked = await api(tokens.advisor)
      .post("/appointments", { vehicleId: vehicle.id, date: nextShopDay(), time: "10:00", reason: "Brake check" })
      .expect(201);
    const log = await prisma.notificationLog.findFirst({ where: { appointmentId: booked.body.id } });
    expect(log).toEqual(expect.objectContaining({ type: "APPOINTMENT_CONFIRMED", status: "SKIPPED", recipientEmail: null, error: "No email address" }));

    const history = await api(tokens.advisor).get("/reminders/history").expect(200);
    expect(history.body.items[0]).toEqual(expect.objectContaining({ status: "SKIPPED", recipientEmail: null, customer: { id: walkIn.id, name: "Walk In" } }));
  });
});

/** A bookable day (Mon–Sat) at least two days ahead, as yyyy-mm-dd. */
function nextShopDay(): string {
  for (let days = 2; ; days++) {
    const { date, weekday } = bangkokParts(new Date(Date.now() + days * DAY_MS));
    if (weekday !== 0) return date;
  }
}
