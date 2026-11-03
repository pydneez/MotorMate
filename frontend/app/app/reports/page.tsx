import { reportPresetRange, ReportQuerySchema, type ReportQuery, type ReportSummary } from "@motormate/types";
import { ReportDashboard } from "@/components/reports/report-dashboard";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

/** Admin only (sidebar + middleware; the API also returns 403). The range lives in ?from=&to=. */
export default async function ReportsPage({ searchParams }: Props) {
  const session = await requireSession();
  const requested = ReportQuerySchema.safeParse({ from: searchParams.from, to: searchParams.to });
  const hasRequest = searchParams.from !== undefined || searchParams.to !== undefined;
  const range: ReportQuery = requested.success ? requested.data : reportPresetRange("this-month");
  const rangeError = hasRequest && !requested.success ? Object.values(requested.error.flatten().fieldErrors).flat()[0] : null;
  const report = await api<ReportSummary>(`/reports/summary?from=${range.from}&to=${range.to}`, { token: session.accessToken }).catch(() => null);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle="Shop performance for any period" />
      <ReportDashboard
        key={`${range.from}_${range.to}`}
        basePath="/app/reports"
        initialRange={range}
        initialReport={report}
        initialError={rangeError ? `${rangeError} — showing this month instead.` : null}
      />
    </div>
  );
}
