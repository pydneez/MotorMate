"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DateRangeQuerySchema, reportPresetRange, type ReportPreset } from "@motormate/types";
import { buttonClasses } from "@/components/ui";

const PRESETS: { preset: ReportPreset; label: string }[] = [
  { preset: "this-month", label: "This month" },
  { preset: "last-month", label: "Last month" },
];

/**
 * "Issued: [This month][Last month][All time]  From [ ] To [ ] [Apply]" for a list page.
 * Writes ?from=&to= to the URL (Bangkok days), keeps the other filters, and goes back to page 1.
 */
export function DateRangeFilter({ label, range }: { label: string; range: { from?: string; to?: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  // The range the page actually used (invalid URL dates are already dropped).
  const from = range.from ?? "";
  const to = range.to ?? "";

  function apply(range: { from?: string; to?: string }) {
    const parsed = DateRangeQuerySchema.safeParse(range);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["from", "to"] as const) {
      const value = parsed.data[key];
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    apply({ from: String(form.get("from") ?? ""), to: String(form.get("to") ?? "") });
  }

  const buttonClass = (active: boolean) =>
    `rounded px-3 py-1.5 text-sm font-medium ${active ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`;
  const ranges = PRESETS.map((item) => ({ ...item, range: reportPresetRange(item.preset) }));
  const allTime = !from && !to;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="inline-flex flex-wrap rounded-md border border-slate-300 bg-white p-0.5">
        {ranges.map(({ preset, label: text, range }) => (
          <button
            key={preset}
            type="button"
            onClick={() => apply(range)}
            aria-pressed={range.from === from && range.to === to}
            className={buttonClass(range.from === from && range.to === to)}
          >
            {text}
          </button>
        ))}
        <button type="button" onClick={() => apply({})} aria-pressed={allTime} className={buttonClass(allTime)}>
          All time
        </button>
      </div>
      <form key={`${from}_${to}`} onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          From
          <input type="date" name="from" defaultValue={from} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          To
          <input type="date" name="to" defaultValue={to} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" />
        </label>
        <button type="submit" className={buttonClasses("secondary", "py-1.5")}>
          Apply
        </button>
      </form>
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
