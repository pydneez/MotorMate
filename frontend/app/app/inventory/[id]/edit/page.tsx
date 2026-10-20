import { redirect } from "next/navigation";
import type { InventoryItemDetail } from "@motormate/types";
import { ActiveToggle } from "@/components/inventory/active-toggle";
import { InventoryForm } from "@/components/inventory/inventory-form";
import { Card, PageHeader } from "@/components/ui";
import { requireSession, serverGet } from "@/lib/server";

export default async function EditInventoryItemPage({ params }: { params: { id: string } }) {
  const { user } = await requireSession();
  if (user.role !== "ADMIN" && user.role !== "ADVISOR") redirect(`/app/inventory/${params.id}`);
  const [item, categories] = await Promise.all([
    serverGet<InventoryItemDetail>(`/inventory/${params.id}`),
    serverGet<string[]>("/inventory/categories"),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={`Edit ${item.name}`} back={{ href: `/app/inventory/${item.id}`, label: item.name }} />
      <Card className="p-6">
        <InventoryForm item={item} categories={categories} />
      </Card>
      <Card className="p-6">
        <h2 className="mb-3 text-base font-semibold">{item.isActive ? "Stop using this item" : "Deactivated"}</h2>
        <ActiveToggle itemId={item.id} name={item.name} isActive={item.isActive} />
      </Card>
    </div>
  );
}
