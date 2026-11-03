"use client";

import { REPORT_PRESET_LABEL, reportPresetRange, type ReportPreset, type ReportQuery } from "@motormate/types";
import { buttonClasses } from "@/components/ui";

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
  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onChange({ from: String(form.get("from") ?? ""), to: String(form.get("to") ?? "") });
  }

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
      <form key={`${range.from}_${range.to}`} onSubmit={apply} className="flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          From
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            required
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          To
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            required
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <button type="submit" disabled={loading} className={buttonClasses("secondary", "py-1.5")}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </form>
    </div>
  );
}