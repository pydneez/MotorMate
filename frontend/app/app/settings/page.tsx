import Link from "next/link";
import { groupServices, type ServiceCatalogEntry, type ShopDetails } from "@motormate/types";
import { AddServiceButton, ServiceRowActions } from "@/components/settings/service-dialogs";
import { ShopDetailsForm } from "@/components/settings/shop-details-form";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatTHB } from "@/lib/format";
import { serverGet } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

/** Admin only (NAV_ITEMS): the shop's details and the price list of routine services. */
export default async function SettingsPage({ searchParams }: Props) {
  const showInactive = searchParams.inactive === "1";
  const [shop, services] = await Promise.all([
    serverGet<ShopDetails>("/settings/shop"),
    serverGet<ServiceCatalogEntry[]>(`/services${showInactive ? "?includeInactive=true" : ""}`),
  ]);
  const categories = [...new Set(services.map((service) => service.category))].sort();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" subtitle="Shop details and the price list." />

      <div className="space-y-6">
        <Card className="p-4 sm:p-6">
          <h2 className="text-base font-semibold">Shop details</h2>
          <p className="mb-4 text-sm text-slate-500">Printed on invoices and the invoice PDF, and signed on customer emails.</p>
          <ShopDetailsForm shop={shop} />
        </Card>

        <Card className="p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Services &amp; prices</h2>
              <p className="text-sm text-slate-500">
                Routine jobs at a fixed price (฿, excl. VAT). Picked on work orders and when booking; anything else is a custom line.
              </p>
            </div>
            <AddServiceButton categories={categories} />
          </div>
          <Link
            href={showInactive ? "/app/settings" : "/app/settings?inactive=1"}
            className="mt-3 inline-block text-sm text-blue-700 hover:underline"
          >
            {showInactive ? "Hide deactivated services" : "Show deactivated services"}
          </Link>

          {services.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No services yet">Add the routine jobs you do at a fixed price, like an oil change.</EmptyState>
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              {groupServices(services).map(({ category, services: group }) => (
                <section key={category}>
                  <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{category}</h3>
                  <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                    {group.map((service) => (
                      <li
                        key={service.id}
                        className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-sm ${service.isActive ? "" : "bg-slate-50 opacity-60"}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{service.name}</p>
                          <div className="mt-0.5 flex flex-wrap gap-1.5">
                            {!service.bookable && <Badge>Staff only</Badge>}
                            {!service.isActive && <Badge tone="red">Deactivated</Badge>}
                          </div>
                        </div>
                        <p className="w-24 text-right font-medium tabular-nums">{formatTHB(service.price)}</p>
                        <ServiceRowActions service={service} categories={categories} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
