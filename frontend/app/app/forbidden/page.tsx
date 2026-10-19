import Link from "next/link";
import { Lock } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-20 text-center">
      <Lock className="h-10 w-10 text-slate-400" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-slate-500">Ask an administrator if you think this is a mistake.</p>
      <Link href="/app" className="mt-6 text-sm font-medium text-blue-600 hover:underline">
        ← Back to dashboard
      </Link>
    </div>
  );
}
