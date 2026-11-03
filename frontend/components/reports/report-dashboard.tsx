"use client";

import { useState } from "react";
import Link from "next/link";
import {
  matchReportPreset,
  ReportQuerySchema,
  WORK_ORDER_STATUS_LABEL,
  type OpenWorkOrderStatus,
  type ReportQuery,
  type ReportSummary,
} from "@motormate/types";
import { CsvDownloads } from "@/components/reports/csv-downloads";
import { ReportRange } from "@/components/reports/report-range";
import { BUCKET_LABEL, formatDuration, formatPercent, PartsTable, Section, Stat, Tile } from "@/components/reports/report-widgets";
import { RevenueChart } from "@/components/reports/revenue-chart";
import { Alert, EmptyState } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/client";
import { formatDate, formatTHB } from "@/lib/format";

export function ReportDashboard({
  basePath,
  initialRange,
  initialReport,
  initialError,
}: {
  basePath: string;
  initialRange: ReportQuery;
  initialReport: ReportSummary | null;
  initialError: string | null;
}) {
  const api = useApi();
  const [range, setRange] = useState(initialRange);
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  async function load(next: ReportQuery) {
    const parsed = ReportQuerySchema.safeParse(next);
    if (!parsed.success) {
      setError(Object.values(parsed.error.flatten().fieldErrors).flat()[0] ?? "Choose a valid date range");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api<ReportSummary>(`/reports/summary?from=${parsed.data.from}&to=${parsed.data.to}`);
      setRange(parsed.data);
      setReport(data);
      window.history.replaceState(null, "", `${basePath}?from=${parsed.data.from}&to=${parsed.data.to}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const header = (
    <ReportRange range={range} active={matchReportPreset(range)} loading={loading} onChange={load} />
  );

  if (!report) {
    return (
      <div className="space-y-4">
        {header}
        <Alert tone="warning">{error ?? "The report couldn't be loaded right now. Please try again in a moment."}</Alert>
      </div>
    );
  }

  const { revenue, jobs, parts, bookings } = report;
  const openJobs = Object.values(jobs.openByStatus).reduce((sum, count) => sum + count, 0);

  return (
    <div className={`space-y-6 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
      <div>
        {header}
        <p className="mt-2 text-sm text-slate-500">
          {formatDate(`${range.from}T00:00:00+07:00`)} – {formatDate(`${range.to}T00:00:00+07:00`)} · {report.range.days} day
          {report.range.days === 1 ? "" : "s"}
        </p>
      </div>
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Invoiced"
          value={formatTHB(revenue.total)}
          note={`${formatTHB(revenue.subtotal)} excl. VAT · ${revenue.invoiceCount} invoice${revenue.invoiceCount === 1 ? "" : "s"}`}
        />
        <Tile label="Paid" value={formatTHB(revenue.paid.total)} note={`${revenue.paid.count} paid`} href="/app/invoices?status=PAID" />
        <Tile
          label="Unpaid"
          value={formatTHB(revenue.unpaid.total)}
          note={`${revenue.unpaid.count} waiting for payment`}
          href="/app/invoices?status=UNPAID"
          tone={revenue.unpaid.count > 0 ? "amber" : undefined}
        />
        <Tile
          label="Jobs completed"
          value={String(jobs.completed)}
          note={`avg ${formatDuration(jobs.averageHoursToComplete)} · ${jobs.cancelled} cancelled`}
        />
      </div>

      <Section
        title={`Revenue by ${BUCKET_LABEL[report.range.bucket]}`}
        aside={`Labour ${formatTHB(revenue.labour)} · Parts ${formatTHB(revenue.parts)} · VAT ${formatTHB(revenue.vat)}`}
      >
        <RevenueChart series={revenue.series} bucket={report.range.bucket} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Mechanics" aside="Jobs completed in this period">
          {jobs.mechanics.length === 0 ? (
            <EmptyState title="No completed jobs with a mechanic" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2">Mechanic</th>
                  <th className="pb-2 text-right">Jobs</th>
                  <th className="pb-2 text-right">Labour billed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.mechanics.map((mechanic) => (
                  <tr key={mechanic.id}>
                    <td className="py-2 font-medium">{mechanic.name}</td>
                    <td className="py-2 text-right">{mechanic.completed}</td>
                    <td className="py-2 text-right">{formatTHB(mechanic.labour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Bookings" aside="Appointments in this period">
          <dl className="divide-y divide-slate-100">
            <Stat label="Booked" value={bookings.total} />
            <Stat label="Completed" value={bookings.completed} />
            <Stat label="No-show" value={`${bookings.noShow} (${formatPercent(bookings.noShowRate)})`} />
            <Stat label="Cancelled" value={bookings.cancelled} />
            <Stat label="New customers" value={bookings.newCustomers} />
            <Stat
              label="Repeat customers"
              value={`${bookings.repeatCustomers} of ${bookings.servedCustomers} served (${formatPercent(bookings.repeatRate)})`}
            />
            <Stat label="Reminder emails sent" value={bookings.remindersSent} />
          </dl>
        </Section>

        <Section title="Top parts by revenue">
          <PartsTable rows={parts.topByRevenue} />
        </Section>

        <Section title="Top parts by quantity">
          <PartsTable rows={parts.topByQuantity} />
        </Section>
      </div>

      <Section title="Right now" aside="Not limited to the dates above">
        <div className="grid gap-6 md:grid-cols-2">
          <dl className="divide-y divide-slate-100">
            <Stat
              label="Open jobs"
              value={
                <Link href="/app/work-orders" className="text-blue-700 hover:underline">
                  {openJobs}
                </Link>
              }
            />
            {(Object.entries(jobs.openByStatus) as [OpenWorkOrderStatus, number][]).map(([status, count]) => (
              <Stat key={status} label={`· ${WORK_ORDER_STATUS_LABEL[status]}`} value={count} />
            ))}
          </dl>
          <dl className="divide-y divide-slate-100">
            <Stat
              label="Low-stock parts"
              value={
                <Link href="/app/inventory?lowStock=true" className={parts.lowStockCount > 0 ? "text-red-700 hover:underline" : "text-blue-700 hover:underline"}>
                  {parts.lowStockCount}
                </Link>
              }
            />
            <Stat label="Stock value at cost" value={formatTHB(parts.stockValueAtCost)} />
          </dl>
        </div>
      </Section>

      <Section title="Download CSV" aside="Opens in Excel, Thai text included">
        <CsvDownloads range={range} />
      </Section>
    </div>
  );
}