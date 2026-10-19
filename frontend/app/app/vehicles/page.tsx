import Link from "next/link";
import { Plus } from "lucide-react";
import type { Paginated, VehicleSummary } from "@motormate/types";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
import { formatKm, fullName } from "@/lib/format";
import { queryString, requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

export default async function VehiclesPage({ searchParams }: Props) {
  const { user } = await requireSession();
  const data = await serverGet<Paginated<VehicleSummary>>(
    `/vehicles${queryString({ q: searchParams.q, page: searchParams.page })}`,
  );

  // Customers see their own vehicles as cards.
  if (user.role === "CUSTOMER") {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="My vehicles"
          actions={
            <LinkButton href="/app/vehicles/new">
              <Plus className="h-4 w-4" aria-hidden /> Add my vehicle
            </LinkButton>
          }
        />
        {data.items.length === 0 ? (
          <EmptyState title="No vehicles yet">Add your car to see its service history and upcoming maintenance.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        )}
        <Pagination data={data} basePath="/app/vehicles" searchParams={searchParams} />
      </div>
    );
  }

  const canAdd = user.role === "ADMIN" || user.role === "ADVISOR";
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Vehicles"
        subtitle={canAdd ? "To add a vehicle, open its owner's customer page." : undefined}
        actions={
          canAdd ? (
            <LinkButton href="/app/customers" variant="secondary">
              Find owner
            </LinkButton>
          ) : undefined
        }
      />
      <SearchBox placeholder="Search plate, VIN, make, model or owner…" />
      <Card className="mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title={searchParams.q ? "No vehicles match your search" : "No vehicles yet"} />
          </div>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Plate</th>
                  <th className="px-4 py-3">Province</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3 text-right">Mileage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((vehicle) => (
                  <tr key={vehicle.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/app/vehicles/${vehicle.id}`} className="font-medium text-blue-700 hover:underline">
                        {vehicle.plate}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{vehicle.province}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {vehicle.make} {vehicle.model} {vehicle.year}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{fullName(vehicle.owner)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatKm(vehicle.mileage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.items.map((vehicle) => (
                <li key={vehicle.id}>
                  <Link href={`/app/vehicles/${vehicle.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    <p className="font-medium">
                      {vehicle.plate} <span className="font-normal text-slate-500">{vehicle.province}</span>
                    </p>
                    <p className="text-sm text-slate-600">
                      {vehicle.make} {vehicle.model} {vehicle.year} · {fullName(vehicle.owner)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Pagination data={data} basePath="/app/vehicles" searchParams={searchParams} />
    </div>
  );
}
