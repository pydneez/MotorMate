import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from "@nestjs/common";
import {
  ChangePasswordSchema,
  LoginSchema,
  RegisterSchema,
  ShopIdSchema,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type LoginResponse,
  type MyShop,
  type RegisterData,
} from "@motormate/types";
import type { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginInput): Promise<LoginResponse> {
    return this.authService.login(body);
  }

  @Public()
  @Post("register")
  register(@Body(new ZodValidationPipe(RegisterSchema)) body: RegisterData): Promise<LoginResponse> {
    return this.authService.register(body);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  /** Customers: the shops their account is linked to. */
  @Get("shops")
  myShops(@CurrentUser() user: AuthUser): Promise<MyShop[]> {
    return this.authService.myShops(user);
  }

  /** Customers: link their account to another shop, and switch to it. */
  @Post("shops")
  @HttpCode(HttpStatus.OK)
  linkShop(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ShopIdSchema)) body: z.output<typeof ShopIdSchema>,
  ): Promise<LoginResponse> {
    return this.authService.linkShop(user, body.shopId);
  }

  /** Customers: work in another of their shops (returns a token for it). */
  @Post("switch-shop")
  @HttpCode(HttpStatus.OK)
  switchShop(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ShopIdSchema)) body: z.output<typeof ShopIdSchema>,
  ): Promise<LoginResponse> {
    return this.authService.switchShop(user, body.shopId);
  }

  @Patch("me/password")
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    return this.authService.changePassword(user.id, body);
  }
}
