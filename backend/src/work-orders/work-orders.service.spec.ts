import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createPrismaMock, makeAuthUser } from "../../test/prisma-mock";
import type { StockService } from "../inventory/stock.service";
import { WorkOrdersService } from "./work-orders.service";

const advisor = makeAuthUser({ id: "advisor-1", role: "ADVISOR" });
const sam = makeAuthUser({ id: "mech-sam", role: "MECHANIC" });
const otherMechanic = makeAuthUser({ id: "mech-other", role: "MECHANIC" });

function workOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo-1",
    number: 3,
    vehicleId: "veh-1",
    mileageIn: 45000,
    complaint: "Brakes squeal",
    diagnosis: null,
    workPerformed: null,
    notes: null,
    status: "IN_PROGRESS",
    mechanicId: "mech-sam",
    createdById: "advisor-1",
    completedAt: null,
    ...overrides,
  };
}

function setup() {
  const { prisma, service } = createPrismaMock();
  const stock = { change: jest.fn().mockResolvedValue(0) };
  const workOrders = new WorkOrdersService(service, stock as unknown as StockService);
  // Every mutation returns the reloaded detail; its mapping is covered by integration tests.
  jest.spyOn(workOrders, "findOne").mockResolvedValue({} as never);
  return { prisma, stock, workOrders };
}

describe("WorkOrdersService.create (check-in)", () => {
  const input = { vehicleId: "veh-1", mileageIn: 45000, complaint: "Brakes squeal" };

  it("creates the job with a Checked-in history entry and an audit entry", async () => {
    const { prisma, workOrders } = setup();
    prisma.vehicle.findUnique.mockResolvedValue({ id: "veh-1", mileage: 42000 });
    prisma.workOrder.findFirst.mockResolvedValue(null);
    prisma.workOrder.create.mockResolvedValue({ id: "wo-new" });

    await workOrders.create(advisor, input);

    expect(prisma.workOrder.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        vehicleId: "veh-1",
        mileageIn: 45000,
        mechanicId: null,
        createdById: "advisor-1",
        statusChanges: { create: { toStatus: "CHECKED_IN", changedById: "advisor-1" } },
      }),
    );
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe("workOrder.created");
  });

  it("accepts the same mileage as recorded, refuses a lower one", async () => {
    const { prisma, workOrders } = setup();
    prisma.vehicle.findUnique.mockResolvedValue({ id: "veh-1", mileage: 45000 });
    prisma.workOrder.create.mockResolvedValue({ id: "wo-new" });

    await expect(workOrders.create(advisor, input)).resolves.toBeDefined();
    const error = await workOrders.create(advisor, { ...input, mileageIn: 44999 }).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().errors.mileageIn[0]).toContain("45,000 km");
  });

  it("refuses a second open job for the same vehicle and says which one", async () => {
    const { prisma, workOrders } = setup();
    prisma.vehicle.findUnique.mockResolvedValue({ id: "veh-1", mileage: 0 });
    prisma.workOrder.findFirst.mockResolvedValue({ id: "wo-open", number: 3 });

    const error = await workOrders.create(advisor, input).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toContain("WO-0003");
    expect(error.getResponse()).toEqual(expect.objectContaining({ workOrderId: "wo-open" }));
  });

  it("only assigns active mechanics", async () => {
    const { prisma, workOrders } = setup();
    prisma.vehicle.findUnique.mockResolvedValue({ id: "veh-1", mileage: 0 });
    prisma.workOrder.findFirst.mockResolvedValue(null);

    for (const user of [null, { role: "ADVISOR", isActive: true }, { role: "MECHANIC", isActive: false }]) {
      prisma.user.findUnique.mockResolvedValueOnce(user);
      await expect(workOrders.create(advisor, { ...input, mechanicId: "x" })).rejects.toThrow(BadRequestException);
    }
    expect(prisma.workOrder.create).not.toHaveBeenCalled();
  });

  it("returns not found for an unknown vehicle", async () => {
    const { prisma, workOrders } = setup();
    prisma.vehicle.findUnique.mockResolvedValue(null);

    await expect(workOrders.create(advisor, input)).rejects.toThrow(NotFoundException);
  });
});

