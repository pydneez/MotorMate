import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  LoginSchema,
  RegisterSchema,
  type AuthUser,
  type LoginInput,
  type LoginResponse,
  type RegisterData,
} from "@motormate/types";
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
}
