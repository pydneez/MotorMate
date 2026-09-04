import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const advisor = await prisma.user.upsert({
    where: { email: "advisor@motormate.example" },
    update: {},
    create: {
      email: "advisor@motormate.example",
      passwordHash,
      firstName: "Alex",
      lastName: "Rivera",
      role: "ADVISOR",
    },
  });

  const mechanic = await prisma.user.upsert({
    where: { email: "mechanic@motormate.example" },
    update: {},
    create: {
      email: "mechanic@motormate.example",
      passwordHash,
      firstName: "Sam",
      lastName: "Nguyen",
      role: "MECHANIC",
    },
  });

  const customer = await prisma.customer.upsert({
    where: { email: "jordan.lee@example.com" },
    update: {},
    create: {
      firstName: "Jordan",
      lastName: "Lee",
      email: "jordan.lee@example.com",
      phone: "555-0100",
    },
  });

  const vehicle = await prisma.vehicle.upsert({
    where: { vin: "1HGCM82633A004352" },
    update: {},
    create: {
      customerId: customer.id,
      vin: "1HGCM82633A004352",
      plate: "MTM-001",
      make: "Honda",
      model: "Civic",
      year: 2019,
      mileage: 42000,
    },
  });

  await prisma.workOrder.upsert({
    where: { id: "seed-work-order-1" },
    update: {},
    create: {
      id: "seed-work-order-1",
      vehicleId: vehicle.id,
      mechanicId: mechanic.id,
      status: "CHECKED_IN",
      complaint: "Check engine light is on",
    },
  });

  console.log("Seeded:", { advisor: advisor.email, mechanic: mechanic.email, customer: customer.email, vehicle: vehicle.vin });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
