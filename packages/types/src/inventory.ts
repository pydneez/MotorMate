import { z } from "zod";
import { clearableText, ListQuerySchema, QueryBooleanSchema, wholeNumber } from "./common";

/** Why a stock level changed — mirrors the Prisma StockMovementReason enum. */
export const StockMovementReasonSchema = z.enum(["PURCHASE", "WORK_ORDER", "ADJUSTMENT"]);

export type StockMovementReason = z.infer<typeof StockMovementReasonSchema>;

/** Stored uppercase, so uniqueness is case-insensitive ("flt-oil" = "FLT-OIL"). */
export const SkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{2,40}$/, "SKU: 2–40 letters, digits or dashes");

/**
 * A THB amount from a form field or JSON: required (blank isn't 0), ≥ 0, at most 2 decimals.
 * Prices exclude VAT; VAT is added on the invoice.
 */
export function money(label: string) {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
    z
      .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
      .nonnegative(`${label} can't be negative`)
      .max(9_999_999.99, `${label} is too large`)
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, `${label} can have at most 2 decimals`),
  );
}

const name = z.string().trim().min(1, "Name is required").max(120);
const category = z.string().trim().min(1, "Category is required").max(50);

export const CreateInventoryItemSchema = z.object({
  sku: SkuSchema,
  name,
  category,
  unitCost: money("Cost"),
  unitPrice: money("Price"),
  supplier: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || undefined),
  reorderLevel: wholeNumber("Reorder level", (n) => n.nonnegative("Reorder level can't be negative")),
  /** Stock already on the shelf when the item is added; recorded as an "Opening stock" movement. */
  openingQuantity: wholeNumber("Opening quantity", (n) => n.nonnegative("Opening quantity can't be negative")),
});

export type CreateInventoryItemInput = z.input<typeof CreateInventoryItemSchema>;

/**
 * Quantity is NOT editable here — it only changes through Receive, Stocktake or work orders,
 * each of which records a stock movement. `.strict()` rejects it instead of ignoring it.
 */
export const UpdateInventoryItemSchema = z
  .object({
    sku: SkuSchema,
    name,
    category,
    unitCost: money("Cost"),
    unitPrice: money("Price"),
    supplier: clearableText(120),
    reorderLevel: wholeNumber("Reorder level", (n) => n.nonnegative("Reorder level can't be negative")),
  })
  .partial()
  .strict();

export type UpdateInventoryItemInput = z.input<typeof UpdateInventoryItemSchema>;

/** A delivery arrives: add stock. */
export const ReceiveStockSchema = z.object({
  quantity: wholeNumber("Quantity", (n) => n.positive("Quantity must be at least 1").max(100_000, "Quantity is too large")),
  /** e.g. the supplier's invoice number. */
  note: clearableText(200),
});

export type ReceiveStockInput = z.input<typeof ReceiveStockSchema>;

/** Shelf count: set the counted quantity; the difference is recorded as an adjustment. */
export const StocktakeSchema = z.object({
  countedQuantity: wholeNumber("Counted quantity", (n) => n.nonnegative("Counted quantity can't be negative")),
  reason: z.string().trim().min(3, "Give a reason for the difference").max(200),
});

export type StocktakeInput = z.input<typeof StocktakeSchema>;

export const InventoryListQuerySchema = ListQuerySchema.extend({
  category: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  lowStock: QueryBooleanSchema,
  includeInactive: QueryBooleanSchema,
});

export type InventoryListQuery = z.output<typeof InventoryListQuerySchema>;

export type InventoryItemSummary = {
  id: string;
  sku: string;
  name: string;
  category: string;
  quantityOnHand: number;
  /** THB, excluding VAT. */
  unitCost: number;
  unitPrice: number;
  supplier: string | null;
  reorderLevel: number;
  isActive: boolean;
  /** quantityOnHand ≤ reorderLevel */
  isLowStock: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StockMovementEntry = {
  id: string;
  /** Signed: negative = out, positive = in. */
  quantityChange: number;
  reason: StockMovementReason;
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  workOrder: { id: string; number: number } | null;
};

export type InventoryItemDetail = InventoryItemSummary & {
  /** Most recent first, at most 50. */
  movements: StockMovementEntry[];
};

export type InventorySummary = {
  activeItemCount: number;
  lowStockCount: number;
};
