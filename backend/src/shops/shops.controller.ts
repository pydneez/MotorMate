import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { RegisterShopSchema, type AuthUser, type PlatformShop, type RegisterShopData, type ShopOption } from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ShopsService } from "./shops.service";

@Controller("shops")
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  /** Public: the open shops customers can pick at sign-up or link to. */
  @Public()
  @Get()
  list(): Promise<ShopOption[]> {
    return this.shops.list();
  }

  /** Public: a garage registers itself and its first admin. */
  @Public()
  @Post("register")
  register(@Body(new ZodValidationPipe(RegisterShopSchema)) body: RegisterShopData): Promise<ShopOption> {
    return this.shops.register(body);
  }
}

/** The platform admin's view of all shops. */
@Controller("platform/shops")
@Roles("PLATFORM_ADMIN")
export class PlatformController {
  constructor(private readonly shops: ShopsService) {}

  @Get()
  list(): Promise<PlatformShop[]> {
    return this.shops.platformList();
  }

  @Post(":id/suspend")
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentUser() actor: AuthUser, @Param("id") id: string): Promise<PlatformShop> {
    return this.shops.setActive(actor, id, false);
  }

  @Post(":id/reactivate")
  @HttpCode(HttpStatus.OK)
  reactivate(@CurrentUser() actor: AuthUser, @Param("id") id: string): Promise<PlatformShop> {
    return this.shops.setActive(actor, id, true);
  }
}
