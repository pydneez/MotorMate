"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlatformShop } from "@motormate/types";
import { Modal } from "@/components/data/modal";
import { Alert, Button } from "@/components/ui";
import { useApi, useFormSubmit } from "@/lib/client";

/** Suspend (with a confirmation) or Reactivate a shop. Both are audited. */
export function ShopStatusActions({ shop }: { shop: PlatformShop }) {
  const router = useRouter();
  const callApi = useApi();
  const [confirming, setConfirming] = useState(false);
  const { error, submitting, submit, setError } = useFormSubmit();

  async function change(action: "suspend" | "reactivate") {
    if (await submit(() => callApi(`/platform/shops/${shop.id}/${action}`, { method: "POST" }))) {
      setConfirming(false);
      router.refresh();
    }
  }

  if (!shop.isActive) {
    return (
      <div className="flex flex-col items-end gap-2">
        <Button variant="success" className="px-2.5 py-1 text-xs" loading={submitting} onClick={() => change("reactivate")}>
          Reactivate
        </Button>
        {error && <Alert>{error}</Alert>}
      </div>
    );
  }

  return (
    <>
      <Button
        variant="dangerOutline"
        className="px-2.5 py-1 text-xs"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Suspend
      </Button>
      <Modal open={confirming} title={`Suspend ${shop.name}?`} onClose={() => setConfirming(false)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            Its staff are signed out straight away and can&apos;t sign in; its customers can&apos;t open it, and it disappears from the
            sign-up list. Nothing is deleted — reactivate it to restore access.
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={submitting} onClick={() => change("suspend")}>
              Suspend shop
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
