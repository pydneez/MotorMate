"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { Alert, Button } from "@/components/ui";

/**
 * "Link" (join a new shop) or "Switch" (one you're linked to). Both swap the session to that
 * shop's token on the server (auth.ts jwt callback), then open its dashboard.
 */
export function ShopLinkButton({ shopId, shopName, linked }: { shopId: string; shopName: string; linked: boolean }) {
  const router = useRouter();
  const { update } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    const session = await update({ shopId, link: !linked });
    setBusy(false);
    if (session?.user.shopId !== shopId) {
      setError(
        linked
          ? "Couldn't switch to this shop. Please try again."
          : `Couldn't link you to ${shopName}. If they already have your email with other details, please call them.`,
      );
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant={linked ? "secondary" : "primary"} className="px-3 py-1.5 text-sm" loading={busy} onClick={onClick}>
        {linked ? "Switch to this shop" : "Link this shop"}
      </Button>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
