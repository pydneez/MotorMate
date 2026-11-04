import { z } from "zod";
import { bangkokParts } from "./appointment";
import { checkDateRange, DaySchema, dayValue } from "./common";
import type { WorkOrderStatus } from "./work-order";

const DAY_MS = 24 * 60 * 60 * 1000;

export const REPORT_MAX_DAYS = 366;

export const ReportQuerySchema = z
  .object({ from: DaySchema, to: DaySchema })
  .superRefine(({ from, to }, ctx) => {
    const start = dayValue(from);
    const end = dayValue(to);
    if (start === null || end === null) return;
    if (end < start) {
      checkDateRange({ from, to }, ctx);
    } else if (reportDayCount(from, to) > REPORT_MAX_DAYS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Choose at most 12 months" });
    }
  });

export type ReportQuery = z.output<typeof ReportQuerySchema>;

export function reportDayCount(from: string, to: string): number {
  return Math.round((dayValue(to)! - dayValue(from)!) / DAY_MS) + 1;
}

export function addDays(day: string, days: number): string {
  return new Date(dayValue(day)! + days * DAY_MS).toISOString().slice(0, 10);
}

export type ReportBucket = "day" | "week" | "month";

export function reportBucket(from: string, to: string): ReportBucket {
  const days = reportDayCount(from, to);
  if (days <= 31) return "day";
  if (days <= 92) return "week";
  return "month";
}

export function bucketStart(day: string, bucket: ReportBucket): string {
  if (bucket === "day") return day;
  if (bucket === "month") return `${day.slice(0, 7)}-01`;
  const weekday = new Date(dayValue(day)!).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function reportBuckets(from: string, to: string, bucket: ReportBucket): string[] {
  const starts: string[] = [];
  let current = bucketStart(from, bucket);
  while (current <= to) {
    starts.push(current);
    if (bucket === "day") current = addDays(current, 1);
    else if (bucket === "week") current = addDays(current, 7);
    else {
      const [year, month] = current.split("-").map(Number);
      current = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    }
  }
  return starts;
}

export type ReportPreset = "this-month" | "last-month" | "last-3-months" | "this-year";

export const REPORT_PRESET_LABEL: Record<ReportPreset, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "last-3-months": "Last 3 months",
  "this-year": "This year",
};

export function reportPresetRange(preset: ReportPreset, now: Date = new Date()): ReportQuery {
  const today = bangkokParts(now).date;
  const [year, month] = today.split("-").map(Number);
  const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  switch (preset) {
    case "this-month":
      return { from: monthStart(year, month), to: today };
    case "last-month":
      return { from: monthStart(year, month - 1), to: addDays(monthStart(year, month), -1) };
    case "last-3-months":
      return { from: monthStart(year, month - 2), to: today };
    case "this-year":
      return { from: `${year}-01-01`, to: today };
  }
}

export function matchReportPreset(range: ReportQuery, now: Date = new Date()): ReportPreset | null {
  const presets = Object.keys(REPORT_PRESET_LABEL) as ReportPreset[];
  return (
    presets.find((preset) => {
      const candidate = reportPresetRange(preset, now);
      return candidate.from === range.from && candidate.to === range.to;
    }) ?? null
  );
}

export const REPORT_EXPORTS = ["invoices", "work-orders", "parts"] as const;

export type ReportExport = (typeof REPORT_EXPORTS)[number];

export const REPORT_EXPORT_LABEL: Record<ReportExport, string> = {
  invoices: "Invoices",
  "work-orders": "Work orders",
  parts: "Parts used",
};

export function reportCsvFilename(kind: ReportExport, range: ReportQuery): string {
  return `motormate-${kind}-${range.from}_${range.to}.csv`;
}

export type OpenWorkOrderStatus = Exclude<WorkOrderStatus, "COMPLETED" | "CANCELLED">;

/**
 * A part used on invoiced jobs in the period. costUsed is at today's unit cost (parts used
 * keep the price charged, not the cost at the time); onHand is today's stock.
 */
export type ReportPartRow = { id: string; sku: string; name: string; quantity: number; revenue: number; costUsed: number; onHand: number };

/**
 * A service from the price list (by its current name), or — `custom: true` — every custom
 * labour line together, which comes last.
 */
export type ReportLabourRow = { description: string; count: number; amount: number; custom: boolean };

/** Invoiced amounts for a period — all of GET /reports/revenue, and part of the summary. */
export type RevenueTotals = {
  invoiceCount: number;
  total: number;
  paid: { count: number; total: number };
  unpaid: { count: number; total: number };
};

export type ReportSummary = {
  range: ReportQuery & { days: number; bucket: ReportBucket };
  revenue: RevenueTotals & {
    subtotal: number;
    vat: number;
    labour: number;
    parts: number;
    series: { start: string; total: number; count: number }[];
  };
  jobs: {
    completed: number;
    cancelled: number;
    averageHoursToComplete: number | null;
    openByStatus: Record<OpenWorkOrderStatus, number>;
    mechanics: { id: string; name: string; completed: number; labour: number }[];
    /** The 10 most common labour lines on invoiced jobs. */
    topLabour: ReportLabourRow[];
  };
  parts: {
    topByQuantity: ReportPartRow[];
    topByRevenue: ReportPartRow[];
    stockValueAtCost: number;
    lowStockCount: number;
    /** Parts used in the period at today's unit cost. */
    costOfPartsUsed: number;
    /** Inventory turnover for the period: costOfPartsUsed ÷ stockValueAtCost (null with no stock). */
    turnover: number | null;
  };
  bookings: {
    total: number;
    completed: number;
    noShow: number;
    cancelled: number;
    noShowRate: number | null;
    newCustomers: number;
    /** Customers with a job completed in the period. */
    servedCustomers: number;
    /** Of those, customers who had at least one earlier completed job too. */
    repeatCustomers: number;
    repeatRate: number | null;
    remindersSent: number;
  };
};