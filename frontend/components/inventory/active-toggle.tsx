"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/data/modal";
import { Alert, Button } from "@/components/ui";
import { useApi, useFormSubmit } from "@/lib/client";

/** Deactivate (with confirmation) or reactivate an item. Items are never deleted: history stays. */
export function ActiveToggle({ itemId, name, isActive }: { itemId: string; name: string; isActive: boolean }) {
  const router = useRouter();
  const callApi = useApi();
  const [confirming, setConfirming] = useState(false);
  const { error, submitting, submit } = useFormSubmit();

  async function setActive(active: boolean) {
    if (await submit(() => callApi(`/inventory/${itemId}/${active ? "reactivate" : "deactivate"}`, { method: "POST" }))) {
      setConfirming(false);
      router.push(`/app/inventory/${itemId}`);
      router.refresh();
    }
  }

  if (!isActive) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">This item is deactivated: it&apos;s hidden from the list and can&apos;t be used on work orders.</p>
        <Button variant="secondary" loading={submitting} onClick={() => setActive(true)}>
          Reactivate item
        </Button>
        {error && <Alert>{error}</Alert>}
      </div>
    );
  }

  return (
    <>
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Deactivate item
      </Button>
      <Modal open={confirming} title={`Deactivate ${name}?`} onClose={() => setConfirming(false)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            It will be hidden from the inventory list and the part picker on work orders. Its stock history is kept, and you
            can reactivate it later.
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={submitting} onClick={() => setActive(false)}>
              Deactivate
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
