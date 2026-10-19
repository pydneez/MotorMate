import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createPrismaMock, makeAuthUser } from "../../test/prisma-mock";
import { VehiclesService } from "./vehicles.service";

const admin = makeAuthUser();
const advisor = makeAuthUser({ id: "advisor-1", role: "ADVISOR" });
const customer = makeAuthUser({ id: "u-1", role: "CUSTOMER", customerId: "cust-1" });

function vehicleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "veh-1",
    customerId: "cust-1",
    vin: "MRHFC1650KP000001",
    plate: "1กข 1234",
    plateNormalized: "1กข1234",
    province: "กรุงเทพมหานคร",
    make: "Honda",
    model: "Civic",
    year: 2019,
    color: "White",
    mileage: 42000,
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    customer: { id: "cust-1", firstName: "Jordan", lastName: "Lee", phone: "+66812345678" },
    workOrders: [],
    ...overrides,
  };
}

const newVehicle = {
  vin: "JHMCM56557C404453",
  plate: "กข-5678",
  province: "เชียงใหม่" as const,
  make: "Honda",
  model: "Jazz",
  year: 2021,
  mileage: 15000,
};

function setup() {
  const { prisma, service } = createPrismaMock();
  prisma.customer.findUnique.mockResolvedValue({ id: "cust-1" });
  prisma.vehicle.findFirst.mockResolvedValue(null);
  prisma.vehicle.create.mockImplementation(({ data }) => Promise.resolve(vehicleRow({ ...data, id: "veh-new" })));
  return { prisma, vehicles: new VehiclesService(service) };
}

describe("VehiclesService.list / findOne scoping", () => {
  it("limits a customer to their own vehicles", async () => {
    const { prisma, vehicles } = setup();

    await vehicles.list(customer, { page: 1, pageSize: 20 });

    expect(prisma.vehicle.findMany.mock.calls[0][0].where.customerId).toBe("cust-1");
  });

  it("lets staff see every vehicle", async () => {
    const { prisma, vehicles } = setup();

    await vehicles.list(advisor, { page: 1, pageSize: 20 });

    expect(prisma.vehicle.findMany.mock.calls[0][0].where.customerId).toBeUndefined();
  });

  it("matches nothing for a customer login that has no linked record", async () => {
    const { prisma, vehicles } = setup();

    await vehicles.list(makeAuthUser({ role: "CUSTOMER", customerId: null }), { page: 1, pageSize: 20 });

    expect(prisma.vehicle.findMany.mock.calls[0][0].where.customerId).toBe("__none__");
  });

  it("reports another customer's vehicle as not found", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findFirst.mockResolvedValue(null); // scoped query finds nothing

    await expect(vehicles.findOne(customer, "someone-elses")).rejects.toThrow(NotFoundException);
    expect(prisma.vehicle.findFirst.mock.calls[0][0].where).toEqual({ id: "someone-elses", customerId: "cust-1" });
  });

  it("builds the service history with invoice totals as numbers", async () => {
    const { prisma, vehicles } = setup();
    const createdAt = new Date("2026-09-19T03:00:00Z");
    prisma.vehicle.findFirst.mockResolvedValue(
      vehicleRow({
        workOrders: [
          {
            id: "wo-1",
            number: 1,
            status: "COMPLETED",
            createdAt,
            completedAt: createdAt,
            mileageIn: 37000,
            complaint: "Service",
            workPerformed: "Oil change",
            mechanic: { firstName: "Sam", lastName: "Nguyen" },
            partsUsed: [{ quantity: 1, inventoryItem: { name: "Oil filter" } }],
            invoice: { total: { toNumber: () => 1926 } },
            recommendations: [{ description: "Brake inspection", dueMileage: 45000, dueDate: null }],
          },
        ],
      }),
    );

    const detail = await vehicles.findOne(advisor, "veh-1");

    expect(detail.lastVisitAt).toBe(createdAt.toISOString());
    expect(detail.history[0]).toEqual(
      expect.objectContaining({ number: 1, total: 1926, mechanicName: "Sam Nguyen", parts: [{ name: "Oil filter", quantity: 1 }] }),
    );
  });
});

