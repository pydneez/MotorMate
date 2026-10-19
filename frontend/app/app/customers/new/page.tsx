import { CustomerForm } from "@/components/customers/customer-form";
import { Card, PageHeader } from "@/components/ui";

export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New customer" back={{ href: "/app/customers", label: "Customers" }} />
      <Card className="p-6">
        <CustomerForm />
      </Card>
    </div>
  );
}
