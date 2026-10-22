"use client";

import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";
import { useApi, useFormSubmit } from "@/lib/client";

const SMALL = "px-2.5 py-1 text-xs";

/** Close an item: the work was done, or it no longer applies (sold the car, done elsewhere…). */
export function ReminderActions({ id }: { id: string }) {
  const router = useRouter();
  const callApi = useApi();
  const { error, submitting, submit } = useFormSubmit();

  async function close(status: "DONE" | "DISMISSED") {
    // 204 has no body, so report success explicitly.
    const closed = await submit(async () => {
      await callApi(`/reminders/recommendations/${id}`, { method: "PATCH", body: { status } });
      return true;
    });
    if (closed) router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Button className={SMALL} variant="secondary" disabled={submitting} onClick={() => close("DONE")}>
          Done
        </Button>
        <Button className={SMALL} variant="secondary" disabled={submitting} onClick={() => close("DISMISSED")}>
          Dismiss
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
