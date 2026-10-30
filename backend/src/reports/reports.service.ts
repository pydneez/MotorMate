import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  addDays,
  bangkokParts,
  formatInvoiceNumber,
  formatThaiPhone,
  formatWorkOrderNumber,
  INVOICE_STATUS_LABEL,
  reportBucket,
  reportBuckets,
  reportDayCount,
  WORK_ORDER_STATUS_LABEL,
  type OpenWorkOrderStatus,
  type ReportBucket,
  type ReportPartRow,
  type ReportQuery,
  type ReportSummary,
} from "@motormate/types";
import { PrismaService } from "../prisma/prisma.service";
import { csvMoney, toCsv } from "./csv";

const OPEN_STATUSES: OpenWorkOrderStatus[] = ["CHECKED_IN", "DIAGNOSING", "AWAITING_PARTS", "IN_PROGRESS", "QUALITY_CHECK"];

const TOP_PARTS = 10;

type Period = { gte: Date; lt: Date };

type Amount = Prisma.Decimal | number | string | null | undefined;

const amount = (value: Amount) => Number(value ?? 0);

const round2 = (value: number) => Math.round(value * 100) / 100;

const lineTotal = (quantity: number, unitPrice: Amount) => (Math.round(amount(unitPrice) * 100) * quantity) / 100;

const bangkokStamp = (value: Date | null | undefined) => {
  if (!value) return null;
  const { date, time } = bangkokParts(value);
  return `${date} ${time}`;
};

const BANGKOK_LOCAL = (column: string) => Prisma.raw(`(${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')`);

export function reportPeriod(range: ReportQuery): Period {
  return { gte: new Date(`${range.from}T00:00:00+07:00`), lt: new Date(`${addDays(range.to, 1)}T00:00:00+07:00`) };
}

export function noShowRate(completed: number, checkedIn: number, noShow: number): number | null {
  const due = completed + checkedIn + noShow;
  return due === 0 ? null : noShow / due;
}

export function fillSeries(
  starts: string[],
  rows: { start: string; total: Amount; count: number }[],
): ReportSummary["revenue"]["series"] {
  const byStart = new Map(rows.map((row) => [row.start, row]));
  return starts.map((start) => {
    const row = byStart.get(start);
    return { start, total: round2(amount(row?.total)), count: row ? Number(row.count) : 0 };
  });
}

