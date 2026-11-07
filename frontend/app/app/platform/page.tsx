import type { PlatformShop } from "@motormate/types";
import { ShopStatusActions } from "@/components/platform/shop-status-actions";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatThaiPhone } from "@/lib/format";
import { serverGet } from "@/lib/server";

/**
 * Platform admin only (NAV_ITEMS): every shop on MotorMate, with enough numbers to see it's
 * in use, and Suspend / Reactivate. The platform admin can't open a shop's own records.
 */
export default async function PlatformPage() {
  const shops = await serverGet<PlatformShop[]>("/platform/shops");
  const active = shops.filter((shop) => shop.isActive).length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Shops"
        subtitle={`${shops.length} registered · ${active} active. Garages register themselves; suspending one locks its staff and customers out without deleting anything.`}
      />
      {shops.length === 0 ? (
        <EmptyState title="No shops yet" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Shop</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3 text-right">Staff</th>
                <th className="px-4 py-3 text-right">Customers</th>
                <th className="px-4 py-3 text-right" title="Work orders checked in during the last 30 days">
                  Jobs (30 days)
                </th>
                <th className="px-4 py-3">Registered</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shops.map((shop) => (
                <tr key={shop.id} className={shop.isActive ? "" : "bg-slate-50"}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{shop.name}</p>
                    <p className="text-xs text-slate-500">{formatThaiPhone(shop.phone)}</p>
                  </td>
                  <td className="px-4 py-3">
                    {shop.admin ? (
                      <>
                        <p>{shop.admin.name}</p>
                        <p className="text-xs text-slate-500">{shop.admin.email}</p>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{shop.staff}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{shop.customers}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{shop.recentWorkOrders}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(shop.createdAt)}</td>
                  <td className="px-4 py-3">{shop.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Suspended</Badge>}</td>
                  <td className="px-4 py-3 text-right">
                    <ShopStatusActions shop={shop} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
