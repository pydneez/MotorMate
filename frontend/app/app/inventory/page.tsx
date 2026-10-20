import Link from "next/link";
import { Plus } from "lucide-react";
import type { InventoryItemSummary, Paginated } from "@motormate/types";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { InventoryFilters } from "@/components/inventory/inventory-filters";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatTHB } from "@/lib/format";
import { queryString, requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

function OnHand({ item }: { item: InventoryItemSummary }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={item.isLowStock ? "font-semibold text-red-700" : ""}>{item.quantityOnHand}</span>
      {item.isLowStock && <Badge tone="red">Low</Badge>}
    </span>
  );
}

export default async function InventoryPage({ searchParams }: Props) {
  const { user } = await requireSession();
  const canManage = user.role === "ADMIN" || user.role === "ADVISOR";
  const [data, categories] = await Promise.all([
    serverGet<Paginated<InventoryItemSummary>>(
      `/inventory${queryString({
        q: searchParams.q,
        category: searchParams.category,
        lowStock: searchParams.lowStock,
        includeInactive: searchParams.includeInactive,
        page: searchParams.page,
      })}`,
    ),
    serverGet<string[]>("/inventory/categories"),
  ]);
  const filtered = Boolean(searchParams.q || searchParams.category || searchParams.lowStock);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Inventory"
        subtitle={canManage ? "Prices exclude VAT." : "View only. Parts you use are recorded on the work order."}
        actions={
          canManage ? (
            <LinkButton href="/app/inventory/new">
              <Plus className="h-4 w-4" aria-hidden /> Add item
            </LinkButton>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-4">
        <SearchBox placeholder="Search SKU, name or supplier…" />
        <InventoryFilters categories={categories} />
      </div>

      <Card className="mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title={filtered ? "No items match these filters" : "No inventory items yet"} />
          </div>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">On hand</th>
                  <th className="px-4 py-3 text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((item) => (
                  <tr key={item.id} className={item.isActive ? "hover:bg-slate-50" : "bg-slate-50 text-slate-400"}>
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/app/inventory/${item.id}`} className="font-medium text-blue-700 hover:underline">
                        {item.sku}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {item.name}
                      {!item.isActive && <span className="ml-2"><Badge>Deactivated</Badge></span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.category}</td>
                    <td className="px-4 py-3 text-right">
                      <OnHand item={item} />
                    </td>
                    <td className="px-4 py-3 text-right">{formatTHB(item.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.items.map((item) => (
                <li key={item.id}>
                  <Link href={`/app/inventory/${item.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="block font-medium">{item.name}</span>
                      <span className="block font-mono text-xs text-slate-500">
                        {item.sku} · {item.category}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm">
                      <OnHand item={item} />
                      <span className="block text-xs text-slate-500">{formatTHB(item.unitPrice)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Pagination data={data} basePath="/app/inventory" searchParams={searchParams} />
    </div>
  );
}