export function topParts(rows: ReportPartRow[]): Pick<ReportSummary["parts"], "topByQuantity" | "topByRevenue"> {
  const byName = (a: ReportPartRow, b: ReportPartRow) => a.name.localeCompare(b.name);
  return {
    topByQuantity: [...rows].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || byName(a, b)).slice(0, TOP_PARTS),
    topByRevenue: [...rows].sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || byName(a, b)).slice(0, TOP_PARTS),
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private invoiced(period: Period): Prisma.InvoiceWhereInput {
    return { issuedAt: period, status: { not: "VOID" } };
  }

  async summary(range: ReportQuery): Promise<ReportSummary> {
    const period = reportPeriod(range);
    const bucket = reportBucket(range.from, range.to);
    const invoiced = this.invoiced(period);

    const [all, paid, unpaid, labour, series, parts, jobs, cancelled, open, mechanics, stock, appointments, newCustomers, remindersSent] =
      await Promise.all([
        this.prisma.invoice.aggregate({ where: invoiced, _count: { _all: true }, _sum: { subtotal: true, vatAmount: true, total: true } }),
        this.prisma.invoice.aggregate({ where: { ...invoiced, status: "PAID" }, _count: { _all: true }, _sum: { total: true } }),
        this.prisma.invoice.aggregate({ where: { ...invoiced, status: "UNPAID" }, _count: { _all: true }, _sum: { total: true } }),
        this.prisma.serviceItem.aggregate({ where: { workOrder: { invoice: { is: invoiced } } }, _sum: { laborCost: true } }),
        this.revenueSeries(period, bucket),
        this.partsUsed(period),
        this.completedJobs(period),
        this.prisma.workOrderStatusChange.count({ where: { toStatus: "CANCELLED", createdAt: period } }),
        this.prisma.workOrder.groupBy({ by: ["status"], where: { status: { in: OPEN_STATUSES } }, _count: { _all: true } }),
        this.mechanics(period),
        this.stock(),
        this.prisma.appointment.groupBy({ by: ["status"], where: { scheduledAt: period }, _count: { _all: true } }),
        this.prisma.customer.count({ where: { createdAt: period } }),
        this.prisma.notificationLog.count({ where: { type: "SERVICE_REMINDER", status: "SENT", createdAt: period } }),
      ]);

    const openByStatus = Object.fromEntries(OPEN_STATUSES.map((status) => [status, 0])) as Record<OpenWorkOrderStatus, number>;
    for (const row of open) openByStatus[row.status as OpenWorkOrderStatus] = row._count._all;

    const bookings = Object.fromEntries(appointments.map((row) => [row.status, row._count._all])) as Partial<Record<string, number>>;
    const booked = (status: string) => bookings[status] ?? 0;

    return {
      range: { ...range, days: reportDayCount(range.from, range.to), bucket },
      revenue: {
        invoiceCount: all._count._all,
        subtotal: amount(all._sum.subtotal),
        vat: amount(all._sum.vatAmount),
        total: amount(all._sum.total),
        paid: { count: paid._count._all, total: amount(paid._sum.total) },
        unpaid: { count: unpaid._count._all, total: amount(unpaid._sum.total) },
        labour: amount(labour._sum.laborCost),
        parts: round2(parts.reduce((sum, part) => sum + part.revenue, 0)),
        series: fillSeries(reportBuckets(range.from, range.to, bucket), series),
      },
      jobs: {
        completed: jobs.completed,
        cancelled,
        averageHoursToComplete: jobs.hours === null ? null : round2(jobs.hours),
        openByStatus,
        mechanics,
      },
      parts: { ...topParts(parts), ...stock },
      bookings: {
        total: appointments.reduce((sum, row) => sum + row._count._all, 0),
        completed: booked("COMPLETED"),
        noShow: booked("NO_SHOW"),
        cancelled: booked("CANCELLED"),
        noShowRate: noShowRate(booked("COMPLETED"), booked("CHECKED_IN"), booked("NO_SHOW")),
        newCustomers,
        remindersSent,
      },
    };
  }

  private async revenueSeries(period: Period, bucket: ReportBucket) {
    const unit = Prisma.raw(`'${bucket}'`);
    const rows = await this.prisma.$queryRaw<{ start: string; total: Amount; count: number }[]>`
      SELECT to_char(date_trunc(${unit}, ${BANGKOK_LOCAL(`v."issuedAt"`)}), 'YYYY-MM-DD') AS "start",
             SUM(v."total") AS "total",
             COUNT(*)::int AS "count"
      FROM "Invoice" v
      WHERE v."issuedAt" >= ${period.gte} AND v."issuedAt" < ${period.lt} AND v."status" <> 'VOID'
      GROUP BY 1`;
    return rows;
  }

  private async partsUsed(period: Period): Promise<ReportPartRow[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; sku: string; name: string; quantity: number; revenue: Amount }[]>`
      SELECT i."id", i."sku", i."name",
             SUM(p."quantity")::int AS "quantity",
             SUM(p."quantity" * p."unitPrice") AS "revenue"
      FROM "PartUsed" p
      JOIN "InventoryItem" i ON i."id" = p."inventoryItemId"
      JOIN "Invoice" v ON v."workOrderId" = p."workOrderId"
      WHERE v."issuedAt" >= ${period.gte} AND v."issuedAt" < ${period.lt} AND v."status" <> 'VOID'
      GROUP BY i."id", i."sku", i."name"`;
    return rows.map((row) => ({ ...row, quantity: Number(row.quantity), revenue: amount(row.revenue) }));
  }

  private async completedJobs(period: Period): Promise<{ completed: number; hours: number | null }> {
    const [row] = await this.prisma.$queryRaw<{ completed: number; hours: number | null }[]>`
      SELECT COUNT(*)::int AS "completed",
             AVG(EXTRACT(EPOCH FROM (w."completedAt" - w."createdAt")) / 3600)::float8 AS "hours"
      FROM "WorkOrder" w
      WHERE w."status" = 'COMPLETED' AND w."completedAt" >= ${period.gte} AND w."completedAt" < ${period.lt}`;
    return { completed: Number(row?.completed ?? 0), hours: row?.hours ?? null };
  }

  private async mechanics(period: Period): Promise<ReportSummary["jobs"]["mechanics"]> {
    const rows = await this.prisma.$queryRaw<{ id: string; firstName: string; lastName: string; completed: number; labour: Amount }[]>`
      SELECT u."id", u."firstName", u."lastName",
             COUNT(DISTINCT w."id")::int AS "completed",
             COALESCE(SUM(s."laborCost"), 0) AS "labour"
      FROM "WorkOrder" w
      JOIN "User" u ON u."id" = w."mechanicId"
      LEFT JOIN "ServiceItem" s ON s."workOrderId" = w."id"
      WHERE w."status" = 'COMPLETED' AND w."completedAt" >= ${period.gte} AND w."completedAt" < ${period.lt}
      GROUP BY u."id", u."firstName", u."lastName"
      ORDER BY "completed" DESC, "labour" DESC`;
    return rows.map((row) => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`,
      completed: Number(row.completed),
      labour: amount(row.labour),
    }));
  }

  private async stock(): Promise<Pick<ReportSummary["parts"], "stockValueAtCost" | "lowStockCount">> {
    const [row] = await this.prisma.$queryRaw<{ value: Amount; low: number }[]>`
      SELECT COALESCE(SUM(i."quantityOnHand" * i."unitCost"), 0) AS "value",
             (COUNT(*) FILTER (WHERE i."quantityOnHand" <= i."reorderLevel"))::int AS "low"
      FROM "InventoryItem" i
      WHERE i."isActive"`;
    return { stockValueAtCost: amount(row?.value), lowStockCount: Number(row?.low ?? 0) };
  }

  async invoicesCsv(range: ReportQuery): Promise<string> {
    const invoices = await this.prisma.invoice.findMany({
      where: { issuedAt: reportPeriod(range) },
      orderBy: { number: "asc" },
      include: { workOrder: { select: { number: true, vehicle: { include: { customer: true } } } } },
    });
    return toCsv(
      ["Invoice", "Work order", "Issued", "Status", "Customer", "Phone", "Plate", "Province", "Vehicle", "Subtotal", "VAT", "Total", "Paid at"],
      invoices.map((invoice) => {
        const { vehicle } = invoice.workOrder;
        return [
          formatInvoiceNumber(invoice.number),
          formatWorkOrderNumber(invoice.workOrder.number),
          bangkokStamp(invoice.issuedAt),
          INVOICE_STATUS_LABEL[invoice.status],
          `${vehicle.customer.firstName} ${vehicle.customer.lastName}`,
          formatThaiPhone(vehicle.customer.phone),
          vehicle.plate,
          vehicle.province,
          `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
          csvMoney(amount(invoice.subtotal)),
          csvMoney(amount(invoice.vatAmount)),
          csvMoney(amount(invoice.total)),
          bangkokStamp(invoice.paidAt),
        ];
      }),
    );
  }

  async workOrdersCsv(range: ReportQuery): Promise<string> {
    const period = reportPeriod(range);
    const workOrders = await this.prisma.workOrder.findMany({
      where: {
        OR: [
          { status: "COMPLETED", completedAt: period },
          { status: "CANCELLED", statusChanges: { some: { toStatus: "CANCELLED", createdAt: period } } },
        ],
      },
      orderBy: { number: "asc" },
      include: {
        vehicle: { include: { customer: true } },
        mechanic: { select: { firstName: true, lastName: true } },
        serviceItems: { select: { laborCost: true } },
        partsUsed: { select: { quantity: true, unitPrice: true } },
        invoice: { select: { number: true, total: true, status: true } },
        statusChanges: { where: { toStatus: "CANCELLED" }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return toCsv(
      ["Work order", "Status", "Checked in", "Closed", "Customer", "Plate", "Province", "Vehicle", "Mechanic", "Complaint", "Labour", "Parts", "Invoice", "Invoice total"],
      workOrders.map((workOrder) => {
        const { vehicle } = workOrder;
        const closedAt = workOrder.status === "COMPLETED" ? workOrder.completedAt : workOrder.statusChanges[0]?.createdAt;
        const labour = workOrder.serviceItems.reduce((sum, item) => sum + amount(item.laborCost), 0);
        const parts = workOrder.partsUsed.reduce((sum, part) => sum + lineTotal(part.quantity, part.unitPrice), 0);
        return [
          formatWorkOrderNumber(workOrder.number),
          WORK_ORDER_STATUS_LABEL[workOrder.status],
          bangkokStamp(workOrder.createdAt),
          bangkokStamp(closedAt),
          `${vehicle.customer.firstName} ${vehicle.customer.lastName}`,
          vehicle.plate,
          vehicle.province,
          `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
          workOrder.mechanic ? `${workOrder.mechanic.firstName} ${workOrder.mechanic.lastName}` : null,
          workOrder.complaint,
          csvMoney(round2(labour)),
          csvMoney(round2(parts)),
          workOrder.invoice ? formatInvoiceNumber(workOrder.invoice.number) : null,
          workOrder.invoice ? csvMoney(amount(workOrder.invoice.total)) : null,
        ];
      }),
    );
  }

  async partsCsv(range: ReportQuery): Promise<string> {
    const parts = await this.prisma.partUsed.findMany({
      where: { workOrder: { invoice: { is: this.invoiced(reportPeriod(range)) } } },
      include: {
        inventoryItem: { select: { sku: true, name: true, category: true } },
        workOrder: { select: { number: true, invoice: { select: { number: true, issuedAt: true } } } },
      },
    });
    const issued = (part: (typeof parts)[number]) => part.workOrder.invoice?.issuedAt.getTime() ?? 0;
    parts.sort((a, b) => issued(a) - issued(b) || a.createdAt.getTime() - b.createdAt.getTime());
    return toCsv(
      ["Date", "Invoice", "Work order", "SKU", "Part", "Category", "Quantity", "Unit price", "Line total"],
      parts.map((part) => [
        bangkokStamp(part.workOrder.invoice?.issuedAt),
        part.workOrder.invoice ? formatInvoiceNumber(part.workOrder.invoice.number) : null,
        formatWorkOrderNumber(part.workOrder.number),
        part.inventoryItem.sku,
        part.inventoryItem.name,
        part.inventoryItem.category,
        part.quantity,
        csvMoney(amount(part.unitPrice)),
        csvMoney(lineTotal(part.quantity, part.unitPrice)),
      ]),
    );
  }
}