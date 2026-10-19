import { Prisma } from "@prisma/client";
import type { ServiceHistoryEntry, VehicleSummary, WorkOrderStatus } from "@motormate/types";

/** Include needed to build a VehicleSummary: the owner and the date of the latest visit. */
export const vehicleSummaryInclude = {
  customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
  workOrders: {
    where: { status: { not: "CANCELLED" } },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} satisfies Prisma.VehicleInclude;

type VehicleWithSummary = Prisma.VehicleGetPayload<{ include: typeof vehicleSummaryInclude }>;

export function toVehicleSummary(vehicle: VehicleWithSummary): VehicleSummary {
  const { customer, workOrders, ...fields } = vehicle;
  return {
    ...fields,
    owner: customer,
    lastVisitAt: workOrders[0]?.createdAt.toISOString() ?? null,
  };
}

/** Include for the service-history timeline on the vehicle detail page. */
export const serviceHistoryInclude = {
  workOrders: {
    where: { status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    include: {
      mechanic: { select: { firstName: true, lastName: true } },
      partsUsed: { include: { inventoryItem: { select: { name: true } } } },
      invoice: { select: { total: true } },
      recommendations: { select: { description: true, dueMileage: true, dueDate: true } },
    },
  },
} satisfies Prisma.VehicleInclude;

type VehicleWithHistory = Prisma.VehicleGetPayload<{ include: typeof serviceHistoryInclude }>;

export function toServiceHistory(vehicle: VehicleWithHistory): ServiceHistoryEntry[] {
  return vehicle.workOrders.map((wo) => ({
    workOrderId: wo.id,
    number: wo.number,
    status: wo.status as WorkOrderStatus,
    date: (wo.completedAt ?? wo.createdAt).toISOString(),
    mileageIn: wo.mileageIn,
    complaint: wo.complaint,
    workPerformed: wo.workPerformed,
    mechanicName: wo.mechanic ? `${wo.mechanic.firstName} ${wo.mechanic.lastName}` : null,
    parts: wo.partsUsed.map((part) => ({ name: part.inventoryItem.name, quantity: part.quantity })),
    total: wo.invoice ? wo.invoice.total.toNumber() : null,
    recommendations: wo.recommendations.map((rec) => ({
      description: rec.description,
      dueMileage: rec.dueMileage,
      dueDate: rec.dueDate?.toISOString() ?? null,
    })),
  }));
}
