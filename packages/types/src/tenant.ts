import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "./auth";
import { personName } from "./common";
import { UpdateShopDetailsSchema } from "./settings";

/**
 * Many shops, one deployment. Every record a shop owns carries its shopId and the API scopes
 * every query to the signed-in user's shop. Shops register themselves; a platform admin
 * (role PLATFORM_ADMIN, in no shop) lists and suspends them; customers link to one or more
 * shops and switch between them.
 */

/** A shop as customers pick it (sign-up, "link another shop"). */
export type ShopOption = { id: string; name: string; address: string; phone: string };

/** A shop the signed-in customer is linked to. */
export type MyShop = ShopOption & { current: boolean };

/** Body of POST /shops/register: the shop's details plus its first admin's login. */
export const RegisterShopSchema = UpdateShopDetailsSchema.extend({
  adminFirstName: personName("First name"),
  adminLastName: personName("Last name"),
  adminEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  adminPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
});
export type RegisterShopInput = z.input<typeof RegisterShopSchema>;
export type RegisterShopData = z.output<typeof RegisterShopSchema>;

/** The registration form adds a confirmation field that never reaches the API. */
export const RegisterShopFormSchema = RegisterShopSchema.extend({
  adminConfirmPassword: z.string(),
}).refine((data) => data.adminPassword === data.adminConfirmPassword, {
  message: "Passwords do not match",
  path: ["adminConfirmPassword"],
});

/** Body of POST /auth/switch-shop and POST /auth/shops (link). */
export const ShopIdSchema = z.object({ shopId: z.string().trim().min(1, "Choose a shop") });
export type ShopIdInput = z.input<typeof ShopIdSchema>;

/** A row on the platform admin's shop list. */
export type PlatformShop = {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
  staff: number;
  customers: number;
  /** Work orders checked in during the last 30 days. */
  recentWorkOrders: number;
  /** The shop's first admin, for support contact. */
  admin: { name: string; email: string } | null;
};
