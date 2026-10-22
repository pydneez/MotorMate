import { InvalidParameterException, NotFoundException as SnsNotFound, SNSClient } from "@aws-sdk/client-sns";
import { bangkokDateTime, estimateMileage, reminderState, shopDayEnded } from "@motormate/types";
import { createPrismaMock } from "../../test/prisma-mock";
import { appointmentEmail, serviceReminderEmail } from "../notifications/email-text";
import { NotifierService, snsSubject } from "../notifications/notifier.service";
import { RemindersService } from "./reminders.service";

// Thursday 22 Oct 2026, 10:00 in Bangkok.
const NOW = new Date("2026-10-22T03:00:00.000Z");
const at = (date: string, time: string) => bangkokDateTime(date, time)!;
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("reminder rules (packages/types)", () => {
  it("estimates today's mileage from the average km/day between visits", () => {
    const readings = [
      { date: "2026-01-01T03:00:00.000Z", km: 10_000 },
      { date: "2026-04-11T03:00:00.000Z", km: 15_000 }, // 100 days later: 50 km/day
    ];
    expect(estimateMileage(readings, new Date("2026-04-21T03:00:00.000Z"))).toEqual({ km: 15_500, kmPerDay: 50, fromHistory: true });
  });

  it("falls back to 40 km/day with one visit, visits too close together, or no movement", () => {
    const now = new Date("2026-01-11T03:00:00.000Z");
    expect(estimateMileage([{ date: "2026-01-01T03:00:00.000Z", km: 10_000 }], now)).toEqual({ km: 10_400, kmPerDay: 40, fromHistory: false });
    const close = [
      { date: "2025-12-20T03:00:00.000Z", km: 9_000 },
      { date: "2026-01-01T03:00:00.000Z", km: 10_000 },
    ];
    expect(estimateMileage(close, now).kmPerDay).toBe(40);
    const still = [
      { date: "2025-06-01T03:00:00.000Z", km: 10_000 },
      { date: "2026-01-01T03:00:00.000Z", km: 10_000 },
    ];
    expect(estimateMileage(still, now).fromHistory).toBe(false);
  });

  it("is due 7 days before a due date and overdue after it (Bangkok calendar days)", () => {
    const state = (date: string) => reminderState({ dueMileage: null, dueDate: day(date) }, 0, NOW);
    expect(state("2026-10-30")).toBe("upcoming");
    expect(state("2026-10-29")).toBe("due");
    expect(state("2026-10-22")).toBe("due"); // today is not overdue yet
    expect(state("2026-10-21")).toBe("overdue");
  });

  it("is due within 1,000 km of the due mileage and overdue at it", () => {
    const state = (km: number) => reminderState({ dueMileage: 50_000, dueDate: null }, km, NOW);
    expect(state(48_999)).toBe("upcoming");
    expect(state(49_000)).toBe("due");
    expect(state(50_000)).toBe("overdue");
  });

  it("takes whichever of date and mileage comes first", () => {
    expect(reminderState({ dueMileage: 50_000, dueDate: day("2027-06-01") }, 49_500, NOW)).toBe("due");
    expect(reminderState({ dueMileage: 90_000, dueDate: day("2026-10-01") }, 49_500, NOW)).toBe("overdue");
  });

  it("ends the shop day at closing time (18:00 Bangkok)", () => {
    const appointment = at("2026-10-22", "10:00");
    expect(shopDayEnded(appointment, at("2026-10-22", "17:59"))).toBe(false);
    expect(shopDayEnded(appointment, at("2026-10-22", "18:00"))).toBe(true);
    expect(shopDayEnded(at("2026-10-21", "16:30"), NOW)).toBe(true);
  });
});

