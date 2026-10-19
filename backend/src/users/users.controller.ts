import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  CreateStaffSchema,
  ResetPasswordSchema,
  StaffListQuerySchema,
  UpdateStaffSchema,
  type AuthUser,
  type Paginated,
  type StaffListQuery,
  type StaffUser,
} from "@motormate/types";
import type { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { UsersService } from "./users.service";

@Roles("ADMIN")
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query(new ZodValidationPipe(StaffListQuerySchema)) query: StaffListQuery): Promise<Paginated<StaffUser>> {
    return this.users.list(query);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateStaffSchema)) body: z.output<typeof CreateStaffSchema>,
  ): Promise<StaffUser> {
    return this.users.create(actor, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() actor: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateStaffSchema)) body: z.output<typeof UpdateStaffSchema>,
  ): Promise<StaffUser> {
    return this.users.update(actor, id, body);
  }

  @Post(":id/deactivate")
  @HttpCode(HttpStatus.OK)
  deactivate(@CurrentUser() actor: AuthUser, @Param("id") id: string): Promise<StaffUser> {
    return this.users.deactivate(actor, id);
  }

  @Post(":id/reactivate")
  @HttpCode(HttpStatus.OK)
  reactivate(@CurrentUser() actor: AuthUser, @Param("id") id: string): Promise<StaffUser> {
    return this.users.reactivate(actor, id);
  }

  @Post(":id/reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ResetPasswordSchema)) body: z.output<typeof ResetPasswordSchema>,
  ): Promise<void> {
    return this.users.resetPassword(actor, id, body);
  }
}
