import { Prisma } from "@prisma/client";
import type { AppointmentStatus, AppointmentSummary } from "@motormate/types";

export const appointmentInclude = {
  customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
  vehicle: { select: { id: true, plate: true, province: true, make: true, model: true, year: true } },
  workOrder: { select: { id: true, number: true } },
} satisfies Prisma.AppointmentInclude;

type Row = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export function toAppointmentSummary(row: Row): AppointmentSummary {
  const { customer } = row;
  return {
    id: row.id,
    scheduledAt: row.scheduledAt.toISOString(),
    reason: row.reason,
    status: row.status as AppointmentStatus,
    customer: { id: customer.id, name: `${customer.firstName} ${customer.lastName}`, phone: customer.phone },
    vehicle: row.vehicle,
    workOrder: row.workOrder,
    createdAt: row.createdAt.toISOString(),
  };
}
