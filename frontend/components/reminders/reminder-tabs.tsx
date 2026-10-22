"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReminderCounts } from "@motormate/types";

export type ReminderTab = "due" | "overdue" | "upcoming" | "sent";

/** Due now / Overdue / Coming up / Sent emails, written to the URL like the search box. */
export function ReminderTabs({ view, counts }: { view: ReminderTab; counts: ReminderCounts }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabs: { value: ReminderTab; label: string; count?: number }[] = [
    { value: "due", label: "Due now", count: counts.due },
    { value: "overdue", label: "Overdue", count: counts.overdue },
    { value: "upcoming", label: "Coming up" },
    { value: "sent", label: "Sent emails" },
  ];

  function select(value: ReminderTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", value);
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="inline-flex flex-wrap rounded-md border border-slate-300 bg-white p-0.5" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={view === tab.value}
          onClick={() => select(tab.value)}
          className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium ${
            view === tab.value ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {tab.label}
          {tab.count ? (
            <span className={`rounded-full px-1.5 text-xs ${view === tab.value ? "bg-white/25" : "bg-amber-100 text-amber-800"}`}>{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
