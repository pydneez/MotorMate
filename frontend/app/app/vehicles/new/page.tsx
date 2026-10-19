import type { CustomerDetail } from "@motormate/types";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { fullName } from "@/lib/format";
import { requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: { customerId?: string } };

export default async function NewVehiclePage({ searchParams }: Props) {
  const { user } = await requireSession();

  // Customers always add to their own record.
  if (user.role === "CUSTOMER") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Add my vehicle" back={{ href: "/app/vehicles", label: "My vehicles" }} />
        <Card className="p-6">
          <VehicleForm cancelHref="/app/vehicles" />
        </Card>
      </div>
    );
  }

  // Staff add to a specific customer, chosen from the customer page.
  if (!searchParams.customerId) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Add vehicle" back={{ href: "/app/vehicles", label: "Vehicles" }} />
        <EmptyState title="Choose the owner first">
          <p>Open the customer&apos;s page and use &ldquo;Add vehicle&rdquo;.</p>
          <LinkButton href="/app/customers" className="mt-4">
            Go to customers
          </LinkButton>
        </EmptyState>
      </div>
    );
  }

  const customer = await serverGet<CustomerDetail>(`/customers/${searchParams.customerId}`);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`Add vehicle for ${fullName(customer)}`}
        back={{ href: `/app/customers/${customer.id}`, label: fullName(customer) }}
      />
      <Card className="p-6">
        <VehicleForm customerId={customer.id} cancelHref={`/app/customers/${customer.id}`} />
      </Card>
    </div>
  );
}
