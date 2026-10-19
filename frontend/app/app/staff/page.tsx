import type { Paginated, StaffUser } from "@motormate/types";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { AddStaffButton, StaffRowActions } from "@/components/staff/staff-dialogs";
import { StaffFilters } from "@/components/staff/staff-filters";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, fullName } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";
import { queryString, requireSession, serverGet } from "@/lib/server";

type Props = { searchParams: Record<string, string | string[] | undefined> };

const ROLE_TONE = { ADMIN: "blue", ADVISOR: "green", MECHANIC: "amber" } as const;

export default async function StaffPage({ searchParams }: Props) {
  const { user: me } = await requireSession();
  const data = await serverGet<Paginated<StaffUser>>(
    `/users${queryString({
      q: searchParams.q,
      role: searchParams.role,
      includeInactive: searchParams.includeInactive,
      page: searchParams.page,
    })}`,
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Staff" subtitle="Admins, service advisors and mechanics." actions={<AddStaffButton />} />
      <div className="flex flex-wrap items-center gap-4">
        <SearchBox placeholder="Search name or email…" />
        <StaffFilters />
      </div>

      <Card className="mt-4">
        {data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No staff match these filters" />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((user) => (
              <li
                key={user.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 ${user.isActive ? "" : "bg-slate-50 opacity-60"}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">
                    {fullName(user)}
                    {user.id === me.id && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}
                  </p>
                  <p className="truncate text-sm text-slate-500">{user.email}</p>
                </div>
                <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                <div className="w-28 text-sm">
                  {user.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}
                </div>
                <p className="hidden w-36 text-xs text-slate-500 lg:block">
                  {user.lastLoginAt ? `Last sign-in ${formatDate(user.lastLoginAt)}` : "Never signed in"}
                </p>
                <div className="w-10 text-right">{user.id !== me.id && <StaffRowActions user={user} />}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination data={data} basePath="/app/staff" searchParams={searchParams} />
    </div>
  );
}
