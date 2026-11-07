import type { MyShop, ShopOption } from "@motormate/types";
import { ShopLinkButton } from "@/components/shops/shop-link-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatThaiPhone } from "@/lib/format";
import { serverGet } from "@/lib/server";

/**
 * Customers: the shops on MotorMate. Each shop keeps its own records of you (vehicles,
 * visits, invoices); linking one lets you book there and see its history.
 */
export default async function MyShopsPage() {
  const [mine, all] = await Promise.all([serverGet<MyShop[]>("/auth/shops"), serverGet<ShopOption[]>("/shops")]);
  const linked = new Map(mine.map((shop) => [shop.id, shop]));
  const others = all.filter((shop) => !linked.has(shop.id));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="My Shops"
        subtitle="Each shop keeps its own records of your vehicles, visits and invoices. Switch shop from the top bar at any time."
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Linked to your account</h2>
        {mine.map((shop) => (
          <ShopRow key={shop.id} shop={shop} action={shop.current ? <Badge tone="blue">Current shop</Badge> : <ShopLinkButton shopId={shop.id} shopName={shop.name} linked />} />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Other shops on MotorMate</h2>
        <p className="text-sm text-slate-500">
          Linking a shop shares your name, phone, email and LINE ID with it. If you&apos;ve been there before with the same email
          and phone, your history there is linked too.
        </p>
        {others.length === 0 ? (
          <EmptyState title="You're linked to every shop on MotorMate." />
        ) : (
          others.map((shop) => <ShopRow key={shop.id} shop={shop} action={<ShopLinkButton shopId={shop.id} shopName={shop.name} linked={false} />} />)
        )}
      </section>
    </div>
  );
}

function ShopRow({ shop, action }: { shop: ShopOption; action: React.ReactNode }) {
  return (
    <Card className="flex flex-wrap items-start justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{shop.name}</p>
        <p className="whitespace-pre-line text-sm text-slate-500">{shop.address}</p>
        <p className="text-sm text-slate-500">{formatThaiPhone(shop.phone)}</p>
      </div>
      {action}
    </Card>
  );
}
