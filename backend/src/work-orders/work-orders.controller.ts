import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  AddLabourSchema,
  AddPartSchema,
  AddRecommendationSchema,
  AssignMechanicSchema,
  ChangeWorkOrderStatusSchema,
  CreateWorkOrderSchema,
  UpdateWorkOrderDetailsSchema,
  WalkInCheckInSchema,
  WorkOrderListQuerySchema,
  type AuthUser,
  type MechanicOption,
  type Paginated,
  type WorkOrderCounts,
  type WorkOrderDetail,
  type WorkOrderListQuery,
  type WorkOrderSummary,
} from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  WorkOrdersService,
  type AddLabourData,
  type AddPartData,
  type AddRecommendationData,
  type AssignMechanicData,
  type ChangeWorkOrderStatusData,
  type CreateWorkOrderData,
  type UpdateWorkOrderDetailsData,
  type WalkInCheckInData,
} from "./work-orders.service";

/**
 * Staff only. Customers follow their car's status on their vehicle page instead.
 * Fine-grained rules (assigned mechanic, staff-only moves) live in the service.
 */
@Roles("ADMIN", "ADVISOR", "MECHANIC")
@Controller("work-orders")
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(WorkOrderListQuerySchema)) query: WorkOrderListQuery,
  ): Promise<Paginated<WorkOrderSummary>> {
    return this.workOrders.list(user, query);
  }

  // Fixed paths are declared before ":id" so they aren't treated as ids.
  @Get("counts")
  counts(@CurrentUser() user: AuthUser): Promise<WorkOrderCounts> {
    return this.workOrders.counts(user);
  }

  @Get("mechanics")
  @Roles("ADMIN", "ADVISOR")
  mechanics(): Promise<MechanicOption[]> {
    return this.workOrders.mechanics();
  }

  /** New (or existing) customer + new vehicle + work order in one go, for walk-ins. */
  @Post("walk-in")
  @Roles("ADMIN", "ADVISOR")
  walkIn(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(WalkInCheckInSchema)) body: WalkInCheckInData,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.walkIn(user, body);
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<WorkOrderDetail> {
    return this.workOrders.findOne(id);
  }

  @Post()
  @Roles("ADMIN", "ADVISOR")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateWorkOrderSchema)) body: CreateWorkOrderData,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.create(user, body);
  }

  @Patch(":id")
  updateDetails(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateWorkOrderDetailsSchema)) body: UpdateWorkOrderDetailsData,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.updateDetails(user, id, body);
  }

  @Patch(":id/mechanic")
  @Roles("ADMIN", "ADVISOR")
  assignMechanic(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AssignMechanicSchema)) body: AssignMechanicData,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.assignMechanic(user, id, body);
  }

  @Post(":id/status")
  @HttpCode(HttpStatus.OK)
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ChangeWorkOrderStatusSchema)) body: ChangeWorkOrderStatusData,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.changeStatus(user, id, body);
  }

  @Post(":id/labour")
  addLabour(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AddLabourSchema)) body: AddLabourData,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.addLabour(user, id, body);
  }

  @Delete(":id/labour/:itemId")
  removeLabour(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("itemId") itemId: string): Promise<WorkOrderDetail> {
    return this.workOrders.removeLabour(user, id, itemId);
  }

  @Post(":id/parts")
  addPart(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AddPartSchema)) body: AddPartData,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.addPart(user, id, body);
  }

  @Delete(":id/parts/:partId")
  removePart(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("partId") partId: string): Promise<WorkOrderDetail> {
    return this.workOrders.removePart(user, id, partId);
  }

  @Post(":id/recommendations")
  addRecommendation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AddRecommendationSchema)) body: AddRecommendationData,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.addRecommendation(user, id, body);
  }

  @Delete(":id/recommendations/:recommendationId")
  removeRecommendation(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("recommendationId") recommendationId: string,
  ): Promise<WorkOrderDetail> {
    return this.workOrders.removeRecommendation(user, id, recommendationId);
  }
}
