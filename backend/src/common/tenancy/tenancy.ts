import { AsyncLocalStorage } from "node:async_hooks";
import { ForbiddenException } from "@nestjs/common";

/**
 * Which shop the current piece of work belongs to — "multi-shop" isolation in one place.
 *
 * Every HTTP request runs inside a store (TenancyMiddleware); JwtStrategy fills in the
 * signed-in user's shop. The Prisma extension (shop-scope.extension.ts) reads it and adds
 * the shop to every query on a shop's tables. Outside a request (seeds, test setup, scripts)
 * there's no store and nothing is scoped; code that must work across shops says so with
 * runUnscoped(), and work done for one shop without a request (the daily jobs) uses
 * runAsShop().
 */
type TenancyStore = { shopId: string | null; unscoped: boolean };

const storage = new AsyncLocalStorage<TenancyStore>();

/** Wraps one HTTP request: no shop yet, until JwtStrategy sets it. */
export function runRequest(next: () => void): void {
  storage.run({ shopId: null, unscoped: false }, next);
}

/** Called once the request's user is known (staff: their shop; customer: the current one). */
export function setRequestShop(shopId: string | null): void {
  const store = storage.getStore();
  if (store) store.shopId = shopId;
}

/**
 * Runs fn for one shop, e.g. a daily job looping over the shops, or a sign-up. Awaited
 * inside the store on purpose: a Prisma query is lazy and only runs when awaited, so
 * returning it unawaited would run it in the caller's context instead.
 */
export function runAsShop<T>(shopId: string, fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run({ shopId, unscoped: false }, async () => await fn());
}

/** Runs fn across all shops — only for platform-wide work (the platform admin's list). */
export function runUnscoped<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run({ shopId: null, unscoped: true }, async () => await fn());
}

/**
 * The shop a query must be limited to: a shop id, or null for "not scoped" (no store, or
 * runUnscoped). Inside a request with no shop — a public route or the platform admin
 * touching a shop's data — it refuses rather than return everyone's rows.
 */
export function queryShopId(): string | null {
  const store = storage.getStore();
  if (!store || store.unscoped) return null;
  if (!store.shopId) throw new ForbiddenException("No shop selected for this request");
  return store.shopId;
}

/** The current shop, for code that needs it (e.g. Settings → Shop details). */
export function currentShopId(): string {
  const shopId = storage.getStore()?.shopId;
  if (!shopId) throw new ForbiddenException("No shop selected for this request");
  return shopId;
}
