import type { CustomerDetail } from "@motormate/types";
import { ChangePasswordForm, OwnContactForm } from "@/components/profile/profile-forms";
import { Card, PageHeader } from "@/components/ui";
import { formatThaiPhone, fullName } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";
import { requireSession, serverGet } from "@/lib/server";

export default async function ProfilePage() {
  const { user } = await requireSession();
  const customer = user.role === "CUSTOMER" && user.customerId ? await serverGet<CustomerDetail>("/customers/me") : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Profile"
        subtitle={
          <>
            {fullName(user)} · {user.email} · {ROLE_LABELS[user.role]}
          </>
        }
      />

      {customer && (
        <Card className="p-6">
          <h2 className="mb-1 text-base font-semibold">Contact details</h2>
          <p className="mb-4 text-sm text-slate-500">
            Your email ({customer.email}) is how you sign in, so only the shop can change it.
          </p>
          <OwnContactForm phone={formatThaiPhone(customer.phone)} lineId={customer.lineId ?? ""} />
        </Card>
      )}

      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold">Change password</h2>
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
