import { Mail, MessageCircle, Pencil, Phone, Plus } from "lucide-react";
import type { CustomerDetail, CustomerDuplicates } from "@motormate/types";
import { MergeCustomers } from "@/components/customers/merge-customers";
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
import { formatMonth, formatThaiPhone, fullName } from "@/lib/format";
import { serverGet } from "@/lib/server";

export default async function CustomerPage({ params }: { params: { id: string } }) {
  const customer = await serverGet<CustomerDetail>(`/customers/${params.id}`);
  // Other records with the same phone — candidates for merging (usually none, rarely one).
  const { byPhone } = await serverGet<CustomerDuplicates>(
    `/customers/duplicates?phone=${encodeURIComponent(customer.phone)}&excludeId=${customer.id}`,
  );
  const duplicates = await Promise.all(byPhone.map((match) => serverGet<CustomerDetail>(`/customers/${match.id}`)));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={fullName(customer)}
        back={{ href: "/app/customers", label: "Customers" }}
        actions={
          <LinkButton href={`/app/customers/${customer.id}/edit`} variant="secondary">
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </LinkButton>
        }
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" aria-hidden /> {formatThaiPhone(customer.phone)}
            </span>
            {customer.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" aria-hidden /> {customer.email}
              </span>
            )}
            {customer.lineId && (
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="h-3.5 w-3.5" aria-hidden /> LINE {customer.lineId}
              </span>
            )}
          </div>
        }
      />

      {duplicates.length > 0 && (
        <div className="mb-6">
          <Alert tone="warning">
            <p className="font-medium">Possible duplicate: another customer has the same phone number</p>
            <ul className="mt-2 space-y-2">
              {duplicates.map((other) => (
                <li key={other.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {fullName(other)} · {formatThaiPhone(other.phone)} · {other.email ?? "no email"} ·{" "}
                    {other.vehicleCount} vehicle{other.vehicleCount === 1 ? "" : "s"} ·{" "}
                    {other.hasPortalAccount ? "online account" : "walk-in"}
                  </span>
                  <span className="flex gap-2">
                    <LinkButton href={`/app/customers/${other.id}`} variant="secondary">
                      Open →
                    </LinkButton>
                    <MergeCustomers current={customer} other={other} />
                  </span>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        Portal account:{" "}
        {customer.hasPortalAccount ? <Badge tone="green">Active</Badge> : <Badge>None</Badge>}
        <span>· Customer since {formatMonth(customer.createdAt)}</span>
        {!customer.email && (
          <Badge tone="amber">No email: can&apos;t receive reminders or link an online account</Badge>
        )}
      </div>

      {customer.notes && (
        <Card className="mb-6 whitespace-pre-line p-4 text-sm text-slate-700">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Notes</p>
          {customer.notes}
        </Card>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Vehicles ({customer.vehicles.length})</h2>
        <LinkButton href={`/app/vehicles/new?customerId=${customer.id}`}>
          <Plus className="h-4 w-4" aria-hidden /> Add vehicle
        </LinkButton>
      </div>
      {customer.vehicles.length === 0 ? (
        <EmptyState title="No vehicles yet">Add this customer's first vehicle to start their service history.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {customer.vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      )}
    </div>
  );
}
