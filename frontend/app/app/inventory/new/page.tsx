import { redirect } from "next/navigation";
import { InventoryForm } from "@/components/inventory/inventory-form";
import { Card, PageHeader } from "@/components/ui";
import { requireSession, serverGet } from "@/lib/server";

export default async function NewInventoryItemPage() {
  const { user } = await requireSession();
  if (user.role !== "ADMIN" && user.role !== "ADVISOR") redirect("/app/inventory");
  const categories = await serverGet<string[]>("/inventory/categories");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Add inventory item" back={{ href: "/app/inventory", label: "Inventory" }} />
      <Card className="p-6">
        <InventoryForm categories={categories} />
      </Card>
    </div>
  );
}
