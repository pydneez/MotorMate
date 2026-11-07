"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Check, ChevronDown, Plus, Store } from "lucide-react";
import type { AuthUser, MyShop } from "@motormate/types";
import { useApi } from "@/lib/client";

/**
 * The shop you're working in, at the top of every page. Staff belong to one shop, so it's a
 * label; a customer linked to several shops can switch here (or link another one).
 */
export function ShopSwitcher({ user }: { user: AuthUser }) {
  if (!user.shopName) return null;
  if (user.role !== "CUSTOMER") {
    return (
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
        <Store className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" aria-hidden />
        <span className="hidden truncate sm:inline">{user.shopName}</span>
      </span>
    );
  }
  return <CustomerShopMenu user={user} />;
}

function CustomerShopMenu({ user }: { user: AuthUser }) {
  const router = useRouter();
  const callApi = useApi();
  const { update } = useSession();
  const [open, setOpen] = useState(false);
  const [shops, setShops] = useState<MyShop[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    callApi<MyShop[]>("/auth/shops")
      .then(setShops)
      .catch(() => setError("Couldn't load your shops."));
  }, [open, callApi]);

  async function switchTo(shopId: string) {
    setSwitching(shopId);
    const session = await update({ shopId });
    setSwitching(null);
    if (session?.user.shopId !== shopId) {
      setError("Couldn't switch to that shop. Please try again.");
      return;
    }
    setOpen(false);
    router.push("/app");
    router.refresh();
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        <Store className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" aria-hidden />
        <span className="max-w-[9rem] truncate sm:max-w-xs">{user.shopName}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-20 mt-2 w-72 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <p className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">Your shops</p>
          {shops === null && !error && <p className="px-3 py-2 text-sm text-slate-500">Loading…</p>}
          {shops?.map((shop) => (
            <button
              key={shop.id}
              role="menuitem"
              disabled={shop.current || switching !== null}
              onClick={() => switchTo(shop.id)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{shop.name}</span>
                <span className="block truncate text-xs text-slate-500">{shop.address.split("\n")[0]}</span>
              </span>
              {shop.current ? (
                <Check className="h-4 w-4 shrink-0 text-blue-600" aria-label="Current shop" />
              ) : (
                switching === shop.id && <span className="text-xs text-slate-500">Switching…</span>
              )}
            </button>
          ))}
          {error && <p className="px-3 py-2 text-sm text-red-700">{error}</p>}
          <Link
            href="/app/shops"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded-md border-t border-slate-100 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-slate-100"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Link another shop
          </Link>
        </div>
      )}
    </div>
  );
}
