import type { ReportBucket, ReportSummary } from "@motormate/types";
import { formatTHB } from "@/lib/format";

type Point = ReportSummary["revenue"]["series"][number];

function fullLabel(start: string, bucket: ReportBucket): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (bucket === "month") return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  return bucket === "week" ? `Week of ${day}` : day;
}

function axisLabel(start: string, bucket: ReportBucket): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (bucket === "day") return String(date.getUTCDate());
  if (bucket === "month") return new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

function compactTHB(amount: number): string {
  if (amount >= 1_000_000) return `฿${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `฿${(amount / 1_000).toFixed(1)}k`;
  return `฿${Math.round(amount)}`;
}

export function RevenueChart({ series, bucket }: { series: Point[]; bucket: ReportBucket }) {
  const max = Math.max(0, ...series.map((point) => point.total));
  if (max === 0) {
    return <p className="py-12 text-center text-sm text-slate-500">No invoices in this period.</p>;
  }
  const showValues = series.length <= 16;
  const monthOf = (start: string) =>
    new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${start}T00:00:00Z`));
  const firstMonth = monthOf(series[0].start);
  const lastMonth = monthOf(series[series.length - 1].start);
  const monthLabel = bucket === "day" ? (firstMonth === lastMonth ? firstMonth : `${firstMonth} – ${lastMonth}`) : null;

  return (
    <div>
      <div className="relative flex h-56 items-end gap-1 border-b border-slate-200 pt-6" aria-hidden>
        <span className="absolute left-0 top-0 text-xs text-slate-400">max {formatTHB(max)}</span>
        {series.map((point) => (
          <div key={point.start} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow group-hover:block">
              <p className="font-medium">{fullLabel(point.start, bucket)}</p>
              <p>
                {formatTHB(point.total)} · {point.count} invoice{point.count === 1 ? "" : "s"}
              </p>
            </div>
            {showValues && point.total > 0 && (
              <span className="mb-1 shrink-0 text-[10px] font-medium text-slate-600">{compactTHB(point.total)}</span>
            )}
            <div
              className="w-full shrink-0 rounded-t bg-blue-500 transition group-hover:bg-blue-700"
              style={{ height: `${(point.total / max) * 100}%`, minHeight: point.total > 0 ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1" aria-hidden>
        {series.map((point) => (
          <span key={point.start} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate-500">
            {axisLabel(point.start, bucket)}
          </span>
        ))}
      </div>
      {monthLabel && (
        <p className="mt-1 text-center text-xs text-slate-400" aria-hidden>
          {monthLabel}
        </p>
      )}
      <table className="sr-only">
        <caption>Invoiced amount by {bucket}</caption>
        <thead>
          <tr>
            <th>Period</th>
            <th>Invoiced</th>
            <th>Invoices</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.start}>
              <td>{fullLabel(point.start, bucket)}</td>
              <td>{formatTHB(point.total)}</td>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}