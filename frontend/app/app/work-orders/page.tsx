import Link from "next/link";
import { Plus } from "lucide-react";
import { formatWorkOrderNumber, type MechanicOption, type Paginated, type WorkOrderSummary } from "@motormate/types";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { WorkOrderStatusBadge } from "@/components/work-orders/status-badge";
import { WorkOrderFilters } from "@/components/work-orders/work-order-filters";
import { formatDate } from "@/lib/format";
import { queryString, requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

export default async function WorkOrdersPage({ searchParams }: Props) {
  const { user } = await requireSession();
  const isMechanic = user.role === "MECHANIC";
  const isStaff = user.role === "ADMIN" || user.role === "ADVISOR";

  // Mechanics see their own jobs unless they untick "Assigned to me" (mechanic=all).
  const mechanicParam = typeof searchParams.mechanic === "string" ? searchParams.mechanic : undefined;
  const mechanic = isMechanic ? (mechanicParam === "all" ? undefined : "me") : mechanicParam;
  const status = typeof searchParams.status === "string" ? searchParams.status : "open";

  const [data, mechanics] = await Promise.all([
    serverGet<Paginated<WorkOrderSummary>>(
      `/work-orders${queryString({ q: searchParams.q, status, mechanic, page: searchParams.page })}`,
    ),
    isStaff ? serverGet<MechanicOption[]>("/work-orders/mechanics") : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Work orders"
        actions={
          isStaff ? (
            <LinkButton href="/app/work-orders/new">
              <Plus className="h-4 w-4" aria-hidden /> Check in vehicle
            </LinkButton>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-4">
        <WorkOrderFilters mechanics={mechanics} isMechanic={isMechanic} />
        <SearchBox placeholder="Search WO number, plate, VIN or customer…" />
      </div>

      <Card className="mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No work orders here">
              {status === "open" && isMechanic && mechanic === "me" ? "Nothing is assigned to you right now." : "Try another tab or search."}
            </EmptyState>
          </div>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Job</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Mechanic</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Checked in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((wo) => (
                  <tr key={wo.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/app/work-orders/${wo.id}`} className="font-medium text-blue-700 hover:underline">
                        {formatWorkOrderNumber(wo.number)}
                      </Link>
                      <p className="max-w-[16rem] truncate text-xs text-slate-500">{wo.complaint}</p>
                    </td>
                    <td className="px-4 py-3">
                      {wo.vehicle.plate} <span className="text-slate-500">{wo.vehicle.province}</span>
                      <p className="text-xs text-slate-500">
                        {wo.vehicle.make} {wo.vehicle.model}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{wo.customer.name}</td>
                    <td className="px-4 py-3 text-slate-700">{wo.mechanic?.name ?? <span className="text-slate-400">Unassigned</span>}</td>
                    <td className="px-4 py-3">
                      <WorkOrderStatusBadge status={wo.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(wo.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.items.map((wo) => (
                <li key={wo.id}>
                  <Link href={`/app/work-orders/${wo.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{formatWorkOrderNumber(wo.number)}</span>
                      <WorkOrderStatusBadge status={wo.status} />
                    </div>
                    <p className="text-sm text-slate-700">
                      {wo.vehicle.plate} · {wo.vehicle.make} {wo.vehicle.model}
                    </p>
                    <p className="text-xs text-slate-500">
                      {wo.customer.name} · {wo.mechanic?.name ?? "Unassigned"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Pagination data={data} basePath="/app/work-orders" searchParams={searchParams} />
    </div>
  );
}
