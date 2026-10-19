import Link from "next/link";
import { notFound } from "next/navigation";
import { Construction } from "lucide-react";
import { findNavItem } from "@/lib/nav";

/** Placeholder for sidebar sections whose module hasn't been built yet. */
export default function ComingSoonPage({ params }: { params: { section: string } }) {
  const item = findNavItem(params.section);
  if (!item || !item.slug) notFound();

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-20 text-center">
      <Construction className="h-10 w-10 text-amber-500" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">{item.label} is coming soon</h1>
      <p className="mt-2 text-sm text-slate-500">This module is scheduled for an upcoming sprint.</p>
      <Link href="/app" className="mt-6 text-sm font-medium text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
    </div>
  );
}