describe("emails", () => {
  it("groups a service reminder by vehicle, keeping Thai plates out of the subject", () => {
    const vehicle = { make: "Honda", model: "Civic", plate: "1กข 1234", province: "กรุงเทพมหานคร" };
    const { subject, body } = serviceReminderEmail(
      "Jordan",
      [
        { vehicle, description: "Brake pads check", dueMileage: 50_000, dueDate: null, estimatedKm: 49_200 },
        { vehicle, description: "Coolant flush", dueMileage: null, dueDate: day("2026-10-28"), estimatedKm: 49_200 },
      ],
      false,
    );
    expect(subject).toBe("[MOTORMATE] Service coming up for your Honda Civic");
    expect(body).toContain("Honda Civic (1กข 1234 กรุงเทพมหานคร)");
    expect(body).toContain("  - Brake pads check: at 50,000 km (you're at about 49,200 km)");
    expect(body).toContain("  - Coolant flush: by 28 Oct 2026");
    expect(serviceReminderEmail("Jordan", [{ vehicle, description: "x", dueMileage: 1, dueDate: null, estimatedKm: 0 }], true).subject).toBe(
      "[MOTORMATE] Reminder: your Honda Civic is still due for service",
    );
    expect(body.endsWith(
      [
        "MotorMate Auto Service 🔧",
        "99 Soi Car Won't Start, Road to Nowhere, Khlong Luang, Pathum Thani 12120",
        "Tel: 02-676-7676",
        "Hours: Mon–Sat: 8:00 AM – 6:00 PM",
      ].join("\n"),
    )).toBe(true);
  });

  it("writes appointment times in Bangkok time", () => {
    const appointment = { scheduledAt: at("2026-10-23", "10:00"), reason: "Oil change", vehicle: { make: "Honda", model: "Civic", plate: "1กข 1234" } };
    expect(appointmentEmail("confirmed", "Jordan", appointment).subject).toBe("[MOTORMATE] Appointment confirmed: Fri 23 Oct 2026, 10:00");
    expect(appointmentEmail("reminder", "Jordan", appointment).subject).toBe("[MOTORMATE] See you tomorrow: Fri 23 Oct 2026, 10:00");
    expect(appointmentEmail("cancelled", "Jordan", appointment).subject).toBe("[MOTORMATE] Appointment cancelled: Fri 23 Oct 2026, 10:00");
  });

  it("makes subjects SNS-safe: ASCII, one line, under 100 characters", () => {
    expect(snsSubject("Plate 1กข 1234\nnext")).toBe("Plate 1 1234 next");
    expect(snsSubject("x".repeat(120))).toHaveLength(99);
    expect(snsSubject("กข")).toBe("MotorMate");
  });
});

