import { z } from "zod";
import { clearableEmail, QueryBooleanSchema, textWithLetters } from "./common";
import { money } from "./inventory";
import { SHOP } from "./shop";
import { normalizeThaiPhone, ThaiPhoneSchema } from "./thai";

// ── Shop details (Settings → Shop details) ────────────────────────────────────

/** What invoices, the PDF and emails print. Opening hours stay in SHOP (booking rules use them). */
export type ShopDetails = {
  name: string;
  /** One line per row of the printed address. */
  address: string;
  /** E.164, like customer phones. */
  phone: string;
  email: string | null;
  taxId: string;
};

/** Used until the settings row exists (fresh test databases); same values the migration stores. */
export const DEFAULT_SHOP_DETAILS: ShopDetails = {
  name: SHOP.name,
  address: SHOP.address.join("\n"),
  phone: normalizeThaiPhone(SHOP.phone)!,
  email: null,
  taxId: SHOP.taxId,
};

/** The printed address, line by line (blank lines dropped). */
export function shopAddressLines(shop: Pick<ShopDetails, "address">): string[] {
  return shop.address
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Thai tax ID: 13 digits, dashes and spaces allowed ("0-1055-12345-67-8"). */
const TaxIdSchema = z
  .string()
  .trim()
  .min(1, "Tax ID is required")
  .refine((value) => /^[\d\s-]+$/.test(value) && value.replace(/\D/g, "").length === 13, "A Thai tax ID has 13 digits");

export const UpdateShopDetailsSchema = z.object({
  name: textWithLetters("Shop name", { max: 100, required: "Enter the shop's name" }),
  address: z
    .string()
    .trim()
    .min(1, "Enter the address")
    .max(300, "Keep the address under 300 characters")
    .refine((value) => value.split(/\r?\n/).filter((line) => line.trim()).length <= 4, "Use at most 4 lines"),
  phone: ThaiPhoneSchema,
  email: clearableEmail(),
  taxId: TaxIdSchema,
});
export type UpdateShopDetailsInput = z.input<typeof UpdateShopDetailsSchema>;

// ── Price list (Settings → Services & prices) ────────────────────────────────

export type ServiceCatalogEntry = {
  id: string;
  name: string;
  category: string;
  /** THB, excl. VAT. */
  price: number;
  bookable: boolean;
  isActive: boolean;
};

const serviceFields = {
  name: textWithLetters("Service name", { max: 120, required: "Name the service" }),
  category: textWithLetters("Category", { max: 50, required: "Choose a category" }),
  price: money("Price"),
  bookable: z.boolean().default(true),
};

export const CreateServiceSchema = z.object(serviceFields);
export type CreateServiceInput = z.input<typeof CreateServiceSchema>;

/** Every field optional; isActive false = deactivated (services are never deleted). */
export const UpdateServiceSchema = z
  .object({ ...serviceFields, isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");
export type UpdateServiceInput = z.input<typeof UpdateServiceSchema>;

export const ServiceListQuerySchema = z.object({ includeInactive: QueryBooleanSchema });
export type ServiceListQuery = z.output<typeof ServiceListQuerySchema>;

/** Services grouped by category, categories and names A–Z — for pickers. */
export function groupServices<T extends Pick<ServiceCatalogEntry, "category" | "name">>(services: T[]): { category: string; services: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const service of [...services].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))) {
    groups.set(service.category, [...(groups.get(service.category) ?? []), service]);
  }
  return [...groups].map(([category, items]) => ({ category, services: items }));
}
