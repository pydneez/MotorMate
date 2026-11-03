import {
  bucketStart,
  matchReportPreset,
  reportBucket,
  reportBuckets,
  reportCsvFilename,
  reportDayCount,
  reportPresetRange,
  ReportQuerySchema,
} from "@motormate/types";
import { csvCell, csvMoney, toCsv } from "./csv";
import { fillSeries, noShowRate, reportPeriod, topParts } from "./reports.service";

// Thursday 15 Jan 2026, 10:00 in Bangkok.
const JAN_15 = new Date("2026-01-15T03:00:00.000Z");

describe("report date ranges (packages/types)", () => {
  const issue = (from: string, to: string) => {
    const result = ReportQuerySchema.safeParse({ from, to });
    return result.success ? null : result.error.issues[0].message;
  };

  it("accepts real dates up to 366 days, end not before start", () => {
    expect(issue("2026-10-01", "2026-10-31")).toBeNull();
    expect(issue("2026-10-01", "2026-10-01")).toBeNull();
    expect(issue("2025-01-01", "2026-01-01")).toBeNull();
    expect(issue("2025-01-01", "2026-01-02")).toBe("Choose at most 12 months");
    expect(issue("2026-10-31", "2026-10-01")).toBe("The end date can't be before the start date");
    expect(issue("2026-02-30", "2026-03-01")).toBe("Use a real date (yyyy-mm-dd)");
    expect(issue("1/10/2026", "2026-10-31")).toBe("Use a real date (yyyy-mm-dd)");
    expect(ReportQuerySchema.safeParse({}).success).toBe(false);
  });

  it("counts days inclusively", () => {
    expect(reportDayCount("2026-10-01", "2026-10-31")).toBe(31);
    expect(reportDayCount("2026-02-01", "2026-03-01")).toBe(29);
  });

  it("groups by day up to 31 days, by week up to 92, then by month", () => {
    expect(reportBucket("2026-10-01", "2026-10-31")).toBe("day");
    expect(reportBucket("2026-10-01", "2026-11-01")).toBe("week");
    expect(reportBucket("2026-08-01", "2026-10-31")).toBe("week");
    expect(reportBucket("2026-08-01", "2026-11-01")).toBe("month");
  });

  it("starts weeks on Monday and months on the 1st, across year ends", () => {
    expect(bucketStart("2026-11-04", "week")).toBe("2026-11-02");
    expect(bucketStart("2026-11-02", "week")).toBe("2026-11-02");
    expect(bucketStart("2026-11-08", "week")).toBe("2026-11-02");
    expect(bucketStart("2026-11-19", "month")).toBe("2026-11-01");
    expect(reportBuckets("2025-11-15", "2026-02-03", "month")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(reportBuckets("2026-11-04", "2026-11-17", "week")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(reportBuckets("2026-12-30", "2027-01-02", "day")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("works out the quick ranges in Bangkok time, including January", () => {
    expect(reportPresetRange("this-month", JAN_15)).toEqual({ from: "2026-01-01", to: "2026-01-15" });
    expect(reportPresetRange("last-month", JAN_15)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(reportPresetRange("last-3-months", JAN_15)).toEqual({ from: "2025-11-01", to: "2026-01-15" });
    expect(reportPresetRange("this-year", JAN_15)).toEqual({ from: "2026-01-01", to: "2026-01-15" });
    // 23:30 on 31 Dec UTC is already 1 Jan in Bangkok.
    expect(reportPresetRange("this-month", new Date("2025-12-31T17:30:00.000Z"))).toEqual({ from: "2026-01-01", to: "2026-01-01" });
  });

  it("recognises a range that matches a quick button", () => {
    expect(matchReportPreset({ from: "2025-12-01", to: "2025-12-31" }, JAN_15)).toBe("last-month");
    expect(matchReportPreset({ from: "2025-12-02", to: "2025-12-31" }, JAN_15)).toBeNull();
  });

  it("names CSV files after the range", () => {
    expect(reportCsvFilename("work-orders", { from: "2026-10-01", to: "2026-10-31" })).toBe("motormate-work-orders-2026-10-01_2026-10-31.csv");
  });
});

describe("report CSV", () => {
  it("quotes commas, quotes and line breaks, and keeps Thai text", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("Lee, Jordan")).toBe('"Lee, Jordan"');
    expect(csvCell('5" tyre')).toBe('"5"" tyre"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("กรุงเทพมหานคร")).toBe("กรุงเทพมหานคร");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("stops Excel from running cells as formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+66812345678")).toBe("'+66812345678");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("a=b")).toBe("a=b");
  });

  it("writes a BOM and Windows line endings", () => {
    expect(toCsv(["A", "B"], [["1", null], ["x,y", 2]])).toBe('﻿A,B\r\n1,\r\n"x,y",2\r\n');
    expect(csvMoney(1070)).toBe("1070.00");
    expect(csvMoney(0.5)).toBe("0.50");
  });
});

describe("report arithmetic", () => {
  it("covers whole Bangkok days", () => {
    expect(reportPeriod({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      gte: new Date("2026-09-30T17:00:00.000Z"),
      lt: new Date("2026-10-31T17:00:00.000Z"),
    });
  });

  it("fills empty buckets with zero and rounds totals", () => {
    expect(fillSeries(["2026-10-01", "2026-10-02", "2026-10-03"], [{ start: "2026-10-02", total: "107.25", count: 2 }])).toEqual([
      { start: "2026-10-01", total: 0, count: 0 },
      { start: "2026-10-02", total: 107.25, count: 2 },
      { start: "2026-10-03", total: 0, count: 0 },
    ]);
  });

  it("works out the no-show rate only when appointments were due", () => {
    expect(noShowRate(0, 0, 0)).toBeNull();
    expect(noShowRate(8, 1, 1)).toBe(0.1);
  });

  it("ranks parts with stable tie-breaks", () => {
    const rows = [
      { id: "a", sku: "A", name: "Wiper", quantity: 2, revenue: 500 },
      { id: "b", sku: "B", name: "Oil", quantity: 5, revenue: 500 },
      { id: "c", sku: "C", name: "Bulb", quantity: 5, revenue: 100 },
    ];
    const { topByQuantity, topByRevenue } = topParts(rows);
    expect(topByQuantity.map((row) => row.id)).toEqual(["b", "c", "a"]);
    expect(topByRevenue.map((row) => row.id)).toEqual(["b", "a", "c"]);
  });
});
