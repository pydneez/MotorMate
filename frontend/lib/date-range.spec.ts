import { filterYears, monthSpan, monthYearRange, previousMonth, readMonthYear, yearMonthOf } from "./date-range";

// 3 Nov 2026, 10:00 in Bangkok.
const NOW = new Date("2026-11-03T03:00:00.000Z");

describe("month/year list filter", () => {
  it("lists this year back to 2022, newest first, using the Bangkok year", () => {
    expect(filterYears(NOW)).toEqual([2026, 2025, 2024, 2023, 2022]);
    // 23:30 on 31 Dec UTC is already New Year in Bangkok.
    expect(filterYears(new Date("2026-12-31T17:30:00.000Z"))[0]).toBe(2027);
  });

  it("turns a month or a whole year into inclusive days", () => {
    expect(monthYearRange({ year: 2026, month: 10 })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthYearRange({ year: 2024, month: 2 })).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthYearRange({ year: 2026, month: 12 })).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthYearRange({ year: 2025 })).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(monthYearRange({})).toEqual({});
  });

  it("spans whole months for the Reports range, across years", () => {
    expect(monthSpan({ year: 2026, month: 7 }, { year: 2026, month: 9 })).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(monthSpan({ year: 2025, month: 11 }, { year: 2026, month: 2 })).toEqual({ from: "2025-11-01", to: "2026-02-28" });
    expect(monthSpan({ year: 2026, month: 10 }, { year: 2026, month: 10 })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(yearMonthOf("2026-10-03")).toEqual({ year: 2026, month: 10 });
  });

  it("steps back a month across the year end", () => {
    expect(previousMonth({ year: 2026, month: 11 })).toEqual({ year: 2026, month: 10 });
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
  });

  it("reads ?year=&month= from the URL", () => {
    expect(readMonthYear({}, NOW)).toEqual({ error: null });
    expect(readMonthYear({ year: "2026", month: "10" }, NOW)).toEqual({ year: 2026, month: 10, from: "2026-10-01", to: "2026-10-31", error: null });
    expect(readMonthYear({ year: "2025" }, NOW)).toEqual({ year: 2025, month: undefined, from: "2025-01-01", to: "2025-12-31", error: null });
  });

  it("drops values that aren't on the dropdowns, with a message", () => {
    expect(readMonthYear({ year: "2026", month: "13" }, NOW)).toEqual({ error: "Choose a month from the list — showing all dates." });
    expect(readMonthYear({ year: "2019" }, NOW)).toEqual({ error: "Choose a year from the list — showing all dates." });
    expect(readMonthYear({ month: "10" }, NOW)).toEqual({ error: "Choose a year from the list — showing all dates." });
    expect(readMonthYear({ year: "abc" }, NOW).error).toContain("year");
  });
});
