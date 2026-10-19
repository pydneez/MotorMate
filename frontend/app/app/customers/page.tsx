import Link from "next/link";
import { Plus } from "lucide-react";
import type { CustomerSummary, Paginated } from "@motormate/types";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatThaiPhone, fullName } from "@/lib/format";
import { queryString, serverGet } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

export default async function CustomersPage({ searchParams }: Props) {
  const data = await serverGet<Paginated<CustomerSummary>>(
    `/customers${queryString({ q: searchParams.q, page: searchParams.page })}`,
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Customers"
        actions={
          <LinkButton href="/app/customers/new">
            <Plus className="h-4 w-4" aria-hidden /> New customer
          </LinkButton>
        }
      />
      <SearchBox placeholder="Search name, phone, email, plate or VIN…" />

      <Card className="mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title={searchParams.q ? "No customers match your search" : "No customers yet"}>
              {searchParams.q ? "Try a phone number, plate or part of a name." : "Add the first one with “New customer”."}
            </EmptyState>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3 text-center">Vehicles</th>
                  <th className="px-4 py-3 text-center">Portal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((customer) => (
                  <tr key={customer.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/app/customers/${customer.id}`} className="font-medium text-blue-700 hover:underline">
                        {fullName(customer)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatThaiPhone(customer.phone)}</td>
                    <td className="px-4 py-3 text-slate-700">{customer.email ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 text-center">{customer.vehicleCount}</td>
                    <td className="px-4 py-3 text-center">
                      {customer.hasPortalAccount ? <Badge tone="green">Active</Badge> : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.items.map((customer) => (
                <li key={customer.id}>
                  <Link href={`/app/customers/${customer.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    <p className="font-medium text-slate-900">{fullName(customer)}</p>
                    <p className="text-sm text-slate-600">{formatThaiPhone(customer.phone)}</p>
                    <p className="text-xs text-slate-500">
                      {customer.vehicleCount} vehicle{customer.vehicleCount === 1 ? "" : "s"}
                      {customer.hasPortalAccount && " · portal account"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Pagination data={data} basePath="/app/customers" searchParams={searchParams} />
    </div>
  );
}