describe("VehiclesService.create", () => {
  it("lets staff add a vehicle to any customer and normalizes the plate", async () => {
    const { prisma, vehicles } = setup();

    await vehicles.create(advisor, { ...newVehicle, customerId: "cust-1" });

    const data = prisma.vehicle.create.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ customerId: "cust-1", plateNormalized: "กข5678" }));
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe("vehicle.created");
  });

  it("requires staff to choose a customer", async () => {
    const { vehicles } = setup();

    await expect(vehicles.create(advisor, newVehicle)).rejects.toThrow(BadRequestException);
  });

  it("returns not found for a customer id that doesn't exist", async () => {
    const { prisma, vehicles } = setup();
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(vehicles.create(advisor, { ...newVehicle, customerId: "ghost" })).rejects.toThrow(NotFoundException);
  });

  it("adds a customer's vehicle to their own record", async () => {
    const { prisma, vehicles } = setup();

    await vehicles.create(customer, newVehicle);

    expect(prisma.vehicle.create.mock.calls[0][0].data.customerId).toBe("cust-1");
  });

  it("forbids a customer from adding to someone else's record", async () => {
    const { prisma, vehicles } = setup();

    await expect(vehicles.create(customer, { ...newVehicle, customerId: "cust-2" })).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.vehicle.create).not.toHaveBeenCalled();
  });

  it("forbids a customer login without a linked record", async () => {
    const { vehicles } = setup();

    await expect(vehicles.create(makeAuthUser({ role: "CUSTOMER", customerId: null }), newVehicle)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("rejects a VIN that is already registered and tells staff which vehicle has it", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findFirst.mockResolvedValue({ id: "veh-9" });

    const error = await vehicles.create(advisor, { ...newVehicle, customerId: "cust-1" }).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual(expect.objectContaining({ vehicleId: "veh-9" }));
  });

  it("rejects a taken VIN for a customer without revealing which vehicle has it", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findFirst.mockResolvedValue({ id: "veh-9" });

    const error = await vehicles.create(customer, newVehicle).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).not.toHaveProperty("vehicleId");
  });
});

describe("VehiclesService.update", () => {
  it("re-normalizes the plate and audits the change", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findUnique.mockResolvedValue(vehicleRow());
    prisma.vehicle.update.mockResolvedValue(vehicleRow({ plate: "2กข 9999" }));

    await vehicles.update(advisor, "veh-1", { plate: "2กข 9999" });

    expect(prisma.vehicle.update.mock.calls[0][0].data.plateNormalized).toBe("2กข9999");
    expect(prisma.auditLog.create.mock.calls[0][0].data.changes).toEqual({ plate: { from: "1กข 1234", to: "2กข 9999" } });
  });

  it("allows keeping the same VIN without a conflict", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findUnique.mockResolvedValue(vehicleRow());
    prisma.vehicle.update.mockResolvedValue(vehicleRow());

    await vehicles.update(advisor, "veh-1", { vin: "MRHFC1650KP000001" });

    expect(prisma.vehicle.findFirst).not.toHaveBeenCalled();
  });

  it("rejects changing to a VIN used by another vehicle", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findUnique.mockResolvedValue(vehicleRow());
    prisma.vehicle.findFirst.mockResolvedValue({ id: "veh-9" });

    await expect(vehicles.update(advisor, "veh-1", { vin: "JHMCM56557C404453" })).rejects.toThrow(ConflictException);
  });
});

describe("VehiclesService.correctMileage", () => {
  it("lets an admin lower the mileage and records old, new and reason", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findUnique.mockResolvedValue(vehicleRow());
    prisma.vehicle.update.mockResolvedValue(vehicleRow({ mileage: 41200 }));

    await vehicles.correctMileage(admin, "veh-1", { mileage: 41200, reason: "Typo at check-in" });

    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        action: "vehicle.mileageCorrected",
        changes: { mileage: { from: 42000, to: 41200 }, reason: "Typo at check-in" },
      }),
    );
  });

  it("rejects a correction to the current value", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findUnique.mockResolvedValue(vehicleRow());

    await expect(vehicles.correctMileage(admin, "veh-1", { mileage: 42000, reason: "No change" })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("returns not found for an unknown vehicle", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findUnique.mockResolvedValue(null);

    await expect(vehicles.correctMileage(admin, "nope", { mileage: 1, reason: "Fix it" })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("VehiclesService.duplicates", () => {
  it("warns staff about the same plate in the same province, with details", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findMany.mockResolvedValue([vehicleRow()]);

    const result = await vehicles.duplicates(advisor, { plate: "1กข-1234", province: "กรุงเทพมหานคร" });

    expect(prisma.vehicle.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ plateNormalized: "1กข1234", province: "กรุงเทพมหานคร" }),
    );
    expect(result.plateMatchCount).toBe(1);
    expect(result.byPlate).toHaveLength(1);
  });

  it("tells a customer only that matches exist, never whose vehicle", async () => {
    const { prisma, vehicles } = setup();
    prisma.vehicle.findMany.mockResolvedValue([vehicleRow({ customerId: "cust-2" })]);
    prisma.vehicle.findFirst.mockResolvedValue(vehicleRow({ customerId: "cust-2" }));

    const result = await vehicles.duplicates(customer, {
      plate: "1กข 1234",
      province: "กรุงเทพมหานคร",
      vin: "MRHFC1650KP000001",
    });

    expect(result).toEqual({ plateMatchCount: 1, byPlate: [], vinTaken: true, byVin: null });
  });

  it("does no plate lookup without a province", async () => {
    const { prisma, vehicles } = setup();

    await vehicles.duplicates(advisor, { plate: "1กข 1234", vin: "MRHFC1650KP000001" });

    expect(prisma.vehicle.findMany).not.toHaveBeenCalled();
  });
});
