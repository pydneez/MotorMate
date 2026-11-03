"use client";

import { REPORT_PRESET_LABEL, reportPresetRange, type ReportPreset, type ReportQuery } from "@motormate/types";
import { buttonClasses } from "@/components/ui";
import { filterYears, MONTH_NAMES, monthSpan, yearMonthOf } from "@/lib/date-range";

const PRESETS = Object.keys(REPORT_PRESET_LABEL) as ReportPreset[];

export function ReportRange({
  range,
  active,
  loading,
  onChange,
}: {
  range: ReportQuery;
  active: ReportPreset | null;
  loading: boolean;
  onChange: (range: ReportQuery) => void;
}) {
  // Custom ranges are whole months: from the 1st of the start month to the end of the end
  // month. An old link with exact days still loads; the dropdowns just show its months.
  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => Number(form.get(key));
    onChange(monthSpan({ year: read("fromYear"), month: read("fromMonth") }, { year: read("toYear"), month: read("toMonth") }));
  }

  const start = yearMonthOf(range.from);
  const end = yearMonthOf(range.to);
  // Keep an older year from a link selectable even if it's before the usual list.
  const years = [...new Set([...filterYears(), start.year, end.year])].sort((a, b) => b - a);
  const selectClass = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const monthYear = (prefix: "from" | "to", value: { year: number; month: number }) => (
    <>
      <select name={`${prefix}Month`} defaultValue={value.month} aria-label={`${prefix === "from" ? "From" : "To"} month`} className={selectClass}>
        {MONTH_NAMES.map((name, index) => (
          <option key={name} value={index + 1}>
            {name.slice(0, 3)}
          </option>
        ))}
      </select>
      <select name={`${prefix}Year`} defaultValue={value.year} aria-label={`${prefix === "from" ? "From" : "To"} year`} className={selectClass}>
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </>
  );

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="inline-flex flex-wrap rounded-md border border-slate-300 bg-white p-0.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={loading}
            onClick={() => onChange(reportPresetRange(preset))}
            aria-pressed={active === preset}
            className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-wait ${
              active === preset ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {REPORT_PRESET_LABEL[preset]}
          </button>
        ))}
      </div>
      <form key={`${range.from}_${range.to}`} onSubmit={apply} className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm text-slate-700">From {monthYear("from", start)}</span>
        <span className="flex items-center gap-2 text-sm text-slate-700">To {monthYear("to", end)}</span>
        <button type="submit" disabled={loading} className={buttonClasses("secondary", "py-1.5")}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </form>
    </div>
  );
}