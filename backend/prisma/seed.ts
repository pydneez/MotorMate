import "dotenv/config";
import { Prisma, PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcryptjs";
import { normalizePlate, normalizeThaiPhone, VAT_RATE } from "@motormate/types";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Seed-only helper: the sample numbers below are known-valid, so fail loudly if not. */
function phone(input: string): string {
  const normalized = normalizeThaiPhone(input);
  if (!normalized) throw new Error(`Invalid seed phone number: ${input}`);
  return normalized;
}

/** Every seeded login uses this password — local development only. */
const SEED_PASSWORD = "password123";

async function upsertUser(email: string, firstName: string, lastName: string, role: Role, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, firstName, lastName, role, passwordHash },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // ── Staff and a portal customer ────────────────────────────────────────────
  const admin = await upsertUser("admin@motormate.example", "Somchai", "Jaidee", "ADMIN", passwordHash);
  const advisor = await upsertUser("advisor@motormate.example", "Alex", "Rivera", "ADVISOR", passwordHash);
  const mechanic = await upsertUser("mechanic@motormate.example", "Sam", "Nguyen", "MECHANIC", passwordHash);
  const customerUser = await upsertUser("jordan.lee@example.com", "Jordan", "Lee", "CUSTOMER", passwordHash);

  // ── Customers ──────────────────────────────────────────────────────────────
  const jordan = await prisma.customer.upsert({
    where: { email: "jordan.lee@example.com" },
    update: {},
    create: {
      firstName: "Jordan",
      lastName: "Lee",
      email: "jordan.lee@example.com",
      phone: phone("081-234-5678"),
      lineId: "jordan.lee",
      userId: customerUser.id,
    },
  });

  // Walk-in customer with no portal account — self-registering with this email AND phone links to it.
  const malee = await prisma.customer.upsert({
    where: { email: "malee.s@example.com" },
    update: {},
    create: {
      firstName: "Malee",
      lastName: "Srisuk",
      email: "malee.s@example.com",
      phone: phone("089-876-5432"),
    },
  });

  // Walk-in customer without email (can't receive reminders until one is added).
  const existingNiran = await prisma.customer.findFirst({ where: { phone: phone("02-123-4567") } });
  const niran =
    existingNiran ??
    (await prisma.customer.create({
      data: { firstName: "Niran", lastName: "Wongsa", phone: phone("02-123-4567"), notes: "Prefers phone calls" },
    }));

  // ── Vehicles ───────────────────────────────────────────────────────────────
  const vehicleSeeds = [
    { customerId: jordan.id, vin: "MRHFC1650KP000001", plate: "1กข 1234", province: "กรุงเทพมหานคร", make: "Honda", model: "Civic", year: 2019, color: "White", mileage: 42000 },
    { customerId: jordan.id, vin: "MR0FZ29G0K1000002", plate: "ฌญ 5678", province: "นนทบุรี", make: "Toyota", model: "Fortuner", year: 2020, color: "Grey", mileage: 68500 },
    { customerId: malee.id, vin: "MNTBB7A90K0000003", plate: "3กพ 9012", province: "เชียงใหม่", make: "Nissan", model: "Almera", year: 2021, color: "Red", mileage: 23000 },
    { customerId: niran.id, vin: "MPATFS86JMT000004", plate: "70-1234", province: "ชลบุรี", make: "Isuzu", model: "D-Max", year: 2018, color: "Silver", mileage: 151200 },
  ];
  const vehicles = [];
  for (const v of vehicleSeeds) {
    vehicles.push(
      await prisma.vehicle.upsert({
        where: { vin: v.vin },
        update: {},
        create: { ...v, plateNormalized: normalizePlate(v.plate) },
      }),
    );
  }
  const [civic, , almera] = vehicles;

  // ── Inventory ──────────────────────────────────────────────────────────────
  const inventorySeeds = [
    { sku: "OIL-5W30-4L", name: "Engine oil 5W-30 (4 L)", category: "Fluids", quantityOnHand: 24, unitCost: 650, unitPrice: 950, supplier: "Shell Thailand", reorderLevel: 10 },
    { sku: "FLT-OIL-HON", name: "Oil filter — Honda", category: "Filters", quantityOnHand: 15, unitCost: 120, unitPrice: 220, supplier: "Honda Parts TH", reorderLevel: 5 },
    { sku: "FLT-AIR-HON", name: "Air filter — Honda", category: "Filters", quantityOnHand: 8, unitCost: 280, unitPrice: 450, supplier: "Honda Parts TH", reorderLevel: 4 },
    { sku: "FLT-CAB-UNI", name: "Cabin air filter (universal)", category: "Filters", quantityOnHand: 3, unitCost: 150, unitPrice: 290, supplier: "Bosch", reorderLevel: 5 },
    { sku: "BRK-PAD-FR-HON", name: "Front brake pads — Honda Civic", category: "Brakes", quantityOnHand: 6, unitCost: 900, unitPrice: 1500, supplier: "Brembo", reorderLevel: 2 },
    { sku: "BRK-FLD-DOT4", name: "Brake fluid DOT4 (1 L)", category: "Fluids", quantityOnHand: 12, unitCost: 180, unitPrice: 320, supplier: "Bosch", reorderLevel: 4 },
    { sku: "WPR-BLD-24", name: "Wiper blade 24\"", category: "Accessories", quantityOnHand: 10, unitCost: 160, unitPrice: 300, supplier: "Bosch", reorderLevel: 4 },
    { sku: "SPK-PLG-IRI", name: "Spark plug (iridium)", category: "Ignition", quantityOnHand: 32, unitCost: 210, unitPrice: 380, supplier: "NGK", reorderLevel: 8 },
    { sku: "BAT-12V-60AH", name: "Battery 12V 60Ah", category: "Electrical", quantityOnHand: 2, unitCost: 2400, unitPrice: 3200, supplier: "GS Battery", reorderLevel: 2 },
    { sku: "CLN-COOL-1L", name: "Coolant (1 L)", category: "Fluids", quantityOnHand: 18, unitCost: 140, unitPrice: 250, supplier: "Toyota Genuine", reorderLevel: 6 },
  ];
  const inventory: Record<string, Awaited<ReturnType<typeof prisma.inventoryItem.upsert>>> = {};
  for (const item of inventorySeeds) {
    inventory[item.sku] = await prisma.inventoryItem.upsert({
      where: { sku: item.sku },
      update: {},
      create: item,
    });
  }

  // Work orders aren't keyed by anything natural, so only create them on a fresh database.
  if ((await prisma.workOrder.count()) === 0) {
    // ── A completed visit with parts, invoice, and a follow-up recommendation ─
    const oil = inventory["OIL-5W30-4L"];
    const filter = inventory["FLT-OIL-HON"];
    const labor = new Prisma.Decimal(500);
    const partsTotal = oil.unitPrice.plus(filter.unitPrice);
    const subtotal = labor.plus(partsTotal);
    const vatAmount = subtotal.times(VAT_RATE).toDecimalPlaces(2);
    const completedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);

    await prisma.workOrder.create({
      data: {
        vehicleId: civic.id,
        mileageIn: 37000,
        complaint: "Scheduled 10,000 km service",
        diagnosis: "Oil due for change, filters OK except oil filter",
        workPerformed: "Changed engine oil and oil filter, checked brakes and tyres",
        status: "COMPLETED",
        mechanicId: mechanic.id,
        createdById: advisor.id,
        completedAt,
        createdAt: completedAt,
        statusChanges: {
          create: [
            { toStatus: "CHECKED_IN", changedById: advisor.id, createdAt: completedAt },
            { fromStatus: "CHECKED_IN", toStatus: "IN_PROGRESS", changedById: mechanic.id, createdAt: completedAt },
            { fromStatus: "IN_PROGRESS", toStatus: "COMPLETED", changedById: mechanic.id, createdAt: completedAt },
          ],
        },
        serviceItems: { create: [{ description: "Oil change labour", laborCost: labor }] },
        partsUsed: {
          create: [
            { inventoryItemId: oil.id, quantity: 1, unitPrice: oil.unitPrice },
            { inventoryItemId: filter.id, quantity: 1, unitPrice: filter.unitPrice },
          ],
        },
        stockMovements: {
          create: [
            { inventoryItemId: oil.id, quantityChange: -1, reason: "WORK_ORDER", createdById: mechanic.id },
            { inventoryItemId: filter.id, quantityChange: -1, reason: "WORK_ORDER", createdById: mechanic.id },
          ],
        },
        invoice: {
          create: {
            subtotal,
            vatAmount,
            total: subtotal.plus(vatAmount),
            status: "PAID",
            issuedAt: completedAt,
            paidAt: completedAt,
          },
        },
        recommendations: {
          create: [
            {
              vehicleId: civic.id,
              description: "Brake inspection",
              dueMileage: 45000,
              createdById: mechanic.id,
            },
          ],
        },
      },
    });

    // ── An open visit, currently being diagnosed ─────────────────────────────
    await prisma.workOrder.create({
      data: {
        vehicleId: almera.id,
        mileageIn: 23000,
        complaint: "Check engine light is on",
        status: "DIAGNOSING",
        mechanicId: mechanic.id,
        createdById: advisor.id,
        statusChanges: {
          create: [
            { toStatus: "CHECKED_IN", changedById: advisor.id },
            { fromStatus: "CHECKED_IN", toStatus: "DIAGNOSING", changedById: mechanic.id },
          ],
        },
      },
    });

    // ── A pending appointment request from the portal customer ───────────────
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    await prisma.appointment.create({
      data: {
        customerId: jordan.id,
        vehicleId: civic.id,
        scheduledAt: tomorrow,
        reason: "Brake inspection (recommended at last visit)",
        createdById: customerUser.id,
      },
    });
  }

  console.log("Seeded logins (password: %s):", SEED_PASSWORD, {
    admin: admin.email,
    advisor: advisor.email,
    mechanic: mechanic.email,
    customer: customerUser.email,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
