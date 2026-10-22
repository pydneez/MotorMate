import Link from "next/link";
import {
  formatWorkOrderNumber,
  NOTIFICATION_TYPE_LABEL,
  REMINDER_VIEWS,
  type NotificationEntry,
  type Paginated,
  type ReminderCounts,
  type ReminderItem,
} from "@motormate/types";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { NotifyBadge, ReminderStateBadge, dueText } from "@/components/reminders/reminder-badges";
import { ReminderActions } from "@/components/reminders/reminder-actions";
import { ReminderTabs, type ReminderTab } from "@/components/reminders/reminder-tabs";
import { RunJobsButton } from "@/components/reminders/run-jobs-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime, formatKm, formatThaiPhone } from "@/lib/format";
import { queryString, serverGet } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

const EMPTY: Record<Exclude<ReminderTab, "sent">, string> = {
  due: "Nothing is due in the next 7 days or 1,000 km.",
  overdue: "Nothing is overdue.",
  upcoming: "No other recommendations are open.",
};

/**
 * Service recommendations that are coming due, and the emails the daily job sent. Staff
 * close items as done or dismissed; the emails themselves go out automatically.
 */
export default async function RemindersPage({ searchParams }: Props) {
  const requested = typeof searchParams.view === "string" ? searchParams.view : "";
  const view: ReminderTab = requested === "sent" || (REMINDER_VIEWS as readonly string[]).includes(requested) ? (requested as ReminderTab) : "due";
  const counts = await serverGet<ReminderCounts>("/reminders/counts");

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reminders" actions={<RunJobsButton />} />
      <p className="-mt-2 mb-4 text-sm text-slate-500">
        Customers are emailed 7 days before a due date or about 1,000 km before a due mileage (estimated from their visits), with one
        follow-up 30 days later. Emails go out every morning at 09:00.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <ReminderTabs view={view} counts={counts} />
        {view !== "sent" && <SearchBox placeholder="Search customer, plate or item…" />}
      </div>
      {view === "sent" ? <SentEmails searchParams={searchParams} /> : <Recommendations view={view} searchParams={searchParams} />}
    </div>
  );
}

async function Recommendations({ view, searchParams }: Props & { view: Exclude<ReminderTab, "sent"> }) {
  const data = await serverGet<Paginated<ReminderItem>>(`/reminders${queryString({ view, q: searchParams.q, page: searchParams.page })}`);
  return (
    <>
      <Card className="mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="All clear">{searchParams.q ? "No matches — try another search." : EMPTY[view]}</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((item) => (
              <li
                key={item.id}
                className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-start xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <div>
                  <p className="font-medium">
                    {item.description} <ReminderStateBadge state={item.state} />
                  </p>
                  <p className="text-slate-600">Due {dueText(item)}</p>
                  {item.dueMileage !== null && (
                    <p className="text-xs text-slate-500">
                      Now about {formatKm(item.estimatedMileage)} ({item.kmPerDay} km/day)
                    </p>
                  )}
                  {item.workOrder && (
                    <Link href={`/app/work-orders/${item.workOrder.id}`} className="text-xs text-blue-700 hover:underline">
                      Recommended on {formatWorkOrderNumber(item.workOrder.number)}
                    </Link>
                  )}
                </div>
                <div>
                  <Link href={`/app/customers/${item.customer.id}`} className="font-medium text-blue-700 hover:underline">
                    {item.customer.name}
                  </Link>
                  <p className="whitespace-nowrap text-xs text-slate-500">{formatThaiPhone(item.customer.phone)}</p>
                  <div className="mt-1">
                    <NotifyBadge status={item.customer.notify} />
                  </div>
                </div>
                <div>
                  <Link href={`/app/vehicles/${item.vehicle.id}`} className="hover:underline">
                    {item.vehicle.plate} <span className="text-slate-500">{item.vehicle.province}</span>
                  </Link>
                  <p className="text-xs text-slate-500">
                    {item.vehicle.make} {item.vehicle.model}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.reminders.lastSentAt
                      ? `Emailed ${formatDate(item.reminders.lastSentAt)}${item.reminders.count > 1 ? ` (${item.reminders.count}×)` : ""}`
                      : "Not emailed yet"}
                  </p>
                </div>
                {/* Own row until the screen is wide enough for a fourth column. */}
                <div className="md:col-span-3 xl:col-span-1">
                  <ReminderActions id={item.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination data={data} basePath="/app/reminders" searchParams={searchParams} />
    </>
  );
}

const SENT_STATUS: Record<NotificationEntry["status"], { label: string; tone: "green" | "red" | "amber" | "slate" }> = {
  SENT: { label: "Sent", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  SKIPPED: { label: "Not sent", tone: "amber" },
  PENDING: { label: "Pending", tone: "slate" },
};

async function SentEmails({ searchParams }: Props) {
  const data = await serverGet<Paginated<NotificationEntry>>(`/reminders/history${queryString({ page: searchParams.page })}`);
  return (
    <>
      <Card className="mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No emails yet">Service reminders and appointment emails appear here once they&apos;re sent.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((entry) => (
              <li key={entry.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[8rem_minmax(0,1fr)_minmax(0,2fr)_auto] md:items-start">
                <p className="text-slate-500">{formatDateTime(entry.createdAt)}</p>
                <div>
                  {entry.customer ? (
                    <Link href={`/app/customers/${entry.customer.id}`} className="font-medium text-blue-700 hover:underline">
                      {entry.customer.name}
                    </Link>
                  ) : (
                    <span className="font-medium">—</span>
                  )}
                  <p className="break-all text-xs text-slate-500">{entry.recipientEmail ?? "No email"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{NOTIFICATION_TYPE_LABEL[entry.type]}</p>
                  <p>{entry.subject ?? "—"}</p>
                  {entry.error && (
                    <p className={`text-xs ${entry.status === "SKIPPED" ? "text-amber-800" : "text-red-700"}`}>
                      {entry.error}
                      {entry.status === "SKIPPED" && " — call the customer"}
                    </p>
                  )}
                </div>
                <div>
                  <Badge tone={SENT_STATUS[entry.status].tone}>{SENT_STATUS[entry.status].label}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination data={data} basePath="/app/reminders" searchParams={searchParams} />
    </>
  );
}
