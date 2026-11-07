import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { queryShopId } from "./tenancy";

/**
 * The one place multi-shop isolation is enforced: every query on a shop's tables gets the
 * current shop added to its filter (tenancy.ts says which shop), so services keep writing
 * `prisma.customer.findMany(...)` and can't forget it. Proven by test/shops.int-spec.ts,
 * which tries every kind of record across shops.
 *
 * - Tables with their own shopId are filtered on it, and creates must carry the same shop.
 * - Child tables are filtered through their parent (an appointment through its customer…).
 * - User, Shop and AuditLog aren't scoped here: logins are global and looked up before a
 *   shop is known; staff queries filter on shopId themselves.
 * - Raw SQL ($queryRaw) bypasses this — Reports adds the shop filter by hand.
 */
const OWN_SHOP_ID = new Set<string>(["Customer", "Vehicle", "WorkOrder", "Invoice", "InventoryItem", "ServiceCatalogItem"]);

const THROUGH_PARENT: Record<string, (shopId: string) => object> = {
  Appointment: (shopId) => ({ customer: { shopId } }),
  AppointmentService: (shopId) => ({ appointment: { customer: { shopId } } }),
  NotificationLog: (shopId) => ({ customer: { shopId } }),
  PartUsed: (shopId) => ({ workOrder: { shopId } }),
  ServiceItem: (shopId) => ({ workOrder: { shopId } }),
  ServiceRecommendation: (shopId) => ({ vehicle: { shopId } }),
  StockMovement: (shopId) => ({ inventoryItem: { shopId } }),
  WorkOrderStatusChange: (shopId) => ({ workOrder: { shopId } }),
};

const FILTERED = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

const CREATES = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

/** The shop condition for a model, or null if the model isn't a shop's. */
export function shopFilter(model: string, shopId: string): object | null {
  if (OWN_SHOP_ID.has(model)) return { shopId };
  return THROUGH_PARENT[model]?.(shopId) ?? null;
}

/** Adds `condition` to a where clause (unique-key wheres keep their keys at the top). */
export function withCondition(where: object | undefined, condition: object): object {
  const current = (where ?? {}) as { AND?: object | object[] };
  const and = current.AND === undefined ? [] : Array.isArray(current.AND) ? current.AND : [current.AND];
  return { ...current, AND: [...and, condition] };
}

/** A create on a table with its own shopId must be for the current shop. */
function checkCreatedShop(model: string, data: unknown, shopId: string): void {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    const rowShop = (row as { shopId?: unknown } | undefined)?.shopId;
    if (rowShop !== shopId) {
      throw new ForbiddenException(`Refused to create a ${model} for another shop`);
    }
  }
}

export const shopScope = Prisma.defineExtension({
  name: "shop-scope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // Logins, shops and the audit log aren't a shop's: never scoped, even before sign-in.
        if (!OWN_SHOP_ID.has(model) && !THROUGH_PARENT[model]) return query(args);
        const shopId = queryShopId();
        if (shopId === null) return query(args);
        const condition = shopFilter(model, shopId)!;

        const scoped = { ...(args as Record<string, unknown>) };
        if (FILTERED.has(operation)) scoped.where = withCondition(scoped.where as object | undefined, condition);
        if (CREATES.has(operation) && OWN_SHOP_ID.has(model)) {
          checkCreatedShop(model, operation === "upsert" ? scoped.create : scoped.data, shopId);
        }
        return query(scoped as typeof args);
      },
    },
  },
});
