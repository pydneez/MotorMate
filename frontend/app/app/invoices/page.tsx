import Link from "next/link";
import { formatInvoiceNumber, formatWorkOrderNumber, type InvoiceSummary, type Paginated } from "@motormate/types";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatTHB } from "@/lib/format";
import { queryString, requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

const TABS = [
  { value: undefined, label: "All" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PAID", label: "Paid" },
] as const;

/** Staff: every invoice, with Unpaid/Paid tabs and search. Customers: their own invoices. */
export default async function InvoicesPage({ searchParams }: Props) {
  const { user } = await requireSession();
  const isCustomer = user.role === "CUSTOMER";
  const status = searchParams.status === "UNPAID" || searchParams.status === "PAID" ? searchParams.status : undefined;
  const data = await serverGet<Paginated<InvoiceSummary>>(
    `/invoices${queryString({ q: searchParams.q, status, page: searchParams.page })}`,
  );
  const q = typeof searchParams.q === "string" ? searchParams.q : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={isCustomer ? "My invoices" : "Invoices"} />
      {!isCustomer && (
        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
            {TABS.map((tab) => (
              <Link
                key={tab.label}
                href={`/app/invoices${queryString({ q, status: tab.value })}`}
                aria-current={status === tab.value ? "page" : undefined}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  status === tab.value ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <SearchBox placeholder="Search INV/WO number, plate, car or customer…" />
        </div>
      )}

      <Card className="mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No invoices here">
              {isCustomer ? "Invoices appear here after each completed visit." : "Invoices are issued when a work order is completed."}
            </EmptyState>
          </div>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Vehicle</th>
                  {!isCustomer && <th className="px-4 py-3">Customer</th>}
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/app/invoices/${invoice.id}`} className="font-medium text-blue-700 hover:underline">
                        {formatInvoiceNumber(invoice.number)}
                      </Link>
                      <p className="text-xs text-slate-500">{formatWorkOrderNumber(invoice.workOrder.number)}</p>
                    </td>
                    <td className="px-4 py-3">
                      {invoice.vehicle.plate} <span className="text-slate-500">{invoice.vehicle.province}</span>
                      <p className="text-xs text-slate-500">
                        {invoice.vehicle.make} {invoice.vehicle.model}
                      </p>
                    </td>
                    {!isCustomer && <td className="px-4 py-3 text-slate-700">{invoice.customer.name}</td>}
                    <td className="px-4 py-3 text-slate-600">{formatDate(invoice.issuedAt)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatTHB(invoice.total)}</td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge status={invoice.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.items.map((invoice) => (
                <li key={invoice.id}>
                  <Link href={`/app/invoices/${invoice.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{formatInvoiceNumber(invoice.number)}</span>
                      <InvoiceStatusBadge status={invoice.status} />
                    </div>
                    <p className="text-sm text-slate-700">
                      {invoice.vehicle.plate} · {invoice.vehicle.make} {invoice.vehicle.model}
                    </p>
                    <p className="text-xs text-slate-500">
                      {!isCustomer && `${invoice.customer.name} · `}
                      {formatDate(invoice.issuedAt)} · {formatTHB(invoice.total)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Pagination data={data} basePath="/app/invoices" searchParams={searchParams} />
    </div>
  );
}
