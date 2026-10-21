import Link from "next/link";
import { formatInvoiceNumber, formatWorkOrderNumber, type InvoiceDetail } from "@motormate/types";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { Card, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime, formatKm, formatTHB, formatThaiPhone } from "@/lib/format";
import { requireSession, serverGet } from "@/lib/server";
import { SHOP } from "@/lib/shop";

/** The printable invoice. The app shell and buttons are hidden when printing. */
export default async function InvoicePage({ params }: { params: { id: string } }) {
  const { user } = await requireSession();
  const invoice = await serverGet<InvoiceDetail>(`/invoices/${params.id}`);
  const isStaff = user.role === "ADMIN" || user.role === "ADVISOR";
  const number = formatInvoiceNumber(invoice.number);
  const { vehicle, customer } = invoice;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="print:hidden">
        <PageHeader
          title={
            <span className="inline-flex flex-wrap items-center gap-3">
              {number} <InvoiceStatusBadge status={invoice.status} />
            </span>
          }
          back={{ href: "/app/invoices", label: isStaff ? "Invoices" : "My invoices" }}
          subtitle={
            isStaff ? (
              <Link href={`/app/work-orders/${invoice.workOrder.id}`} className="text-blue-700 hover:underline">
                {formatWorkOrderNumber(invoice.workOrder.number)} →
              </Link>
            ) : undefined
          }
          actions={<InvoiceActions invoice={invoice} canMarkPaid={isStaff} />}
        />
      </div>

      <Card className="p-6 text-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <div className="flex flex-wrap justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <p className="text-lg font-bold">{SHOP.name}</p>
            {SHOP.address.map((line) => (
              <p key={line} className="text-slate-600">{line}</p>
            ))}
            <p className="text-slate-600">Tel. {SHOP.phone} · Tax ID {SHOP.taxId}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-lg font-semibold">Invoice</p>
            <p className="font-medium">{number}</p>
            <p className="text-slate-600">Issued {formatDate(invoice.issuedAt)}</p>
            <p className="text-slate-600">Job {formatWorkOrderNumber(invoice.workOrder.number)}</p>
          </div>
        </div>

        <div className="grid gap-6 border-b border-slate-200 py-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Bill to</p>
            <p className="font-medium">{customer.name}</p>
            <p className="text-slate-600">{formatThaiPhone(customer.phone)}</p>
            {customer.email && <p className="text-slate-600">{customer.email}</p>}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Vehicle</p>
            <p className="font-medium">
              {vehicle.make} {vehicle.model} {vehicle.year}
            </p>
            <p className="text-slate-600">
              {vehicle.plate} {vehicle.province}
            </p>
            <p className="text-slate-600">VIN {vehicle.vin} · {formatKm(invoice.mileageIn)}</p>
          </div>
        </div>

        <table className="mt-6 w-full">
          <thead className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2">Description</th>
              <th className="pb-2 pl-3 text-right">Qty</th>
              <th className="pb-2 pl-3 text-right">Unit price</th>
              <th className="pb-2 pl-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.labour.map((line) => (
              <tr key={line.id}>
                <td className="py-2">
                  {line.description} <span className="text-xs text-slate-500">(labour)</span>
                </td>
                <td className="py-2 pl-3 text-right">1</td>
                <td className="py-2 pl-3 text-right">{formatTHB(line.laborCost)}</td>
                <td className="py-2 pl-3 text-right">{formatTHB(line.laborCost)}</td>
              </tr>
            ))}
            {invoice.parts.map((part) => (
              <tr key={part.id}>
                <td className="py-2">
                  {part.name} <span className="text-xs text-slate-500">{part.sku}</span>
                </td>
                <td className="py-2 pl-3 text-right">{part.quantity}</td>
                <td className="py-2 pl-3 text-right">{formatTHB(part.unitPrice)}</td>
                <td className="py-2 pl-3 text-right">{formatTHB(part.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 border-t border-slate-200 pt-3">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatTHB(invoice.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">VAT {Math.round(invoice.vatRate * 100)}%</dt><dd>{formatTHB(invoice.vat)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold"><dt>Total</dt><dd>{formatTHB(invoice.total)}</dd></div>
        </dl>

        {invoice.workPerformed && (
          <div className="mt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Work performed</p>
            <p className="whitespace-pre-line text-slate-700">{invoice.workPerformed}</p>
          </div>
        )}

        <p className="mt-8 border-t border-slate-200 pt-4 text-slate-600">
          {invoice.status === "PAID" && invoice.paidAt ? (
            <>
              <span className="font-medium text-green-700">Paid</span> {formatDateTime(invoice.paidAt)}
              {invoice.paidBy && ` · received by ${invoice.paidBy}`}
            </>
          ) : (
            <span className="font-medium text-amber-700">Unpaid — please pay at the service counter.</span>
          )}
        </p>
      </Card>
    </div>
  );
}
