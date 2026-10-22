"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AppointmentCounts, AppointmentView } from "@motormate/types";

/** Requests / Today / Upcoming / Past, written to the URL like the search box. */
export function AppointmentTabs({ view, counts }: { view: AppointmentView; counts: AppointmentCounts }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabs: { value: AppointmentView; label: string; count?: number }[] = [
    { value: "requests", label: "Requests", count: counts.requests },
    { value: "today", label: "Today", count: counts.today },
    { value: "upcoming", label: "Upcoming" },
    { value: "past", label: "Past" },
  ];

  function select(value: AppointmentView) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", value);
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5" role="tablist">
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
