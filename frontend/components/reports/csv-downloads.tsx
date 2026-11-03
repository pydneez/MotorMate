"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Download } from "lucide-react";
import { REPORT_EXPORTS, REPORT_EXPORT_LABEL, reportCsvFilename, type ReportExport, type ReportQuery } from "@motormate/types";
import { Alert, Button } from "@/components/ui";
import { apiBaseUrl } from "@/lib/api";

export function CsvDownloads({ range }: { range: ReportQuery }) {
  const { data: session } = useSession();
  const [busy, setBusy] = useState<ReportExport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(kind: ReportExport) {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl()}/reports/export/${kind}?from=${range.from}&to=${range.to}`, {
        headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {},
        cache: "no-store",
      });
      if (!response.ok) {
        setError(response.status === 403 ? "You don't have permission to download this." : "Couldn't create the file. Please try again.");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = reportCsvFilename(kind, range);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Can't reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {REPORT_EXPORTS.map((kind) => (
          <Button key={kind} variant="secondary" loading={busy === kind} disabled={busy !== null} onClick={() => download(kind)}>
            <Download className="h-4 w-4" aria-hidden />
            {REPORT_EXPORT_LABEL[kind]}
          </Button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}