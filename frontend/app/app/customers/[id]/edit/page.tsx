import type { CustomerDetail } from "@motormate/types";
import { CustomerForm } from "@/components/customers/customer-form";
import { Card, PageHeader } from "@/components/ui";
import { fullName } from "@/lib/format";
import { serverGet } from "@/lib/server";

export default async function EditCustomerPage({ params }: { params: { id: string } }) {
  const customer = await serverGet<CustomerDetail>(`/customers/${params.id}`);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Edit ${fullName(customer)}`} back={{ href: `/app/customers/${customer.id}`, label: fullName(customer) }} />
      <Card className="p-6">
        <CustomerForm customer={customer} />
      </Card>
    </div>
  );
}
