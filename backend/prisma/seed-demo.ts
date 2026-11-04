import "dotenv/config";
import { Prisma, PrismaClient, type AppointmentStatus, type Role, type WorkOrderStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcryptjs";
import { addDays, bangkokDateTime, bangkokParts, calculateTotals, normalizePlate, normalizeThaiPhone } from "@motormate/types";
import { pgConfig } from "../src/prisma/pg-config";
import { upsertPriceList } from "./price-list";

/**
 * Demo data for the presentation: about six months of plausible shop history on top of the
 * normal seed — customers, vehicles, ~45 completed jobs with invoices, one open job at each
 * status, stock purchases and parts used (through stock movements), service recommendations
 * in every reminder state, and appointments in every status.
 *
 * - Runs once: demo customers carry DEMO_TAG in their notes; if any exist, it does nothing.
 * - Deterministic (seeded random), dated relative to `now`, Bangkok shop hours.
 * - Sends nothing: rows go straight into the database (one reminder is logged as "sent").
 * - Same rules as the app: totals from calculateTotals(), stock only via StockMovement, one
 *   open job per vehicle, mileage only goes up, appointments on 30-minute shop slots.
 *
 *   npm run db:seed:demo                       (local)
 *   bash infra/scripts/seed.sh --demo          (AWS)
 */

export const DEMO_TAG = "[demo]";
const PASSWORD = "password123";
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Catalogue (same SKUs as the normal seed; created at 0 stock if it hasn't run) ──────────

const PARTS = [
  { sku: "OIL-5W30-4L", name: "Engine oil 5W-30 (4 L)", category: "Fluids", unitCost: 650, unitPrice: 950, supplier: "Shell Thailand", reorderLevel: 10, target: 16 },
  { sku: "FLT-OIL-HON", name: "Oil filter — Honda", category: "Filters", unitCost: 120, unitPrice: 220, supplier: "Honda Parts TH", reorderLevel: 5, target: 9 },
  { sku: "FLT-AIR-HON", name: "Air filter — Honda", category: "Filters", unitCost: 280, unitPrice: 450, supplier: "Honda Parts TH", reorderLevel: 4, target: 6 },
  { sku: "FLT-CAB-UNI", name: "Cabin air filter (universal)", category: "Filters", unitCost: 150, unitPrice: 290, supplier: "Bosch", reorderLevel: 5, target: 3 },
  { sku: "BRK-PAD-FR-HON", name: "Front brake pads — Honda Civic", category: "Brakes", unitCost: 900, unitPrice: 1500, supplier: "Brembo", reorderLevel: 2, target: 4 },
  { sku: "BRK-FLD-DOT4", name: "Brake fluid DOT4 (1 L)", category: "Fluids", unitCost: 180, unitPrice: 320, supplier: "Bosch", reorderLevel: 4, target: 8 },
  { sku: "WPR-BLD-24", name: 'Wiper blade 24"', category: "Accessories", unitCost: 160, unitPrice: 300, supplier: "Bosch", reorderLevel: 4, target: 7 },
  { sku: "SPK-PLG-IRI", name: "Spark plug (iridium)", category: "Ignition", unitCost: 210, unitPrice: 380, supplier: "NGK", reorderLevel: 8, target: 14 },
  { sku: "BAT-12V-60AH", name: "Battery 12V 60Ah", category: "Electrical", unitCost: 2400, unitPrice: 3200, supplier: "GS Battery", reorderLevel: 2, target: 1 },
  { sku: "CLN-COOL-1L", name: "Coolant (1 L)", category: "Fluids", unitCost: 140, unitPrice: 250, supplier: "Toyota Genuine", reorderLevel: 6, target: 10 },
] as const;
type Sku = (typeof PARTS)[number]["sku"];

/** What customers come in for: the complaint, what was found and done, and the lines billed. */
const JOBS: { complaint: string; diagnosis: string; work: string; labour: [string, number][]; parts: [Sku, number][]; weight: number }[] = [
  { complaint: "Scheduled 10,000 km service", diagnosis: "Oil due for change", work: "Changed engine oil and oil filter, checked brakes and tyres", labour: [["Oil change", 500]], parts: [["OIL-5W30-4L", 1], ["FLT-OIL-HON", 1]], weight: 9 },
  { complaint: "Brakes squeal when stopping", diagnosis: "Front pads worn to 2 mm", work: "Replaced front brake pads, topped up brake fluid", labour: [["Front brake pads replacement", 800]], parts: [["BRK-PAD-FR-HON", 1], ["BRK-FLD-DOT4", 1]], weight: 4 },
  { complaint: "Car won't start in the morning", diagnosis: "Battery failed load test", work: "Replaced battery, checked charging system", labour: [["Battery test and replacement", 300]], parts: [["BAT-12V-60AH", 1]], weight: 2 },
  { complaint: "Air-con not cold", diagnosis: "Cabin filter clogged, system pressure OK", work: "Replaced cabin filter, cleaned evaporator", labour: [["A/C check and clean", 900]], parts: [["FLT-CAB-UNI", 1]], weight: 4 },
  { complaint: "Rough idle and misfire", diagnosis: "Worn spark plugs", work: "Replaced all four spark plugs", labour: [["Spark plug replacement", 700]], parts: [["SPK-PLG-IRI", 4]], weight: 3 },
  { complaint: "Temperature warning light", diagnosis: "Coolant low and dirty", work: "Flushed and refilled the cooling system", labour: [["Cooling system flush", 1200]], parts: [["CLN-COOL-1L", 4]], weight: 2 },
  { complaint: "Wipers streaking in the rain", diagnosis: "Blades perished", work: "Fitted new wiper blades", labour: [["Wiper blade fitting", 150]], parts: [["WPR-BLD-24", 2]], weight: 3 },
  { complaint: "40,000 km major service", diagnosis: "Due for major service", work: "Major service: oil, filters, brake fluid, spark plugs", labour: [["Major service", 1800], ["Brake fluid replacement", 400]], parts: [["OIL-5W30-4L", 2], ["FLT-OIL-HON", 1], ["FLT-AIR-HON", 1], ["BRK-FLD-DOT4", 1], ["SPK-PLG-IRI", 4]], weight: 3 },
  { complaint: "Knocking noise over bumps", diagnosis: "Front lower arm bushing worn", work: "Replaced bushings (supplied by customer)", labour: [["Suspension inspection", 600], ["Bushing replacement", 1500]], parts: [], weight: 2 },
];

const CUSTOMERS = [
  { firstName: "Ploy", lastName: "Saetang", phone: "081-555-0101", email: "ploy.s@example.com", login: true },
  { firstName: "Anan", lastName: "Rattanakul", phone: "082-555-0102", email: "anan.r@example.com", login: true },
  { firstName: "Kanya", lastName: "Boonmee", phone: "083-555-0103", email: "kanya.b@example.com", login: false },
  { firstName: "Somsak", lastName: "Wongchai", phone: "084-555-0104", email: null, login: false },
  { firstName: "Nicha", lastName: "Phromma", phone: "085-555-0105", email: "nicha.p@example.com", login: false },
  { firstName: "Thanawat", lastName: "Kittisak", phone: "086-555-0106", email: "thanawat.k@example.com", login: false },
  { firstName: "Pimchanok", lastName: "Suksawat", phone: "087-555-0107", email: null, login: false },
  { firstName: "Wichai", lastName: "Chaiyaporn", phone: "088-555-0108", email: "wichai.c@example.com", login: false },
  { firstName: "Siriporn", lastName: "Thongdee", phone: "089-555-0109", email: "siriporn.t@example.com", login: false },
  { firstName: "Krit", lastName: "Panyawong", phone: "090-555-0110", email: null, login: false },
  { firstName: "Mali", lastName: "Jantra", phone: "091-555-0111", email: "mali.j@example.com", login: false },
  { firstName: "Prasert", lastName: "Inthawong", phone: "092-555-0112", email: "prasert.i@example.com", login: false },
];

/** [customer index, plate, province, make, model, year, colour, mileage six months ago, km/day] */
const VEHICLES: [number, string, string, string, string, number, string, number, number][] = [
  [0, "กข 1001", "กรุงเทพมหานคร", "Honda", "City", 2021, "White", 31000, 45],
  [0, "1ขค 2002", "นนทบุรี", "Honda", "HR-V", 2023, "Blue", 9000, 30],
  [1, "ฆง 3003", "กรุงเทพมหานคร", "Toyota", "Yaris Ativ", 2022, "Silver", 24000, 50],
  [2, "2จฉ 4004", "ปทุมธานี", "Mazda", "2", 2020, "Red", 52000, 40],
  [3, "70-5005", "ชลบุรี", "Isuzu", "D-Max", 2019, "Grey", 118000, 90],
  [4, "ชซ 6006", "กรุงเทพมหานคร", "Toyota", "Corolla Cross", 2022, "White", 28000, 40],
  [5, "3ฌญ 7007", "สมุทรปราการ", "Honda", "Civic", 2020, "Black", 61000, 55],
  [6, "ฎฏ 8008", "นนทบุรี", "Suzuki", "Swift", 2021, "Orange", 35000, 35],
  [7, "71-9009", "ชลบุรี", "Toyota", "Hilux Revo", 2018, "White", 142000, 85],
  [7, "ฐฑ 1010", "ชลบุรี", "Honda", "Jazz", 2017, "Silver", 98000, 30],
  [8, "4ฒณ 1111", "เชียงใหม่", "Mitsubishi", "Xpander", 2022, "Grey", 33000, 45],
  [9, "ดต 1212", "กรุงเทพมหานคร", "Nissan", "Almera", 2021, "White", 40000, 50],
  [10, "5ถท 1313", "ปทุมธานี", "MG", "ZS", 2022, "Red", 26000, 35],
  [11, "ธน 1414", "กรุงเทพมหานคร", "Ford", "Ranger", 2020, "Blue", 87000, 70],
  [11, "6บป 1515", "กรุงเทพมหานคร", "Toyota", "Vios", 2019, "Silver", 76000, 40],
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Small seeded PRNG (mulberry32), so every run builds the same history. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemo(prisma: PrismaClient, now: Date = new Date()): Promise<{ skipped: boolean; workOrders: number }> {
  if (await prisma.customer.findFirst({ where: { notes: { contains: DEMO_TAG } }, select: { id: true } })) {
    return { skipped: true, workOrders: 0 };
  }
  const rand = random(424);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const today = bangkokParts(now).date;

  /** A Bangkok shop day `daysAgo` before today (Sundays move to Saturday) at hh:mm. */
  const shopTime = (daysAgo: number, time: string): Date => {
    let day = addDays(today, -daysAgo);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) day = addDays(day, -1);
    return bangkokDateTime(day, time)!;
  };
  /** The next shop day `daysAhead` from today (Sundays move to Monday), on a bookable slot. */
  const futureSlot = (daysAhead: number, time: string): Date => {
    let day = addDays(today, daysAhead);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) day = addDays(day, 1);
    return bangkokDateTime(day, time)!;
  };
  const dueDay = (daysFromToday: number) => new Date(`${addDays(today, daysFromToday)}T00:00:00.000Z`);
  const slot = () => `${String(8 + Math.floor(rand() * 9)).padStart(2, "0")}:${rand() < 0.5 ? "00" : "30"}`;
  const hoursLater = (from: Date, hours: number) => new Date(Math.min(from.getTime() + hours * 3_600_000, now.getTime()));

  // ── People ──────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = (email: string, firstName: string, lastName: string, role: Role) =>
    prisma.user.upsert({ where: { email }, update: {}, create: { email, firstName, lastName, role, passwordHash } });
  const admin = await user("admin@motormate.example", "Somchai", "Jaidee", "ADMIN");
  const advisor = await user("advisor@motormate.example", "Alex", "Rivera", "ADVISOR");
  const mechanics = [
    await user("mechanic@motormate.example", "Sam", "Nguyen", "MECHANIC"),
    await user("mechanic2@motormate.example", "Krit", "Chaiyo", "MECHANIC"),
  ];

  const customers: Prisma.CustomerGetPayload<object>[] = [];
  for (const c of CUSTOMERS) {
    const login = c.login && c.email ? await user(c.email, c.firstName, c.lastName, "CUSTOMER") : null;
    customers.push(
      await prisma.customer.create({
        data: {
          firstName: c.firstName,
          lastName: c.lastName,
          phone: normalizeThaiPhone(c.phone)!,
          email: c.email,
          userId: login?.id ?? null,
          notes: `${DEMO_TAG} Demo customer`,
          createdAt: shopTime(175 - customers.length * 3, "09:00"),
        },
      }),
    );
  }
  const loginOf = (customerIndex: number) =>
    customers[customerIndex].userId ?? advisor.id;

  const vehicles: Prisma.VehicleGetPayload<object>[] = [];
  for (const [index, [owner, plate, province, make, model, year, color, mileage]] of VEHICLES.entries()) {
    vehicles.push(
      await prisma.vehicle.create({
        data: {
          customerId: customers[owner].id,
          vin: `DEMO${String(index + 1).padStart(13, "0")}`,
          plate,
          plateNormalized: normalizePlate(plate),
          province,
          make,
          model,
          year,
          color,
          mileage,
          createdAt: customers[owner].createdAt,
        },
      }),
    );
  }

  // ── Plan the history first, so stock purchases can cover it ─────────────────
  const weighted = JOBS.flatMap((job) => Array<typeof job>(job.weight).fill(job));
  type Planned = { vehicle: number; daysAgo: number; job: (typeof JOBS)[number]; status: WorkOrderStatus };
  const planned: Planned[] = [];
  // ~45 completed jobs over the last ~170 days, busier recently; every vehicle at least once.
  for (let i = 0; i < 45; i++) {
    const vehicle = i < VEHICLES.length ? i : Math.floor(rand() * VEHICLES.length);
    const daysAgo = 4 + Math.floor(166 * Math.pow(rand(), 1.25));
    planned.push({ vehicle, daysAgo, job: pick(weighted), status: "COMPLETED" });
  }
  // One open job at each step, on five different vehicles, newest of all.
  const OPEN: WorkOrderStatus[] = ["CHECKED_IN", "DIAGNOSING", "AWAITING_PARTS", "IN_PROGRESS", "QUALITY_CHECK"];
  OPEN.forEach((status, i) => planned.push({ vehicle: [2, 4, 6, 8, 13][i], daysAgo: [0, 0, 2, 1, 1][i], job: JOBS[[0, 3, 1, 7, 4][i]], status }));
  planned.sort((a, b) => b.daysAgo - a.daysAgo || OPEN.indexOf(a.status) - OPEN.indexOf(b.status));
  // Two completed visits for one vehicle on the same day would look odd; push repeats apart.
  for (let i = 1; i < planned.length; i++) {
    if (planned[i].status === "COMPLETED" && planned.slice(0, i).some((p) => p.vehicle === planned[i].vehicle && p.daysAgo - planned[i].daysAgo < 14)) {
      planned[i].daysAgo = Math.max(4, planned[i].daysAgo - 14);
    }
  }
  planned.sort((a, b) => b.daysAgo - a.daysAgo || OPEN.indexOf(a.status) - OPEN.indexOf(b.status));

  // Lines only once work has started.
  const hasLines = (status: WorkOrderStatus) => status === "COMPLETED" || status === "IN_PROGRESS" || status === "QUALITY_CHECK";
  const usage = new Map<Sku, number>();
  for (const p of planned) if (hasLines(p.status)) for (const [sku, qty] of p.job.parts) usage.set(sku, (usage.get(sku) ?? 0) + qty);

  // ── Stock: catalogue, then one opening purchase per item so the history fits ─
  const priceList = await upsertPriceList(prisma);
  const items = new Map<Sku, { id: string; unitPrice: number }>();
  for (const part of PARTS) {
    const { target, ...fields } = part;
    const row = await prisma.inventoryItem.upsert({ where: { sku: part.sku }, update: {}, create: { ...fields, quantityOnHand: 0 } });
    items.set(part.sku, { id: row.id, unitPrice: Number(row.unitPrice) });
    const purchase = Math.max(0, target + (usage.get(part.sku) ?? 0) - row.quantityOnHand);
    if (purchase > 0) {
      await prisma.$transaction([
        prisma.inventoryItem.update({ where: { id: row.id }, data: { quantityOnHand: { increment: purchase } } }),
        prisma.stockMovement.create({
          data: { inventoryItemId: row.id, quantityChange: purchase, reason: "PURCHASE", note: "Stock order (demo)", createdById: admin.id, createdAt: shopTime(178, "10:00") },
        }),
      ]);
    }
  }

  // ── Work orders, oldest first ───────────────────────────────────────────────
  const mileage = VEHICLES.map((v) => v[7]);
  const lastVisit = VEHICLES.map(() => 178);
  const completedJobs: { id: string; vehicle: number; checkedInAt: Date; mileageIn: number }[] = [];
  const openJobs: { id: string; vehicle: number; status: WorkOrderStatus }[] = [];
  let count = 0;

  for (const p of planned) {
    const checkedInAt = shopTime(p.daysAgo, p.daysAgo === 0 ? "08:30" : slot());
    mileage[p.vehicle] += Math.round((lastVisit[p.vehicle] - p.daysAgo) * VEHICLES[p.vehicle][8] * (0.8 + rand() * 0.4));
    lastVisit[p.vehicle] = p.daysAgo;
    const mileageIn = mileage[p.vehicle];
    const mechanic = rand() < 0.6 ? mechanics[0] : mechanics[1];
    const lines = hasLines(p.status);
    const labour = lines ? p.job.labour : [];
    const parts = lines ? p.job.parts.map(([sku, quantity]) => ({ sku, quantity, ...items.get(sku)! })) : [];

    // The status trail up to where the job is now.
    const path: WorkOrderStatus[] =
      p.status === "COMPLETED"
        ? ["CHECKED_IN", "DIAGNOSING", "IN_PROGRESS", "QUALITY_CHECK", "COMPLETED"]
        : p.status === "AWAITING_PARTS"
          ? ["CHECKED_IN", "DIAGNOSING", "AWAITING_PARTS"]
          : ["CHECKED_IN", "DIAGNOSING", "IN_PROGRESS", "QUALITY_CHECK"].slice(0, ["CHECKED_IN", "DIAGNOSING", "IN_PROGRESS", "QUALITY_CHECK"].indexOf(p.status) + 1) as WorkOrderStatus[];
    const step = p.status === "COMPLETED" ? 2 + rand() * 6 : 0.75;
    const at = path.map((_, i) => hoursLater(checkedInAt, i * step));
    const completedAt = p.status === "COMPLETED" ? at[at.length - 1] : null;
    const totals = calculateTotals(labour.map(([, cost]) => cost), parts);
    const assigned = p.status === "CHECKED_IN" ? null : mechanic.id;

    const workOrder = await prisma.workOrder.create({
      data: {
        vehicleId: vehicles[p.vehicle].id,
        mileageIn,
        complaint: p.job.complaint,
        diagnosis: p.status === "CHECKED_IN" ? null : p.job.diagnosis,
        workPerformed: p.status === "COMPLETED" ? p.job.work : null,
        status: p.status,
        mechanicId: assigned,
        createdById: advisor.id,
        createdAt: checkedInAt,
        completedAt,
        statusChanges: {
          create: path.map((toStatus, i) => ({
            fromStatus: i === 0 ? null : path[i - 1],
            toStatus,
            changedById: i === 0 || toStatus === "COMPLETED" ? advisor.id : mechanic.id,
            createdAt: at[i],
          })),
        },
        // Lines named like a price-list service are linked to it; the rest are custom lines.
        serviceItems: {
          create: labour.map(([description, laborCost]) => ({
            description,
            laborCost,
            catalogItemId: priceList.get(description) ?? null,
            addedById: assigned ?? advisor.id,
            createdAt: at[Math.min(2, at.length - 1)],
          })),
        },
        partsUsed: { create: parts.map((part) => ({ inventoryItemId: part.id, quantity: part.quantity, unitPrice: part.unitPrice, createdAt: at[Math.min(2, at.length - 1)] })) },
        stockMovements: {
          create: parts.map((part) => ({
            inventoryItemId: part.id,
            quantityChange: -part.quantity,
            reason: "WORK_ORDER" as const,
            createdById: mechanic.id,
            createdAt: at[Math.min(2, at.length - 1)],
          })),
        },
      },
    });
    for (const part of parts) {
      await prisma.inventoryItem.update({ where: { id: part.id }, data: { quantityOnHand: { decrement: part.quantity } } });
    }
    count++;

    if (completedAt) {
      // Older invoices are paid; the last couple of weeks are a mix, so Unpaid has something.
      const paid = p.daysAgo > 14 ? rand() < 0.95 : rand() < 0.5;
      const paidAt = paid ? hoursLater(completedAt, 2 + rand() * 72) : null;
      const invoice = await prisma.invoice.create({
        data: {
          workOrderId: workOrder.id,
          subtotal: new Prisma.Decimal(totals.subtotal),
          vatAmount: new Prisma.Decimal(totals.vat),
          total: new Prisma.Decimal(totals.total),
          status: paid ? "PAID" : "UNPAID",
          issuedAt: completedAt,
          paidAt,
        },
      });
      if (paidAt) {
        await prisma.auditLog.create({
          data: { actorId: advisor.id, action: "invoice.paid", entity: "Invoice", entityId: invoice.id, changes: { status: { from: "UNPAID", to: "PAID" } }, createdAt: paidAt },
        });
      }
      completedJobs.push({ id: workOrder.id, vehicle: p.vehicle, checkedInAt, mileageIn });
    } else {
      openJobs.push({ id: workOrder.id, vehicle: p.vehicle, status: p.status });
    }
  }
  for (const [index, vehicle] of vehicles.entries()) {
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { mileage: mileage[index] } });
  }

  // ── Recommendations: one of each reminder state, on each vehicle's latest completed job ─
  const latest = (vehicle: number) => [...completedJobs].reverse().find((job) => job.vehicle === vehicle)!;
  const recommend = async (vehicle: number, data: { description: string; dueMileage?: number; dueDate?: Date; status?: "OPEN" | "REMINDED" | "DONE" | "DISMISSED" }) => {
    const job = latest(vehicle);
    return prisma.serviceRecommendation.create({
      data: { vehicleId: vehicles[vehicle].id, workOrderId: job.id, createdById: mechanics[0].id, createdAt: job.checkedInAt, status: "OPEN", ...data },
    });
  };
  await recommend(0, { description: "Brake fluid change", dueDate: dueDay(-12) }); // overdue
  // Mileage-based ones sit just above that visit's reading; the estimated odometer (km/day
  // since then) makes the first overdue and the second due soon.
  await recommend(3, { description: "Timing belt inspection", dueMileage: latest(3).mileageIn + 300 });
  await recommend(5, { description: "Tyre rotation", dueDate: dueDay(4) }); // due this week
  await recommend(10, { description: "Air filter replacement", dueMileage: latest(10).mileageIn + 1500 });
  await recommend(11, { description: "Next oil change", dueMileage: mileage[11] + 5000, dueDate: dueDay(60) }); // coming up
  await recommend(12, { description: "Battery health check", dueDate: dueDay(40) }); // coming up
  const reminded = await recommend(1, { description: "10,000 km service", dueDate: dueDay(3), status: "REMINDED" });
  await prisma.notificationLog.create({
    data: {
      type: "SERVICE_REMINDER",
      status: "SENT",
      recipientEmail: customers[0].email,
      subject: "[MOTORMATE] Service coming up",
      customerId: customers[0].id,
      recommendationId: reminded.id,
      sentAt: shopTime(2, "09:00"),
      createdAt: shopTime(2, "09:00"),
    },
  });
  await recommend(14, { description: "Wiper blades", dueDate: dueDay(-30), status: "DISMISSED" });

  // ── Appointments ────────────────────────────────────────────────────────────
  const book = (vehicle: number, scheduledAt: Date, status: AppointmentStatus, reason: string, online: boolean, workOrderId?: string) =>
    prisma.appointment.create({
      data: {
        customerId: vehicles[vehicle].customerId,
        vehicleId: vehicles[vehicle].id,
        scheduledAt,
        reason,
        status,
        workOrderId,
        createdById: online ? loginOf(VEHICLES[vehicle][0]) : advisor.id,
        createdAt: new Date(scheduledAt.getTime() - 3 * DAY_MS),
      },
    });
  // Past bookings that turned into completed jobs (the job's check-in time).
  for (const job of completedJobs.filter((_, i) => i % 7 === 3).slice(0, 6)) {
    await book(job.vehicle, job.checkedInAt, "COMPLETED", "Booked service", job.vehicle <= 2, job.id);
  }
  await book(9, shopTime(20, "10:00"), "NO_SHOW", "Oil change", false);
  await book(7, shopTime(9, "14:00"), "NO_SHOW", "A/C check", false);
  await book(12, shopTime(16, "11:30"), "CANCELLED", "Brake check", false);
  await book(1, shopTime(6, "09:30"), "CANCELLED", "Tyre check", true);
  // Today's check-in came from a booking.
  const checkedIn = openJobs.find((job) => job.status === "CHECKED_IN")!;
  await book(checkedIn.vehicle, shopTime(0, "08:30"), "CHECKED_IN", "Scheduled service", true, checkedIn.id);
  // Coming up: confirmed (phone and online), and requests waiting for an answer.
  await book(5, futureSlot(1, "09:00"), "CONFIRMED", "Tyre rotation", false);
  await book(10, futureSlot(1, "14:30"), "CONFIRMED", "Air filter replacement", false);
  // Requests only come from customer logins (staff bookings start confirmed).
  await book(0, futureSlot(2, "10:00"), "REQUESTED", "Brake fluid change (reminder)", true);
  await book(1, futureSlot(3, "13:00"), "REQUESTED", "Strange noise when turning", true);
  await book(12, futureSlot(5, "11:00"), "CONFIRMED", "Battery check", false);

  return { skipped: false, workOrders: count };
}

// Run directly: `npm run db:seed:demo` (local) or `node dist-seed/prisma/seed-demo.js` (AWS task).
if (require.main === module) {
  const prisma = new PrismaClient({ adapter: new PrismaPg(pgConfig()) });
  seedDemo(prisma)
    .then((result) =>
      console.log(result.skipped ? "Demo data is already there — nothing to do." : `Demo data added: ${result.workOrders} work orders.`),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