describe("WorkOrdersService.changeStatus", () => {
  it("lets the assigned mechanic move their job forward and records history", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow({ status: "DIAGNOSING" }));

    await workOrders.changeStatus(sam, "wo-1", { status: "AWAITING_PARTS", note: "Pads ordered" });

    expect(prisma.workOrder.update).toHaveBeenCalledWith({ where: { id: "wo-1" }, data: { status: "AWAITING_PARTS" } });
    expect(prisma.workOrderStatusChange.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ fromStatus: "DIAGNOSING", toStatus: "AWAITING_PARTS", note: "Pads ordered", changedById: "mech-sam" }),
    );
  });

  it("blocks a mechanic who isn't assigned to the job", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());

    await expect(workOrders.changeStatus(otherMechanic, "wo-1", { status: "QUALITY_CHECK" })).rejects.toThrow(ForbiddenException);
  });

  it("keeps Completed and Cancelled for advisors, even for the assigned mechanic", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow({ status: "QUALITY_CHECK" }));

    await expect(workOrders.changeStatus(sam, "wo-1", { status: "CANCELLED" })).rejects.toThrow(
      "Only an advisor or admin can move a job to Cancelled",
    );
    await expect(workOrders.changeStatus(sam, "wo-1", { status: "COMPLETED" })).rejects.toThrow(ForbiddenException);
  });

  it("lets quality check send a job back to In progress", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow({ status: "QUALITY_CHECK" }));

    await workOrders.changeStatus(advisor, "wo-1", { status: "IN_PROGRESS", note: "Still squeals" });

    expect(prisma.workOrder.update.mock.calls[0][0].data).toEqual({ status: "IN_PROGRESS" });
  });

  it.each([
    ["CHECKED_IN", "QUALITY_CHECK"],
    ["CHECKED_IN", "IN_PROGRESS"],
    ["AWAITING_PARTS", "QUALITY_CHECK"],
    ["IN_PROGRESS", "DIAGNOSING"],
  ])("refuses to skip from %s to %s", async (from, to) => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow({ status: from }));

    await expect(workOrders.changeStatus(advisor, "wo-1", { status: to as never })).rejects.toThrow(BadRequestException);
  });

  it("doesn't complete jobs yet (completion and invoicing are Step 4b)", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow({ status: "QUALITY_CHECK" }));

    await expect(workOrders.changeStatus(advisor, "wo-1", { status: "COMPLETED" })).rejects.toThrow("aren't available yet");
    expect(prisma.workOrder.update).not.toHaveBeenCalled();
  });

  it("returns every part to stock when a job is cancelled", async () => {
    const { prisma, stock, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());
    prisma.partUsed.findMany.mockResolvedValue([
      { id: "p1", inventoryItemId: "item-a", quantity: 2 },
      { id: "p2", inventoryItemId: "item-b", quantity: 1 },
    ]);

    await workOrders.changeStatus(advisor, "wo-1", { status: "CANCELLED", note: "Customer declined" });

    expect(stock.change).toHaveBeenCalledTimes(2);
    expect(stock.change).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inventoryItemId: "item-a", change: 2, reason: "WORK_ORDER", note: "Returned: WO-0003 cancelled" }),
    );
    expect(prisma.partUsed.deleteMany).toHaveBeenCalledWith({ where: { workOrderId: "wo-1" } });
  });

  it.each(["COMPLETED", "CANCELLED"])("refuses any change once a job is %s", async (status) => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow({ status }));

    await expect(workOrders.changeStatus(advisor, "wo-1", { status: "IN_PROGRESS" })).rejects.toThrow(ConflictException);
    await expect(workOrders.updateDetails(advisor, "wo-1", { diagnosis: "x" })).rejects.toThrow(ConflictException);
    await expect(workOrders.addLabour(advisor, "wo-1", { description: "x", laborCost: 1 })).rejects.toThrow(ConflictException);
  });
});

describe("WorkOrdersService assignment and notes", () => {
  it("reassigns a mechanic and records from/to", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());
    prisma.user.findUnique.mockResolvedValue({ role: "MECHANIC", isActive: true });

    await workOrders.assignMechanic(advisor, "wo-1", { mechanicId: "mech-other" });

    expect(prisma.auditLog.create.mock.calls[0][0].data.changes).toEqual({ mechanicId: { from: "mech-sam", to: "mech-other" } });
  });

  it("can unassign, and does nothing when the mechanic doesn't change", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());
    prisma.user.findUnique.mockResolvedValue({ role: "MECHANIC", isActive: true });

    await workOrders.assignMechanic(advisor, "wo-1", { mechanicId: "mech-sam" });
    expect(prisma.workOrder.update).not.toHaveBeenCalled();

    await workOrders.assignMechanic(advisor, "wo-1", { mechanicId: null });
    expect(prisma.workOrder.update).toHaveBeenCalledWith({ where: { id: "wo-1" }, data: { mechanicId: null } });
  });

  it("saves only the notes that changed", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow({ diagnosis: "Worn pads" }));

    await workOrders.updateDetails(sam, "wo-1", { diagnosis: "Worn pads" });
    expect(prisma.workOrder.update).not.toHaveBeenCalled();

    await workOrders.updateDetails(sam, "wo-1", { diagnosis: "Worn pads", workPerformed: "Replaced front pads" });
    expect(prisma.auditLog.create.mock.calls[0][0].data.changes).toEqual({
      workPerformed: { from: null, to: "Replaced front pads" },
    });
  });

  it("blocks another mechanic from editing notes", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());

    await expect(workOrders.updateDetails(otherMechanic, "wo-1", { diagnosis: "x" })).rejects.toThrow(ForbiddenException);
  });
});

