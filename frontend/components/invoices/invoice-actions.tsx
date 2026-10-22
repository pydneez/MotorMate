"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, FileDown, Printer } from "lucide-react";
import { formatInvoiceNumber, type InvoiceDetail, type InvoicePdfLink } from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useApi, useFormSubmit } from "@/lib/client";
import { formatTHB } from "@/lib/format";

/**
 * Download PDF and Print (everyone who can see the invoice), and Mark as paid (staff,
 * unpaid invoices only, with a confirmation).
 */
export function InvoiceActions({ invoice, canMarkPaid }: { invoice: InvoiceDetail; canMarkPaid: boolean }) {
  const router = useRouter();
  const callApi = useApi();
  const { error, submitting, submit } = useFormSubmit();
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  /** The API returns a short-lived link (presigned S3 on AWS, inline locally); open it as a download. */
  async function downloadPdf() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const { url, filename } = await callApi<InvoicePdfLink>(`/invoices/${invoice.id}/pdf`);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : "Couldn't prepare the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function markPaid() {
    if (await submit(() => callApi(`/invoices/${invoice.id}/pay`, { method: "POST" }))) {
      setConfirming(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button variant="secondary" onClick={downloadPdf} loading={downloading}>
        <FileDown className="h-4 w-4" aria-hidden /> Download PDF
      </Button>
      <Button variant="secondary" onClick={() => window.print()}>
        <Printer className="h-4 w-4" aria-hidden /> Print
      </Button>
      {canMarkPaid && invoice.status === "UNPAID" && (
        <Button onClick={() => setConfirming(true)}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Mark as paid
        </Button>
      )}
      {downloadError && (
        <p role="alert" className="w-full text-sm text-red-700">
          {downloadError}
        </p>
      )}
      <Modal open={confirming} title="Mark as paid?" onClose={() => setConfirming(false)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            Record that {invoice.customer.name} paid {formatTHB(invoice.total)} for {formatInvoiceNumber(invoice.number)}. This
            can&apos;t be undone.
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button onClick={markPaid} loading={submitting}>
              Mark as paid
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
