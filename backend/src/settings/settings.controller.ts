import { Body, Controller, Get, Patch } from "@nestjs/common";
import { UpdateShopDetailsSchema, type AuthUser, type ShopDetails } from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { SettingsService, type UpdateShopDetailsData } from "./settings.service";

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Any signed-in user: the invoice page and "call us" messages show them. */
  @Get("shop")
  shop(): Promise<ShopDetails> {
    return this.settings.shop();
  }

  @Patch("shop")
  @Roles("ADMIN")
  updateShop(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(UpdateShopDetailsSchema)) body: UpdateShopDetailsData,
  ): Promise<ShopDetails> {
    return this.settings.updateShop(actor, body);
  }
}
