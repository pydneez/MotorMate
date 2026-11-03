import Link from "next/link";
import { formatInvoiceNumber, formatWorkOrderNumber, type Paginated, type VisitSummary } from "@motormate/types";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { Card, EmptyState } from "@/components/ui";
import { WorkOrderStatusBadge } from "@/components/work-orders/status-badge";
import { formatDate, formatTHB } from "@/lib/format";

/**
 * Staff customer page: every job across the customer's vehicles, newest first, with links to
 * the work order and invoice. Paged with ?visits=N so it doesn't clash with other params.
 */
export function CustomerVisits({ customerId, data }: { customerId: string; data: Paginated<VisitSummary> }) {
  const { page, pageSize, total } = data;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const href = (target: number) => (target > 1 ? `/app/customers/${customerId}?visits=${target}` : `/app/customers/${customerId}`);
  const pageLink = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50";
  const pageOff = "rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-300";

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-base font-semibold">Visits ({total})</h2>
      <Card className="overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No visits yet">Jobs appear here once one of this customer&apos;s vehicles is checked in.</EmptyState>
          </div>
        ) : (
          <>
            <table className="hidden w-full text-sm lg:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3">Checked in</th>
                  <th className="px-3 py-3">Job</th>
                  <th className="px-3 py-3">Vehicle</th>
                  <th className="px-3 py-3">Complaint</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((visit) => (
                  <tr key={visit.workOrderId} className="align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-3">{formatDate(visit.checkedInAt)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <Link href={`/app/work-orders/${visit.workOrderId}`} className="font-medium text-blue-700 hover:underline">
                        {formatWorkOrderNumber(visit.number)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <Link href={`/app/vehicles/${visit.vehicle.id}`} className="hover:underline">
                        {visit.vehicle.plate}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {visit.vehicle.make} {visit.vehicle.model}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{visit.complaint}</td>
                    <td className="px-3 py-3">
                      <WorkOrderStatusBadge status={visit.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <VisitInvoice visit={visit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 lg:hidden">
              {data.items.map((visit) => (
                <li key={visit.workOrderId} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/app/work-orders/${visit.workOrderId}`} className="font-medium text-blue-700 hover:underline">
                      {formatWorkOrderNumber(visit.number)}
                    </Link>
                    <WorkOrderStatusBadge status={visit.status} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {formatDate(visit.checkedInAt)} · {visit.vehicle.plate} {visit.vehicle.make} {visit.vehicle.model}
                  </p>
                  <p className="text-slate-700">{visit.complaint}</p>
                  <VisitInvoice visit={visit} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {lastPage > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {lastPage}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={href(page - 1)} scroll={false} className={pageLink}>
                ‹ Newer
              </Link>
            ) : (
              <span className={pageOff}>‹ Newer</span>
            )}
            {page < lastPage ? (
              <Link href={href(page + 1)} scroll={false} className={pageLink}>
                Older ›
              </Link>
            ) : (
              <span className={pageOff}>Older ›</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function VisitInvoice({ visit }: { visit: VisitSummary }) {
  if (!visit.invoice) return <span className="text-xs text-slate-400">Not invoiced yet</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="whitespace-nowrap">
        <Link href={`/app/invoices/${visit.invoice.id}`} className="font-medium text-blue-700 hover:underline">
          {formatInvoiceNumber(visit.invoice.number)}
        </Link>{" "}
        {formatTHB(visit.invoice.total)}
      </span>
      <InvoiceStatusBadge status={visit.invoice.status} />
    </span>
  );
}
