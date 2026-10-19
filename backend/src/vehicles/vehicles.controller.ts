import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  CreateVehicleSchema,
  ListQuerySchema,
  MileageCorrectionSchema,
  UpdateVehicleSchema,
  VehicleDuplicateQuerySchema,
  type AuthUser,
  type ListQuery,
  type Paginated,
  type VehicleDetail,
  type VehicleDuplicateQuery,
  type VehicleDuplicates,
  type VehicleSummary,
} from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  VehiclesService,
  type CreateVehicleData,
  type MileageCorrectionData,
  type UpdateVehicleData,
} from "./vehicles.service";

/**
 * Reads are open to every role (customers are scoped to their own vehicles in the
 * service); writes are restricted per route.
 */
@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery,
  ): Promise<Paginated<VehicleSummary>> {
    return this.vehicles.list(user, query);
  }

  // Declared before ":id" so "duplicates" isn't treated as an id.
  @Get("duplicates")
  @Roles("ADMIN", "ADVISOR", "CUSTOMER")
  duplicates(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(VehicleDuplicateQuerySchema)) query: VehicleDuplicateQuery,
  ): Promise<VehicleDuplicates> {
    return this.vehicles.duplicates(user, query);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<VehicleDetail> {
    return this.vehicles.findOne(user, id);
  }

  @Post()
  @Roles("ADMIN", "ADVISOR", "CUSTOMER")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateVehicleSchema)) body: CreateVehicleData,
  ): Promise<VehicleSummary> {
    return this.vehicles.create(user, body);
  }

  @Patch(":id")
  @Roles("ADMIN", "ADVISOR")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateVehicleSchema)) body: UpdateVehicleData,
  ): Promise<VehicleSummary> {
    return this.vehicles.update(user, id, body);
  }

  @Post(":id/mileage-correction")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  correctMileage(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(MileageCorrectionSchema)) body: MileageCorrectionData,
  ): Promise<VehicleSummary> {
    return this.vehicles.correctMileage(user, id, body);
  }
}
