import { z } from "zod";
import {
  blankAsNull,
  blankAsUndefined,
  clearableText,
  ListQuerySchema,
  numberInput,
  QueryBooleanSchema,
  textWithLetters,
  wholeNumber,
} from "./common";

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
    numberInput,
    z
      .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
      .nonnegative(`${label} can't be negative`)
      .max(9_999_999.99, `${label} is too large`)
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, `${label} can have at most 2 decimals`),
  );
}

/** Free text ("Wiper blade 24\"") but not just a number. */
const name = textWithLetters("Name", { max: 120 });
const category = textWithLetters("Category", {
  max: 50,
  allowed: /^[\p{L}\p{M}\d\s&/-]+$/u,
  allowedHint: "letters, digits, spaces, & - and /",
});
const supplier = textWithLetters("Supplier", { max: 120 });

export const CreateInventoryItemSchema = z.object({
  sku: SkuSchema,
  name,
  category,
  unitCost: money("Cost"),
  unitPrice: money("Price"),
  supplier: blankAsUndefined(supplier),
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
    supplier: blankAsNull(supplier),
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
  reason: textWithLetters("Reason", { min: 3, max: 200, required: "Give a reason for the difference" }),
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
  /** Without `sort` the list keeps its default order (active, category, name). */
  sort: z.enum(["sku", "name", "quantity", "price"]).optional(),
  /** With `sort`; missing = ascending. */
  dir: z.enum(["asc", "desc"]).optional(),
});

export type InventorySort = NonNullable<z.output<typeof InventoryListQuerySchema>["sort"]>;

/** Sort options for the phone dropdown (the table's headers sort on wider screens). */
export const INVENTORY_SORT_OPTIONS: { sort: InventorySort; dir: "asc" | "desc"; label: string }[] = [
  { sort: "sku", dir: "asc", label: "SKU A–Z" },
  { sort: "name", dir: "asc", label: "Name A–Z" },
  { sort: "name", dir: "desc", label: "Name Z–A" },
  { sort: "quantity", dir: "asc", label: "Lowest stock first" },
  { sort: "quantity", dir: "desc", label: "Highest stock first" },
  { sort: "price", dir: "asc", label: "Lowest price first" },
  { sort: "price", dir: "desc", label: "Highest price first" },
];

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