describe("NotifierService", () => {
  const customer = { id: "cust-1", email: "jordan@example.com", notifyConfirmed: false };
  const message = { type: "SERVICE_REMINDER" as const, customer, subject: "Service coming up", body: "Hello" };

  afterEach(() => {
    delete process.env.NOTIFY_TOPIC_ARN;
    jest.restoreAllMocks();
  });

  it("locally, logs the email and records one row per recommendation", async () => {
    const { prisma, service } = createPrismaMock();
    const notifier = new NotifierService(service);
    expect(notifier.mode).toBe("log");
    expect(notifier.notifyStatus(customer)).toBe("local");

    await expect(notifier.send({ ...message, recommendationIds: ["rec-1", "rec-2"] })).resolves.toBe("sent");
    const rows = prisma.notificationLog.createMany.mock.calls[0][0].data;
    expect(rows.map((row: { recommendationId: string }) => row.recommendationId)).toEqual(["rec-1", "rec-2"]);
    expect(rows[0]).toEqual(expect.objectContaining({ status: "SENT", recipientEmail: "jordan@example.com", customerId: "cust-1" }));
  });

  it("skips customers without an email — recorded as not sent only when asked", async () => {
    const { prisma, service } = createPrismaMock();
    const notifier = new NotifierService(service);
    const noEmail = { ...message, customer: { ...customer, email: null } };
    await expect(notifier.send(noEmail)).resolves.toBe("noEmail");
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();

    await expect(notifier.send({ ...noEmail, recordSkipped: true })).resolves.toBe("noEmail");
    expect(prisma.notificationLog.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({ status: "SKIPPED", error: "No email address", recipientEmail: null, sentAt: null }),
    );
  });

  it("on AWS, publishes only to confirmed subscribers, tagged with their address", async () => {
    process.env.NOTIFY_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:motormate-notifications";
    const publish = jest.spyOn(SNSClient.prototype, "send").mockResolvedValue({} as never) as unknown as jest.Mock;
    const { prisma, service } = createPrismaMock();
    const notifier = new NotifierService(service);
    expect(notifier.notifyStatus(customer)).toBe("pending");

    await expect(notifier.send(message)).resolves.toBe("notConfirmed");
    expect(publish).not.toHaveBeenCalled();
    expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
    // An appointment email that can't go out is recorded, so staff know to call.
    await expect(notifier.send({ ...message, recordSkipped: true })).resolves.toBe("notConfirmed");
    expect(prisma.notificationLog.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({ status: "SKIPPED", error: "Email not confirmed (AWS subscription)", recipientEmail: "jordan@example.com" }),
    );

    await expect(notifier.send({ ...message, customer: { ...customer, email: "Jordan@Example.com", notifyConfirmed: true } })).resolves.toBe("sent");
    expect(publish.mock.calls[0][0].input).toEqual(
      expect.objectContaining({ Subject: "Service coming up", MessageAttributes: { email: { DataType: "String", StringValue: "jordan@example.com" } } }),
    );
    expect(prisma.notificationLog.createMany).toHaveBeenCalledTimes(2);
  });

  it("records a failed publish", async () => {
    process.env.NOTIFY_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:motormate-notifications";
    jest.spyOn(SNSClient.prototype, "send").mockRejectedValue(new Error("AccessDenied") as never);
    const { prisma, service } = createPrismaMock();
    await expect(new NotifierService(service).send({ ...message, customer: { ...customer, notifyConfirmed: true } })).resolves.toBe("failed");
    expect(prisma.notificationLog.createMany.mock.calls[0][0].data[0]).toEqual(expect.objectContaining({ status: "FAILED", error: "AccessDenied" }));
  });

  /** Answers SNS commands by name. */
  function snsMock(answers: Record<string, unknown>) {
    return jest.spyOn(SNSClient.prototype, "send").mockImplementation((command: { constructor: { name: string } }) => {
      const answer = answers[command.constructor.name];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? {});
    }) as unknown as jest.Mock;
  }
  const newCustomer = { id: "cust-1", email: "Jordan@Example.com", notifySubscriptionArn: null, notifyEmail: null, notifyConfirmed: false };

  it("subscribes an address with a filter on the address, waiting for confirmation", async () => {
    process.env.NOTIFY_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:motormate-notifications";
    const sns = snsMock({ SubscribeCommand: { SubscriptionArn: "arn:sub-1" }, GetSubscriptionAttributesCommand: { Attributes: { PendingConfirmation: "true" } } });
    const { prisma, service } = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue(newCustomer);

    await expect(new NotifierService(service).syncCustomer("cust-1")).resolves.toBe(true);
    expect(sns.mock.calls[0][0].input.Attributes).toEqual({ FilterPolicy: '{"email":["jordan@example.com"]}', FilterPolicyScope: "MessageAttributes" });
    expect(prisma.customer.update.mock.calls.map((call) => call[0].data)).toEqual([
      { notifySubscriptionArn: "arn:sub-1", notifyEmail: "Jordan@Example.com", notifyConfirmed: false },
      { notifyConfirmed: false },
    ]);
  });

  it("reuses an address that was already confirmed (e.g. after the database was rebuilt)", async () => {
    process.env.NOTIFY_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:motormate-notifications";
    snsMock({ SubscribeCommand: { SubscriptionArn: "arn:sub-1" }, GetSubscriptionAttributesCommand: { Attributes: { PendingConfirmation: "false" } } });
    const { prisma, service } = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue(newCustomer);

    await new NotifierService(service).syncCustomer("cust-1");
    expect(prisma.customer.update.mock.calls.at(-1)![0].data).toEqual({ notifyConfirmed: true });
  });

  it("moves a subscription made with the old customer-id filter over to the address", async () => {
    process.env.NOTIFY_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:motormate-notifications";
    const sns = snsMock({
      SubscribeCommand: new InvalidParameterException({ message: "Invalid parameter: Attributes Reason: Subscription already exists with different attributes", $metadata: {} }),
      ListSubscriptionsByTopicCommand: {
        Subscriptions: [
          { Endpoint: "jordan@example.com", SubscriptionArn: "arn:old-sub" },
          { Endpoint: "other@example.com", SubscriptionArn: "arn:other" },
        ],
      },
      GetSubscriptionAttributesCommand: { Attributes: { PendingConfirmation: "false" } },
    });
    const { prisma, service } = createPrismaMock();
    prisma.customer.findUnique.mockResolvedValue(newCustomer);

    await expect(new NotifierService(service).syncCustomer("cust-1")).resolves.toBe(true);
    const set = sns.mock.calls.find(([command]) => command.constructor.name === "SetSubscriptionAttributesCommand")![0];
    expect(set.input).toEqual({ SubscriptionArn: "arn:old-sub", AttributeName: "FilterPolicy", AttributeValue: '{"email":["jordan@example.com"]}' });
    expect(prisma.customer.update.mock.calls.at(-1)![0].data).toEqual({ notifyConfirmed: true });
  });

  it("notices when a customer unsubscribed (AWS's unsubscribe link)", async () => {
    process.env.NOTIFY_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:motormate-notifications";
    snsMock({ GetSubscriptionAttributesCommand: new SnsNotFound({ message: "Subscription does not exist", $metadata: {} }) });
    const { prisma, service } = createPrismaMock();
    prisma.customer.findMany.mockResolvedValue([
      { id: "cust-1", email: "jordan@example.com", notifySubscriptionArn: "arn:sub-1", notifyEmail: "jordan@example.com", notifyConfirmed: true },
    ]);

    await expect(new NotifierService(service).syncAll()).resolves.toBe(0);
    expect(prisma.customer.update.mock.calls[0][0]).toEqual({ where: { id: "cust-1" }, data: { notifySubscriptionArn: null, notifyConfirmed: false } });
  });
});

