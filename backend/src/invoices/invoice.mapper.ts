import { Prisma } from "@prisma/client";
import type { InvoiceDetail, InvoiceStatus, InvoiceSummary } from "@motormate/types";

const vehicleSelect = { id: true, plate: true, province: true, make: true, model: true, year: true } as const;

export const invoiceSummaryInclude = {
  workOrder: {
    select: {
      id: true,
      number: true,
      vehicle: { select: { ...vehicleSelect, customer: { select: { id: true, firstName: true, lastName: true } } } },
    },
  },
} satisfies Prisma.InvoiceInclude;

export const invoiceDetailInclude = {
  workOrder: {
    select: {
      id: true,
      number: true,
      mileageIn: true,
      workPerformed: true,
      vehicle: {
        select: {
          ...vehicleSelect,
          vin: true,
          customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        },
      },
      serviceItems: { orderBy: { createdAt: "asc" } },
      partsUsed: { orderBy: { createdAt: "asc" }, include: { inventoryItem: { select: { sku: true, name: true } } } },
    },
  },
} satisfies Prisma.InvoiceInclude;

type SummaryRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceSummaryInclude }>;
type DetailRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceDetailInclude }>;

export function toInvoiceSummary(row: SummaryRow): InvoiceSummary {
  const { vehicle } = row.workOrder;
  const { customer, ...vehicleFields } = vehicle;
  return {
    id: row.id,
    number: row.number,
    status: row.status as InvoiceStatus,
    total: row.total.toNumber(),
    issuedAt: row.issuedAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    workOrder: { id: row.workOrder.id, number: row.workOrder.number },
    customer: { id: customer.id, name: `${customer.firstName} ${customer.lastName}` },
    vehicle: vehicleFields,
  };
}

export function toInvoiceDetail(row: DetailRow, paidBy: string | null): InvoiceDetail {
  const { workOrder } = row;
  const { customer, ...vehicle } = workOrder.vehicle;
  return {
    ...toInvoiceSummary(row),
    customer: { id: customer.id, name: `${customer.firstName} ${customer.lastName}`, phone: customer.phone, email: customer.email },
    vehicle,
    mileageIn: workOrder.mileageIn,
    workPerformed: workOrder.workPerformed,
    labour: workOrder.serviceItems.map((item) => ({ id: item.id, description: item.description, laborCost: item.laborCost.toNumber() })),
    parts: workOrder.partsUsed.map((part) => {
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
    }),
    subtotal: row.subtotal.toNumber(),
    vatRate: row.vatRate.toNumber(),
    vat: row.vatAmount.toNumber(),
    paidBy,
  };
}