describe("WorkOrdersService labour and parts", () => {
  it("adds and removes labour lines", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());
    prisma.serviceItem.create.mockResolvedValue({ id: "li-1" });
    prisma.serviceItem.findFirst.mockResolvedValue({ id: "li-1", description: "Pads", laborCost: new Prisma.Decimal(600) });

    await workOrders.addLabour(sam, "wo-1", { description: "Replace pads", laborCost: 600 });
    await workOrders.removeLabour(sam, "wo-1", "li-1");

    expect(prisma.serviceItem.create.mock.calls[0][0].data).toEqual({ workOrderId: "wo-1", description: "Replace pads", laborCost: 600 });
    expect(prisma.serviceItem.delete).toHaveBeenCalledWith({ where: { id: "li-1" } });
  });

  it("takes a part out of stock and snapshots its current price", async () => {
    const { prisma, stock, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: "item-a", name: "Pads", isActive: true, unitPrice: new Prisma.Decimal(1500) });

    await workOrders.addPart(sam, "wo-1", { inventoryItemId: "item-a", quantity: 2 });

    expect(stock.change).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inventoryItemId: "item-a", change: -2, reason: "WORK_ORDER", workOrderId: "wo-1", note: "Used on WO-0003" }),
    );
    expect(prisma.partUsed.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ inventoryItemId: "item-a", quantity: 2, unitPrice: new Prisma.Decimal(1500) }),
    );
  });

  it("passes on 'not enough stock' and doesn't record the part", async () => {
    const { prisma, stock, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: "item-a", name: "Pads", isActive: true, unitPrice: new Prisma.Decimal(1) });
    stock.change.mockRejectedValue(new ConflictException("Not enough stock: only 1 Pads left"));

    await expect(workOrders.addPart(sam, "wo-1", { inventoryItemId: "item-a", quantity: 2 })).rejects.toThrow("only 1 Pads left");
    expect(prisma.partUsed.create).not.toHaveBeenCalled();
  });

  it("refuses deactivated and unknown parts", async () => {
    const { prisma, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());
    prisma.inventoryItem.findUnique.mockResolvedValueOnce({ id: "x", name: "Old part", isActive: false }).mockResolvedValueOnce(null);

    await expect(workOrders.addPart(sam, "wo-1", { inventoryItemId: "x", quantity: 1 })).rejects.toThrow("deactivated");
    await expect(workOrders.addPart(sam, "wo-1", { inventoryItemId: "y", quantity: 1 })).rejects.toThrow(NotFoundException);
  });

  it("returns a removed part to stock, but only a part from this job", async () => {
    const { prisma, stock, workOrders } = setup();
    prisma.workOrder.findUnique.mockResolvedValue(workOrderRow());
    prisma.partUsed.findFirst.mockResolvedValueOnce({ id: "p1", inventoryItemId: "item-a", quantity: 2 }).mockResolvedValueOnce(null);

    await workOrders.removePart(sam, "wo-1", "p1");
    expect(stock.change).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ change: 2, note: "Returned from WO-0003" }));
    expect(prisma.partUsed.findFirst.mock.calls[0][0].where).toEqual({ id: "p1", workOrderId: "wo-1" });

    await expect(workOrders.removePart(sam, "wo-1", "p-from-other-job")).rejects.toThrow(NotFoundException);
  });
});

describe("WorkOrdersService.list", () => {
  it("filters open jobs assigned to the signed-in mechanic", async () => {
    const { prisma, workOrders } = setup();

    await workOrders.list(sam, { page: 1, pageSize: 20, status: "open", mechanic: "me" });

    const where = prisma.workOrder.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["CHECKED_IN", "DIAGNOSING", "AWAITING_PARTS", "IN_PROGRESS", "QUALITY_CHECK"] });
    expect(where.mechanicId).toBe("mech-sam");
  });

  it("finds a job by its number and plate, and filters by Bangkok dates", async () => {
    const { prisma, workOrders } = setup();

    await workOrders.list(advisor, { page: 1, pageSize: 20, q: "WO-0003", from: "2026-10-20", to: "2026-10-20" });

    const where = prisma.workOrder.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toContainEqual({ number: 3 });
    expect(where.createdAt).toEqual({
      gte: new Date("2026-10-19T17:00:00.000Z"),
      lte: new Date("2026-10-20T16:59:59.999Z"),
    });
  });

  it("filters unassigned jobs and closed jobs", async () => {
    const { prisma, workOrders } = setup();

    await workOrders.list(advisor, { page: 1, pageSize: 20, status: "closed", mechanic: "none" });

    const where = prisma.workOrder.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["COMPLETED", "CANCELLED"] });
    expect(where.mechanicId).toBeNull();
  });
});
