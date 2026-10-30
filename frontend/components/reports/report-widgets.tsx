import Link from "next/link";
import type { ReportPartRow } from "@motormate/types";
import { Card, EmptyState } from "@/components/ui";
import { formatTHB } from "@/lib/format";

export const BUCKET_LABEL = { day: "day", week: "week", month: "month" } as const;

export function formatDuration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

export function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function Tile({ label, value, note, href, tone }: { label: string; value: string; note?: string; href?: string; tone?: "amber" }) {
  const body = (
    <>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone === "amber" ? "text-amber-700" : "text-slate-900"}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </>
  );
  const className = "block rounded-lg border border-slate-200 bg-white p-5 shadow-sm";
  return href ? (
    <Link href={href} className={`${className} transition hover:border-blue-300 hover:shadow`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside && <div className="text-sm text-slate-500">{aside}</div>}
      </div>
      {children}
    </Card>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export function PartsTable({ rows }: { rows: ReportPartRow[] }) {
  if (rows.length === 0) return <EmptyState title="No parts used in this period" />;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
        <tr>
          <th className="pb-2">Part</th>
          <th className="pb-2 text-right">Qty</th>
          <th className="pb-2 text-right">Revenue</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((part) => (
          <tr key={part.id}>
            <td className="py-2">
              <Link href={`/app/inventory/${part.id}`} className="font-medium text-blue-700 hover:underline">
                {part.name}
              </Link>
              <p className="text-xs text-slate-500">{part.sku}</p>
            </td>
            <td className="py-2 text-right">{part.quantity}</td>
            <td className="py-2 text-right">{formatTHB(part.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}