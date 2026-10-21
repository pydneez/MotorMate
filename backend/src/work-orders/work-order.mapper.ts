import { Prisma } from "@prisma/client";
import {
  calculateTotals,
  type InvoiceStatus,
  type WorkOrderDetail,
  type WorkOrderStatus,
  type WorkOrderSummary,
} from "@motormate/types";

const name = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`;

export const workOrderSummaryInclude = {
  vehicle: {
    select: {
      id: true,
      plate: true,
      province: true,
      make: true,
      model: true,
      year: true,
      customer: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  mechanic: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.WorkOrderInclude;

export const workOrderDetailInclude = {
  ...workOrderSummaryInclude,
  createdBy: { select: { firstName: true, lastName: true } },
  serviceItems: { orderBy: { createdAt: "asc" } },
  partsUsed: { orderBy: { createdAt: "asc" }, include: { inventoryItem: { select: { sku: true, name: true } } } },
  statusChanges: { orderBy: { createdAt: "asc" }, include: { changedBy: { select: { firstName: true, lastName: true } } } },
  recommendations: { orderBy: { createdAt: "asc" } },
  invoice: { select: { id: true, number: true, status: true, subtotal: true, vatRate: true, vatAmount: true, total: true } },
} satisfies Prisma.WorkOrderInclude;

type SummaryRow = Prisma.WorkOrderGetPayload<{ include: typeof workOrderSummaryInclude }>;
type DetailRow = Prisma.WorkOrderGetPayload<{ include: typeof workOrderDetailInclude }>;

export function toWorkOrderSummary(row: SummaryRow): WorkOrderSummary {
  const { vehicle } = row;
  return {
    id: row.id,
    number: row.number,
    status: row.status as WorkOrderStatus,
    complaint: row.complaint,
    mileageIn: row.mileageIn,
    vehicle: {
      id: vehicle.id,
      plate: vehicle.plate,
      province: vehicle.province,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
    },
    customer: { id: vehicle.customer.id, name: name(vehicle.customer) },
    mechanic: row.mechanic ? { id: row.mechanic.id, name: name(row.mechanic) } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export function toWorkOrderDetail(row: DetailRow): WorkOrderDetail {
  const labour = row.serviceItems.map((item) => ({
    id: item.id,
    description: item.description,
    laborCost: item.laborCost.toNumber(),
  }));
  const parts = row.partsUsed.map((part) => {
    const unitPrice = part.unitPrice.toNumber();
    return {
      id: part.id,
      inventoryItemId: part.inventoryItemId,
      sku: part.inventoryItem.sku,
      name: part.inventoryItem.name,
      quantity: part.quantity,
      unitPrice,
      lineTotal: Math.round(unitPrice * 100 * part.quantity) / 100,
    };
  });
  const running = calculateTotals(
    labour.map((line) => line.laborCost),
    parts,
  );
  const { invoice } = row;
  return {
    ...toWorkOrderSummary(row),
    diagnosis: row.diagnosis,
    workPerformed: row.workPerformed,
    notes: row.notes,
    createdBy: name(row.createdBy),
    labour,
    parts,
    history: row.statusChanges.map((change) => ({
      fromStatus: (change.fromStatus as WorkOrderStatus | null) ?? null,
      toStatus: change.toStatus as WorkOrderStatus,
      note: change.note,
      createdAt: change.createdAt.toISOString(),
      changedBy: name(change.changedBy),
    })),
    recommendations: row.recommendations.map((rec) => ({
      id: rec.id,
      description: rec.description,
      dueMileage: rec.dueMileage,
      dueDate: rec.dueDate ? rec.dueDate.toISOString().slice(0, 10) : null,
    })),
    // Once invoiced, show exactly what was billed.
    totals: invoice
      ? {
          labour: running.labour,
          parts: running.parts,
          subtotal: invoice.subtotal.toNumber(),
          vatRate: invoice.vatRate.toNumber(),
          vat: invoice.vatAmount.toNumber(),
          total: invoice.total.toNumber(),
        }
      : running,
    invoice: invoice ? { id: invoice.id, number: invoice.number, status: invoice.status as InvoiceStatus } : null,
  };
}
