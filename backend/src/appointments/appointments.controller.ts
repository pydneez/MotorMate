import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  AppointmentListQuerySchema,
  CancelAppointmentSchema,
  CreateAppointmentSchema,
  RescheduleAppointmentSchema,
  type AppointmentCounts,
  type AppointmentListQuery,
  type AppointmentSummary,
  type AuthUser,
  type Paginated,
} from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  AppointmentsService,
  type CancelAppointmentData,
  type CreateAppointmentData,
  type RescheduleAppointmentData,
} from "./appointments.service";

/** Staff see and manage every appointment; customers book and manage their own. Mechanics: none. */
@Roles("ADMIN", "ADVISOR", "CUSTOMER")
@Controller("appointments")
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(AppointmentListQuerySchema)) query: AppointmentListQuery,
  ): Promise<Paginated<AppointmentSummary>> {
    return this.appointments.list(user, query);
  }

  @Get("counts")
  @Roles("ADMIN", "ADVISOR")
  counts(): Promise<AppointmentCounts> {
    return this.appointments.counts();
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<AppointmentSummary> {
    return this.appointments.findOne(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateAppointmentSchema)) body: CreateAppointmentData,
  ): Promise<AppointmentSummary> {
    return this.appointments.create(user, body);
  }

  @Patch(":id")
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RescheduleAppointmentSchema)) body: RescheduleAppointmentData,
  ): Promise<AppointmentSummary> {
    return this.appointments.reschedule(user, id, body);
  }

  @Post(":id/confirm")
  @Roles("ADMIN", "ADVISOR")
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<AppointmentSummary> {
    return this.appointments.confirm(user, id);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CancelAppointmentSchema)) body: CancelAppointmentData,
  ): Promise<AppointmentSummary> {
    return this.appointments.cancel(user, id, body);
  }

  @Post(":id/no-show")
  @Roles("ADMIN", "ADVISOR")
  @HttpCode(HttpStatus.OK)
  noShow(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<AppointmentSummary> {
    return this.appointments.noShow(user, id);
  }
}
