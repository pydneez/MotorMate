import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import {
  appointmentActions,
  appointmentSlots,
  bangkokDateTime,
  bangkokParts,
  bookingTimeError,
  CreateAppointmentSchema,
} from "@motormate/types";
import { createPrismaMock, makeAuthUser } from "../../test/prisma-mock";
import { AppointmentsService } from "./appointments.service";

// Wednesday 21 Oct 2026, 10:00 in Bangkok.
const NOW = new Date("2026-10-21T03:00:00.000Z");
const at = (date: string, time: string) => bangkokDateTime(date, time)!;

describe("appointment rules (packages/types)", () => {
  it("converts Bangkok dates and times both ways", () => {
    expect(at("2026-10-21", "10:00").toISOString()).toBe("2026-10-21T03:00:00.000Z");
    expect(bangkokParts("2026-10-21T17:30:00.000Z")).toEqual({ date: "2026-10-22", time: "00:30", weekday: 4 });
    expect(bangkokDateTime("2026-02-30", "10:00")).toBeNull();
    expect(bangkokDateTime("2026-10-21", "25:00")).toBeNull();
  });

  it("offers half-hour slots from opening until the last half hour", () => {
    const slots = appointmentSlots();
    expect(slots[0]).toBe("08:00");
    expect(slots.at(-1)).toBe("16:30");
    expect(slots).toHaveLength(18);
  });

  it("accepts shop hours with at least 2 hours' notice, up to 60 days ahead", () => {
    expect(bookingTimeError(at("2026-10-21", "12:00"), NOW)).toBeNull();
    expect(bookingTimeError(at("2026-10-21", "11:30"), NOW)).toMatch(/at least 2 hours/);
    expect(bookingTimeError(at("2026-10-25", "10:00"), NOW)).toMatch(/Mon–Sat/); // Sunday
    expect(bookingTimeError(at("2026-10-22", "17:00"), NOW)).toMatch(/between 08:00 and 16:30/);
    expect(bookingTimeError(at("2026-10-22", "10:15"), NOW)).toMatch(/half hour/);
    expect(bookingTimeError(at("2026-12-21", "10:00"), NOW)).toMatch(/at most 60 days/);
  });

  it("validates a booking request, putting time problems on the time field", () => {
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      const sunday = CreateAppointmentSchema.safeParse({ vehicleId: "v1", date: "2026-10-25", time: "10:00", reason: "Oil change" });
      expect(sunday.success).toBe(false);
      expect(sunday.error?.flatten().fieldErrors.time?.[0]).toMatch(/Mon–Sat/);
      expect(CreateAppointmentSchema.safeParse({ vehicleId: "v1", date: "2026-10-22", time: "10:00", reason: " " }).success).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("gives staff every action that fits the status", () => {
    const requested = { status: "REQUESTED" as const, scheduledAt: at("2026-10-22", "10:00") };
    const confirmedPast = { status: "CONFIRMED" as const, scheduledAt: at("2026-10-21", "08:00") };
    expect(appointmentActions(requested, "ADVISOR", NOW)).toEqual(["confirm", "reschedule", "checkIn", "cancel"]);
    expect(appointmentActions(confirmedPast, "ADMIN", NOW)).toEqual(["reschedule", "checkIn", "cancel", "noShow"]);
    expect(appointmentActions({ status: "COMPLETED", scheduledAt: requested.scheduledAt }, "ADVISOR", NOW)).toEqual([]);
    expect(appointmentActions(requested, "MECHANIC", NOW)).toEqual([]);
  });

  it("lets a customer cancel (and move a request) only until 2 hours before", () => {
    const tomorrow = at("2026-10-22", "10:00");
    expect(appointmentActions({ status: "REQUESTED", scheduledAt: tomorrow }, "CUSTOMER", NOW)).toEqual(["reschedule", "cancel"]);
    expect(appointmentActions({ status: "CONFIRMED", scheduledAt: tomorrow }, "CUSTOMER", NOW)).toEqual(["cancel"]);
    // Exactly 2 hours away is still allowed; 1h59 isn't.
    expect(appointmentActions({ status: "CONFIRMED", scheduledAt: at("2026-10-21", "12:00") }, "CUSTOMER", NOW)).toEqual(["cancel"]);
    expect(appointmentActions({ status: "CONFIRMED", scheduledAt: new Date(at("2026-10-21", "12:00").getTime() - 60_000) }, "CUSTOMER", NOW)).toEqual([]);
  });
});

describe("AppointmentsService", () => {
  const customer = makeAuthUser({ id: "user-c", role: "CUSTOMER", customerId: "cust-1" });
  const advisor = makeAuthUser({ id: "advisor-1", role: "ADVISOR" });
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "appt-1",
    scheduledAt: at("2026-10-22", "10:00"),
    reason: "Brake inspection",
    status: "REQUESTED",
    customer: { id: "cust-1", firstName: "Jordan", lastName: "Lee", phone: "+66812345678" },
    vehicle: { id: "veh-1", plate: "1กข 1234", province: "กรุงเทพมหานคร", make: "Honda", model: "Civic", year: 2019 },
    workOrder: null,
    createdAt: NOW,
    ...overrides,
  });

  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  function setup() {
    const { prisma, service } = createPrismaMock();
    return { prisma, appointments: new AppointmentsService(service) };
  }

  it("books a customer's request for their own vehicle, and a staff booking as confirmed", async () => {
    const { prisma, appointments } = setup();
    prisma.vehicle.findUnique.mockResolvedValue({ id: "veh-1", customerId: "cust-1" });
    prisma.appointment.findFirst.mockResolvedValueOnce(null).mockResolvedValue(row());
    prisma.appointment.create.mockResolvedValue({ id: "appt-1", scheduledAt: at("2026-10-22", "10:00") });

    await appointments.create(customer, { vehicleId: "veh-1", date: "2026-10-22", time: "10:00", reason: "Brake inspection" });
    expect(prisma.appointment.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ customerId: "cust-1", status: "REQUESTED", scheduledAt: at("2026-10-22", "10:00"), createdById: "user-c" }),
    );

    prisma.appointment.findFirst.mockResolvedValueOnce(null);
    await appointments.create(advisor, { vehicleId: "veh-1", date: "2026-10-22", time: "11:00", reason: "Oil change" });
    expect(prisma.appointment.create.mock.calls[1][0].data.status).toBe("CONFIRMED");
  });

  it("hides other people's vehicles from customers (404)", async () => {
    const { prisma, appointments } = setup();
    prisma.vehicle.findUnique.mockResolvedValue({ id: "veh-9", customerId: "cust-9" });
    await expect(
      appointments.create(customer, { vehicleId: "veh-9", date: "2026-10-22", time: "10:00", reason: "x" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("refuses a second upcoming appointment for the same vehicle", async () => {
    const { prisma, appointments } = setup();
    prisma.vehicle.findUnique.mockResolvedValue({ id: "veh-1", customerId: "cust-1" });
    prisma.appointment.findFirst.mockResolvedValue({ scheduledAt: at("2026-10-23", "09:00") });
    await expect(
      appointments.create(customer, { vehicleId: "veh-1", date: "2026-10-22", time: "10:00", reason: "x" }),
    ).rejects.toThrow(new ConflictException("This vehicle already has an appointment on 2026-10-23 at 09:00. Change or cancel that one instead."));
  });

  it("tells a customer to call when it's less than 2 hours away", async () => {
    const { prisma, appointments } = setup();
    prisma.appointment.findFirst.mockResolvedValue(row({ status: "CONFIRMED", scheduledAt: at("2026-10-21", "11:00") }));
    await expect(appointments.cancel(customer, "appt-1", {})).rejects.toThrow(
      new BadRequestException("It's less than 2 hours away, so it can't be changed online. Please call us on 02-000-0000."),
    );
    expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("confirms with a conditional update and an audit entry", async () => {
    const { prisma, appointments } = setup();
    prisma.appointment.findFirst.mockResolvedValue(row());
    prisma.appointment.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await appointments.confirm(advisor, "appt-1");
    expect(prisma.appointment.updateMany.mock.calls[0][0]).toEqual({ where: { id: "appt-1", status: "REQUESTED" }, data: { status: "CONFIRMED" } });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ action: "appointment.confirmed", actorId: "advisor-1", entityId: "appt-1" }),
    );

    // Someone else changed it in between.
    await expect(appointments.confirm(advisor, "appt-1")).rejects.toThrow(ConflictException);
  });

  it("explains why a staff action doesn't fit the status", async () => {
    const { prisma, appointments } = setup();
    prisma.appointment.findFirst.mockResolvedValue(row({ status: "CONFIRMED", scheduledAt: at("2026-10-22", "10:00") }));
    await expect(appointments.noShow(advisor, "appt-1")).rejects.toThrow(
      new BadRequestException("A confirmed appointment can't be marked as a no-show before its time"),
    );
  });

  it("scopes customers to their own appointments", async () => {
    const { prisma, appointments } = setup();
    await appointments.list(customer, { page: 1, pageSize: 20 });
    expect(prisma.appointment.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ customerId: "cust-1" }));
  });

  it("shows customers only future bookings as upcoming, while staff also see unresolved past ones", async () => {
    const { prisma, appointments } = setup();
    await appointments.list(customer, { view: "upcoming", page: 1, pageSize: 20 });
    await appointments.list(advisor, { view: "upcoming", page: 1, pageSize: 20 });
    await appointments.list(customer, { view: "past", page: 1, pageSize: 20 });
    const [mine, staff, minePast] = prisma.appointment.findMany.mock.calls.map((call) => call[0].where);
    expect(mine).toEqual(expect.objectContaining({ status: { in: ["REQUESTED", "CONFIRMED"] }, scheduledAt: { gte: NOW } }));
    expect(staff).toEqual(expect.objectContaining({ status: { in: ["REQUESTED", "CONFIRMED"] } }));
    expect(staff.scheduledAt).toBeUndefined();
    expect(minePast.OR).toEqual([{ status: { notIn: ["REQUESTED", "CONFIRMED"] } }, { scheduledAt: { lt: NOW } }]);
  });
});
