import Link from "next/link";
import { Pencil } from "lucide-react";
import {
  formatWorkOrderNumber,
  type InventoryItemDetail,
  type StockMovementEntry,
  type StockMovementReason,
} from "@motormate/types";
import { ReceiveStock, Stocktake } from "@/components/inventory/stock-dialogs";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatDateTime, formatTHB } from "@/lib/format";
import { requireSession, serverGet } from "@/lib/server";

const REASON_LABEL: Record<StockMovementReason, string> = {
  PURCHASE: "Received",
  ADJUSTMENT: "Stocktake",
  WORK_ORDER: "Work order",
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-lg font-semibold">{children}</div>
    </Card>
  );
}

function MovementNote({ movement }: { movement: StockMovementEntry }) {
  if (movement.workOrder) {
    return (
      <Link href={`/app/work-orders/${movement.workOrder.id}`} className="text-blue-700 hover:underline">
        {formatWorkOrderNumber(movement.workOrder.number)} →
      </Link>
    );
  }
  return <>{movement.note ?? <span className="text-slate-400">—</span>}</>;
}

export default async function InventoryItemPage({ params }: { params: { id: string } }) {
  const { user } = await requireSession();
  const item = await serverGet<InventoryItemDetail>(`/inventory/${params.id}`);
  const canManage = user.role === "ADMIN" || user.role === "ADVISOR";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={
          <>
            {item.name}
            {!item.isActive && <span className="ml-2 align-middle"><Badge>Deactivated</Badge></span>}
          </>
        }
        back={{ href: "/app/inventory", label: "Inventory" }}
        subtitle={
          <>
            <span className="font-mono">{item.sku}</span> · {item.category}
            {item.supplier && <> · Supplier: {item.supplier}</>}
          </>
        }
        actions={
          canManage ? (
            <>
              <ReceiveStock itemId={item.id} onHand={item.quantityOnHand} disabled={!item.isActive} />
              <Stocktake itemId={item.id} onHand={item.quantityOnHand} />
              <LinkButton href={`/app/inventory/${item.id}/edit`} variant="secondary">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </LinkButton>
            </>
          ) : undefined
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="On hand">
          <span className={item.isLowStock ? "text-red-700" : ""}>{item.quantityOnHand}</span>
          {item.isLowStock && <span className="ml-2 align-middle"><Badge tone="red">Low</Badge></span>}
        </Stat>
        <Stat label="Reorder at">{item.reorderLevel}</Stat>
        <Stat label="Cost (excl. VAT)">{formatTHB(item.unitCost)}</Stat>
        <Stat label="Price (excl. VAT)">{formatTHB(item.unitPrice)}</Stat>
      </div>

      <h2 className="mb-3 text-base font-semibold">Stock history</h2>
      {item.movements.length === 0 ? (
        <EmptyState title="No stock changes yet" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-right">Change</th>
                <th className="px-4 py-3">Note / work order</th>
                <th className="px-4 py-3">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {item.movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(movement.createdAt)}</td>
                  <td className="px-4 py-3">{REASON_LABEL[movement.reason]}</td>
                  <td className={`px-4 py-3 text-right font-medium ${movement.quantityChange < 0 ? "text-red-700" : "text-green-700"}`}>
                    {movement.quantityChange > 0 ? "+" : ""}
                    {movement.quantityChange}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <MovementNote movement={movement} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{movement.createdBy.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {item.movements.length >= 50 && <p className="mt-2 text-xs text-slate-500">Showing the 50 most recent changes.</p>}
    </div>
  );
}
