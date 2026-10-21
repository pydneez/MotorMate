import Link from "next/link";
import {
  formatInvoiceNumber,
  formatWorkOrderNumber,
  isClosedStatus,
  WORK_ORDER_STATUS_LABEL,
  type MechanicOption,
  type WorkOrderDetail,
} from "@motormate/types";
import { Card, PageHeader } from "@/components/ui";
import { WorkOrderStatusBadge } from "@/components/work-orders/status-badge";
import { MechanicAssign, StatusActions } from "@/components/work-orders/work-order-actions";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { LabourSection, NotesSection, PartsSection, RecommendationsSection } from "@/components/work-orders/work-order-sections";
import { formatDateTime, formatKm, formatTHB } from "@/lib/format";
import { requireSession, serverGet } from "@/lib/server";

export default async function WorkOrderPage({ params }: { params: { id: string } }) {
  const { user } = await requireSession();
  const isStaff = user.role === "ADMIN" || user.role === "ADVISOR";
  const [workOrder, mechanics] = await Promise.all([
    serverGet<WorkOrderDetail>(`/work-orders/${params.id}`),
    isStaff ? serverGet<MechanicOption[]>("/work-orders/mechanics") : Promise.resolve([]),
  ]);
  const closed = isClosedStatus(workOrder.status);
  const canEdit = !closed && (isStaff || workOrder.mechanic?.id === user.id);
  const { vehicle, totals } = workOrder;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {formatWorkOrderNumber(workOrder.number)} <WorkOrderStatusBadge status={workOrder.status} />
          </span>
        }
        back={{ href: "/app/work-orders", label: "Work orders" }}
        subtitle={
          <>
            <Link href={`/app/vehicles/${vehicle.id}`} className="text-blue-700 hover:underline">
              {vehicle.make} {vehicle.model} {vehicle.year} · {vehicle.plate} {vehicle.province}
            </Link>
            {isStaff ? (
              <>
                {" · "}
                <Link href={`/app/customers/${workOrder.customer.id}`} className="text-blue-700 hover:underline">
                  {workOrder.customer.name}
                </Link>
              </>
            ) : (
              <> · {workOrder.customer.name}</>
            )}
          </>
        }
        actions={<StatusActions workOrder={workOrder} user={user} />}
      />

      {!closed && !canEdit && (
        <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          View only: this job is assigned to {workOrder.mechanic?.name ?? "nobody yet"}.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <Card className="p-4 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Customer&apos;s complaint</p>
            <p className="whitespace-pre-line text-slate-800">{workOrder.complaint}</p>
          </Card>
          <NotesSection workOrder={workOrder} canEdit={canEdit} />
          <LabourSection workOrder={workOrder} canEdit={canEdit} />
          <PartsSection workOrder={workOrder} canEdit={canEdit} />
          <RecommendationsSection workOrder={workOrder} canEdit={canEdit} />
        </div>

        <aside className="space-y-4">
          {workOrder.invoice && (
            <Card className="flex items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Invoice</p>
                <p className="font-medium">
                  {formatInvoiceNumber(workOrder.invoice.number)} <InvoiceStatusBadge status={workOrder.invoice.status} />
                </p>
              </div>
              {isStaff && (
                <Link href={`/app/invoices/${workOrder.invoice.id}`} className="font-medium text-blue-700 hover:underline">
                  View →
                </Link>
              )}
            </Card>
          )}
          <Card className="space-y-3 p-4 text-sm">
            {isStaff && !closed ? (
              <MechanicAssign workOrder={workOrder} mechanics={mechanics} />
            ) : (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Mechanic</p>
                <p>{workOrder.mechanic?.name ?? "Unassigned"}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Mileage at check-in</p>
              <p>{formatKm(workOrder.mileageIn)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Checked in by</p>
              <p>
                {workOrder.createdBy} · {formatDateTime(workOrder.createdAt)}
              </p>
            </div>
          </Card>

          <Card className="p-4 text-sm">
            <h3 className="mb-2 font-semibold">{workOrder.status === "COMPLETED" ? "Invoice total" : "Running total"}</h3>
            <dl className="space-y-1">
              <div className="flex justify-between"><dt className="text-slate-500">Labour</dt><dd>{formatTHB(totals.labour)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Parts</dt><dd>{formatTHB(totals.parts)}</dd></div>
              <div className="flex justify-between border-t border-slate-100 pt-1"><dt className="text-slate-500">Subtotal</dt><dd>{formatTHB(totals.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">VAT {Math.round(totals.vatRate * 100)}%</dt><dd>{formatTHB(totals.vat)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold"><dt>Total</dt><dd>{formatTHB(totals.total)}</dd></div>
            </dl>
          </Card>

          <Card className="p-4 text-sm">
            <h3 className="mb-2 font-semibold">History</h3>
            <ol className="space-y-2">
              {workOrder.history.map((entry, index) => (
                <li key={index}>
                  <p className="font-medium text-slate-800">{WORK_ORDER_STATUS_LABEL[entry.toStatus]}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(entry.createdAt)} · {entry.changedBy}
                  </p>
                  {entry.note && <p className="text-xs text-slate-600">“{entry.note}”</p>}
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}
