import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
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
  type ReportLabourRow,
  type ReportPartRow,
  type ReportQuery,
  type ReportSummary,
  type RevenueTotals,
} from "@motormate/types";
import { bangkokDayFilter } from "../common/utils/dates";
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
  return bangkokDayFilter(range.from, range.to) as Period;
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

/** Parts used at cost ÷ stock value at cost, for the period; null when there's no stock to turn over. */
export function inventoryTurnover(costOfPartsUsed: number, stockValueAtCost: number): number | null {
  return stockValueAtCost > 0 ? round2(costOfPartsUsed / stockValueAtCost) : null;
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

    const [totals, labour, series, parts, jobs, cancelled, open, mechanics, stock, appointments, newCustomers, repeat, remindersSent, topLabour] =
      await Promise.all([
        this.revenueTotals(period),
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
        this.repeatCustomers(period),
        this.prisma.notificationLog.count({ where: { type: "SERVICE_REMINDER", status: "SENT", createdAt: period } }),
        this.labourLines(period),
      ]);
    const costOfPartsUsed = round2(parts.reduce((sum, part) => sum + part.costUsed, 0));

    const openByStatus = Object.fromEntries(OPEN_STATUSES.map((status) => [status, 0])) as Record<OpenWorkOrderStatus, number>;
    for (const row of open) openByStatus[row.status as OpenWorkOrderStatus] = row._count._all;

    const bookings = Object.fromEntries(appointments.map((row) => [row.status, row._count._all])) as Partial<Record<string, number>>;
    const booked = (status: string) => bookings[status] ?? 0;

    return {
      range: { ...range, days: reportDayCount(range.from, range.to), bucket },
      revenue: {
        ...totals,
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
        topLabour,
      },
      parts: { ...topParts(parts), ...stock, costOfPartsUsed, turnover: inventoryTurnover(costOfPartsUsed, stock.stockValueAtCost) },
      bookings: {
        total: appointments.reduce((sum, row) => sum + row._count._all, 0),
        completed: booked("COMPLETED"),
        noShow: booked("NO_SHOW"),
        cancelled: booked("CANCELLED"),
        noShowRate: noShowRate(booked("COMPLETED"), booked("CHECKED_IN"), booked("NO_SHOW")),
        newCustomers,
        servedCustomers: repeat.served,
        repeatCustomers: repeat.repeat,
        repeatRate: repeat.served === 0 ? null : repeat.repeat / repeat.served,
        remindersSent,
      },
    };
  }

  /** Invoiced, paid and unpaid totals for the period — the dashboard's revenue card uses only this. */
  private async revenueTotals(period: Period): Promise<RevenueTotals & { subtotal: number; vat: number }> {
    const invoiced = this.invoiced(period);
    const [all, paid, unpaid] = await Promise.all([
      this.prisma.invoice.aggregate({ where: invoiced, _count: { _all: true }, _sum: { subtotal: true, vatAmount: true, total: true } }),
      this.prisma.invoice.aggregate({ where: { ...invoiced, status: "PAID" }, _count: { _all: true }, _sum: { total: true } }),
      this.prisma.invoice.aggregate({ where: { ...invoiced, status: "UNPAID" }, _count: { _all: true }, _sum: { total: true } }),
    ]);
    return {
      invoiceCount: all._count._all,
      subtotal: amount(all._sum.subtotal),
      vat: amount(all._sum.vatAmount),
      total: amount(all._sum.total),
      paid: { count: paid._count._all, total: amount(paid._sum.total) },
      unpaid: { count: unpaid._count._all, total: amount(unpaid._sum.total) },
    };
  }

  async revenue(range: ReportQuery): Promise<RevenueTotals> {
    const { invoiceCount, total, paid, unpaid } = await this.revenueTotals(reportPeriod(range));
    return { invoiceCount, total, paid, unpaid };
  }

  /**
   * Customers with a job completed in the period, and how many of them had at least two
   * completed jobs by the end of it (a return visit). Goes by the vehicle's current owner.
   */
  private async repeatCustomers(period: Period): Promise<{ served: number; repeat: number }> {
    const [row] = await this.prisma.$queryRaw<{ served: number; repeat: number }[]>`
      WITH served AS (
        SELECT DISTINCT v."customerId"
        FROM "WorkOrder" w
        JOIN "Vehicle" v ON v."id" = w."vehicleId"
        WHERE w."status" = 'COMPLETED' AND w."completedAt" >= ${period.gte} AND w."completedAt" < ${period.lt}
      ),
      visits AS (
        SELECT v."customerId", COUNT(*)::int AS "jobs"
        FROM "WorkOrder" w
        JOIN "Vehicle" v ON v."id" = w."vehicleId"
        WHERE w."status" = 'COMPLETED' AND w."completedAt" < ${period.lt}
          AND v."customerId" IN (SELECT "customerId" FROM served)
        GROUP BY v."customerId"
      )
      SELECT (SELECT COUNT(*) FROM served)::int AS "served",
             (SELECT COUNT(*) FROM visits WHERE "jobs" >= 2)::int AS "repeat"`;
    return { served: Number(row?.served ?? 0), repeat: Number(row?.repeat ?? 0) };
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
    const rows = await this.prisma.$queryRaw<
      { id: string; sku: string; name: string; quantity: number; revenue: Amount; costUsed: Amount; onHand: number }[]
    >`
      SELECT i."id", i."sku", i."name",
             SUM(p."quantity")::int AS "quantity",
             SUM(p."quantity" * p."unitPrice") AS "revenue",
             SUM(p."quantity" * i."unitCost") AS "costUsed",
             i."quantityOnHand"::int AS "onHand"
      FROM "PartUsed" p
      JOIN "InventoryItem" i ON i."id" = p."inventoryItemId"
      JOIN "Invoice" v ON v."workOrderId" = p."workOrderId"
      WHERE v."issuedAt" >= ${period.gte} AND v."issuedAt" < ${period.lt} AND v."status" <> 'VOID'
      GROUP BY i."id", i."sku", i."name", i."quantityOnHand"`;
    return rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity),
      revenue: amount(row.revenue),
      costUsed: round2(amount(row.costUsed)),
      onHand: Number(row.onHand),
    }));
  }

  /**
   * The most performed services on invoiced jobs: lines picked from the price list, counted
   * per service (named as the list names it today), then every custom line as one row.
   */
  private async labourLines(period: Period): Promise<ReportLabourRow[]> {
    const invoicedLines: Prisma.ServiceItemWhereInput = { workOrder: { invoice: { is: this.invoiced(period) } } };
    const [listed, custom] = await Promise.all([
      this.prisma.serviceItem.groupBy({
        by: ["catalogItemId"],
        where: { ...invoicedLines, catalogItemId: { not: null } },
        _count: { _all: true },
        _sum: { laborCost: true },
        orderBy: [{ _count: { catalogItemId: "desc" } }, { _sum: { laborCost: "desc" } }],
        take: TOP_PARTS,
      }),
      this.prisma.serviceItem.aggregate({ where: { ...invoicedLines, catalogItemId: null }, _count: { _all: true }, _sum: { laborCost: true } }),
    ]);
    const services = await this.prisma.serviceCatalogItem.findMany({
      where: { id: { in: listed.map((row) => row.catalogItemId!) } },
      select: { id: true, name: true },
    });
    const names = new Map(services.map((service) => [service.id, service.name]));
    const rows: ReportLabourRow[] = listed.map((row) => ({
      description: names.get(row.catalogItemId!) ?? "(removed service)",
      count: row._count._all,
      amount: amount(row._sum.laborCost),
      custom: false,
    }));
    if (custom._count._all > 0) {
      rows.push({ description: "Other (custom lines)", count: custom._count._all, amount: amount(custom._sum.laborCost), custom: true });
    }
    return rows;
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