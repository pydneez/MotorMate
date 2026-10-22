"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Play } from "lucide-react";
import type { DailyJobsSummary } from "@motormate/types";
import { Alert, Button } from "@/components/ui";
import { useApi, useFormSubmit } from "@/lib/client";

/** "12 service reminders, 1 appointment reminder; 2 waiting for email confirmation" */
function describe({ morning, closeDay }: DailyJobsSummary): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const done = [
    morning.reminders && plural(morning.reminders, "service reminder"),
    morning.followUps && plural(morning.followUps, "follow-up"),
    morning.appointmentReminders && plural(morning.appointmentReminders, "appointment reminder"),
    morning.subscriptions && plural(morning.subscriptions, "new email subscription"),
    closeDay.noShows && plural(closeDay.noShows, "no-show"),
    closeDay.expired && `${plural(closeDay.expired, "unconfirmed request")} cancelled`,
  ].filter(Boolean);
  const waiting = [
    morning.notConfirmed && `${morning.notConfirmed} waiting for email confirmation`,
    morning.noEmail && `${morning.noEmail} without an email (call them)`,
    morning.failed && `${morning.failed} failed`,
  ].filter(Boolean);
  return [done.length ? done.join(", ") : "Nothing new to send", ...(waiting.length ? [waiting.join(", ")] : [])].join("; ") + ".";
}

/**
 * Runs both daily jobs now (on AWS they also run at 09:00 and 18:30 by themselves) — handy
 * for a demo, or after adding a recommendation that's already due.
 */
export function RunJobsButton() {
  const router = useRouter();
  const callApi = useApi();
  const { error, submitting, submit } = useFormSubmit();
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setResult(null);
    const summary = await submit(() => callApi<DailyJobsSummary>("/reminders/run", { method: "POST" }));
    if (summary) {
      setResult(describe(summary));
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="secondary" loading={submitting} onClick={run}>
        <Play className="h-4 w-4" aria-hidden /> Run daily jobs now
      </Button>
      {result && <Alert tone="success">{result}</Alert>}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