describe("RemindersService", () => {
  const jordan = { id: "cust-1", firstName: "Jordan", lastName: "Lee", phone: "+66812345678", email: "jordan@example.com", notifyConfirmed: true };
  const somchai = { ...jordan, id: "cust-2", firstName: "Somchai", email: "somchai@example.com" };

  /** A recommendation on a vehicle last seen at 48,000 km today (so ~48,000 km now). */
  const rec = (id: string, overrides: Record<string, unknown> = {}, customer = jordan) => ({
    id,
    description: `Item ${id}`,
    dueMileage: null,
    dueDate: null,
    status: "OPEN",
    vehicle: {
      id: `veh-${customer.id}`,
      plate: "1กข 1234",
      province: "กรุงเทพมหานคร",
      make: "Honda",
      model: "Civic",
      mileage: 48_000,
      createdAt: NOW,
      customer,
      workOrders: [{ mileageIn: 48_000, createdAt: NOW }],
    },
    workOrder: null,
    notifications: [] as { createdAt: Date }[],
    ...overrides,
  });

  // The staff views use the clock; the jobs take `now`.
  beforeEach(() => jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  function setup(sendResult: string = "sent") {
    const { prisma, service } = createPrismaMock();
    const notifier = {
      syncAll: jest.fn().mockResolvedValue(0),
      send: jest.fn().mockResolvedValue(sendResult),
      notifyStatus: jest.fn().mockReturnValue("confirmed"),
    };
    return { prisma, notifier, reminders: new RemindersService(service, notifier as unknown as NotifierService) };
  }

  it("lists items by state, most pressing first", async () => {
    const { prisma, reminders } = setup();
    prisma.serviceRecommendation.findMany.mockResolvedValue([
      rec("later", { dueMileage: 60_000 }),
      rec("in-6-days", { dueDate: day("2026-10-28") }),
      rec("in-500-km", { dueMileage: 48_500 }), // ~12 days at 40 km/day
      rec("late", { dueDate: day("2026-10-01") }),
    ]);
    const due = await reminders.list({ view: "due", page: 1, pageSize: 20 });
    expect(due.items.map((item) => item.id)).toEqual(["in-6-days", "in-500-km"]);
    expect(due.items[1]).toEqual(expect.objectContaining({ estimatedMileage: 48_000, state: "due", customer: expect.objectContaining({ notify: "confirmed" }) }));
    await expect(reminders.counts()).resolves.toEqual({ due: 2, overdue: 1 });
  });

  it("sends one email per customer with everything due, and marks those items reminded", async () => {
    const { prisma, notifier, reminders } = setup();
    prisma.serviceRecommendation.findMany.mockResolvedValue([
      rec("due-1", { dueMileage: 48_500 }),
      rec("due-2", { dueDate: day("2026-10-25") }),
      rec("upcoming", { dueMileage: 70_000 }),
      rec("other", { dueDate: day("2026-10-20") }, somchai),
    ]);
    prisma.serviceRecommendation.updateMany.mockResolvedValue({ count: 1 });

    const summary = await reminders.runMorning(NOW);
    expect(notifier.send).toHaveBeenCalledTimes(2);
    const toJordan = notifier.send.mock.calls.find(([n]) => n.customer.id === "cust-1")![0];
    expect(toJordan).toEqual(expect.objectContaining({ type: "SERVICE_REMINDER", recommendationIds: ["due-2", "due-1"] })); // soonest first
    expect(toJordan.body).not.toContain("Item upcoming");
    expect(prisma.serviceRecommendation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["due-2", "due-1"] }, status: "OPEN" },
      data: { status: "REMINDED" },
    });
    expect(summary).toEqual(expect.objectContaining({ reminders: 3, followUps: 0, failed: 0 }));
  });

  it("follows up once, 30 days after the first reminder", async () => {
    const { prisma, notifier, reminders } = setup();
    const sent = (daysAgo: number) => ({ createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS) });
    prisma.serviceRecommendation.findMany.mockResolvedValue([
      rec("too-soon", { status: "REMINDED", dueMileage: 48_500, notifications: [sent(29)] }),
      rec("already", { status: "REMINDED", dueMileage: 48_500, notifications: [sent(60), sent(30)] }, somchai),
    ]);
    await reminders.runMorning(NOW);
    expect(notifier.send).not.toHaveBeenCalled();

    prisma.serviceRecommendation.findMany.mockResolvedValue([rec("follow", { status: "REMINDED", dueMileage: 48_500, notifications: [sent(30)] })]);
    const summary = await reminders.runMorning(NOW);
    expect(notifier.send.mock.calls[0][0].subject).toBe("[MOTORMATE] Reminder: your Honda Civic is still due for service");
    expect(prisma.serviceRecommendation.updateMany.mock.calls[0][0].where.id.in).toEqual([]);
    expect(summary.followUps).toBe(1);
  });

  it("leaves items open when the email couldn't go out, so the next run tries again", async () => {
    const { prisma, reminders } = setup("notConfirmed");
    prisma.serviceRecommendation.findMany.mockResolvedValue([rec("due-1", { dueMileage: 48_500 })]);
    const summary = await reminders.runMorning(NOW);
    expect(prisma.serviceRecommendation.updateMany).not.toHaveBeenCalled();
    expect(summary).toEqual(expect.objectContaining({ reminders: 0, notConfirmed: 1 }));
  });

  it("emails tomorrow's confirmed appointments that haven't had their reminder", async () => {
    const { prisma, notifier, reminders } = setup();
    prisma.appointment.findMany.mockResolvedValue([
      { id: "appt-1", scheduledAt: at("2026-10-23", "10:00"), reason: "Oil change", customer: jordan, vehicle: { make: "Honda", model: "Civic", plate: "1กข 1234" } },
    ]);
    const summary = await reminders.runMorning(NOW);
    expect(prisma.appointment.findMany.mock.calls[0][0].where).toEqual({
      status: "CONFIRMED",
      scheduledAt: { gte: at("2026-10-23", "00:00"), lt: at("2026-10-24", "00:00") },
      notifications: { none: { type: "APPOINTMENT_REMINDER", status: { in: ["SENT", "SKIPPED"] } } },
    });
    expect(notifier.send.mock.calls[0][0]).toEqual(expect.objectContaining({ type: "APPOINTMENT_REMINDER", appointmentId: "appt-1" }));
    expect(summary.appointmentReminders).toBe(1);
  });

  it("closes the day: confirmed → no-show, never confirmed → cancelled, by the system", async () => {
    const { prisma, reminders } = setup();
    prisma.appointment.findMany.mockResolvedValue([
      { id: "appt-1", status: "CONFIRMED", scheduledAt: at("2026-10-22", "10:00") },
      { id: "appt-2", status: "REQUESTED", scheduledAt: at("2026-10-21", "15:00") },
    ]);
    prisma.appointment.updateMany.mockResolvedValue({ count: 1 });

    // Before closing time only yesterday's request is touched.
    await expect(reminders.runCloseDay(at("2026-10-22", "16:00"))).resolves.toEqual({ noShows: 0, expired: 1 });
    expect(prisma.appointment.updateMany.mock.calls[0][0]).toEqual({ where: { id: "appt-2", status: "REQUESTED" }, data: { status: "CANCELLED" } });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ actorId: null, action: "appointment.expired", changes: expect.objectContaining({ by: "system", reason: "Not confirmed in time" }) }),
    );

    prisma.appointment.updateMany.mockClear();
    await expect(reminders.runCloseDay(at("2026-10-22", "18:30"))).resolves.toEqual({ noShows: 1, expired: 1 });
    expect(prisma.appointment.updateMany.mock.calls[0][0].data).toEqual({ status: "NO_SHOW" });
  });

  it("doesn't count an appointment that was checked in meanwhile", async () => {
    const { prisma, reminders } = setup();
    prisma.appointment.findMany.mockResolvedValue([{ id: "appt-1", status: "CONFIRMED", scheduledAt: at("2026-10-21", "10:00") }]);
    prisma.appointment.updateMany.mockResolvedValue({ count: 0 });
    await expect(reminders.runCloseDay(NOW)).resolves.toEqual({ noShows: 0, expired: 0 });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
