import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  CreateInventoryItemSchema,
  InventoryListQuerySchema,
  ReceiveStockSchema,
  StocktakeSchema,
  UpdateInventoryItemSchema,
  type AuthUser,
  type InventoryItemDetail,
  type InventoryItemSummary,
  type InventoryListQuery,
  type InventorySummary,
  type Paginated,
} from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  InventoryService,
  type CreateInventoryItemData,
  type ReceiveStockData,
  type StocktakeData,
  type UpdateInventoryItemData,
} from "./inventory.service";

/**
 * Staff only. Mechanics can look things up; admins and advisors manage the catalogue and
 * stock. Mechanics' stock usage happens through work orders (Step 4).
 */
@Roles("ADMIN", "ADVISOR", "MECHANIC")
@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(InventoryListQuerySchema)) query: InventoryListQuery,
  ): Promise<Paginated<InventoryItemSummary>> {
    return this.inventory.list(query);
  }

  // Fixed paths are declared before ":id" so they aren't treated as ids.
  @Get("categories")
  categories(): Promise<string[]> {
    return this.inventory.categories();
  }

  @Get("summary")
  @Roles("ADMIN", "ADVISOR")
  summary(): Promise<InventorySummary> {
    return this.inventory.summary();
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<InventoryItemDetail> {
    return this.inventory.findOne(id);
  }

  @Post()
  @Roles("ADMIN", "ADVISOR")
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateInventoryItemSchema)) body: CreateInventoryItemData,
  ): Promise<InventoryItemSummary> {
    return this.inventory.create(actor, body);
  }

  @Patch(":id")
  @Roles("ADMIN", "ADVISOR")
  update(
    @CurrentUser() actor: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateInventoryItemSchema)) body: UpdateInventoryItemData,
  ): Promise<InventoryItemSummary> {
    return this.inventory.update(actor, id, body);
  }

  @Post(":id/receive")
  @Roles("ADMIN", "ADVISOR")
  @HttpCode(HttpStatus.OK)
  receive(
    @CurrentUser() actor: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ReceiveStockSchema)) body: ReceiveStockData,
  ): Promise<InventoryItemSummary> {
    return this.inventory.receive(actor, id, body);
  }

  @Post(":id/stocktake")
  @Roles("ADMIN", "ADVISOR")
  @HttpCode(HttpStatus.OK)
  stocktake(
    @CurrentUser() actor: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(StocktakeSchema)) body: StocktakeData,
  ): Promise<InventoryItemSummary> {
    return this.inventory.stocktake(actor, id, body);
  }

  @Post(":id/deactivate")
  @Roles("ADMIN", "ADVISOR")
  @HttpCode(HttpStatus.OK)
  deactivate(@CurrentUser() actor: AuthUser, @Param("id") id: string): Promise<InventoryItemSummary> {
    return this.inventory.setActive(actor, id, false);
  }

  @Post(":id/reactivate")
  @Roles("ADMIN", "ADVISOR")
  @HttpCode(HttpStatus.OK)
  reactivate(@CurrentUser() actor: AuthUser, @Param("id") id: string): Promise<InventoryItemSummary> {
    return this.inventory.setActive(actor, id, true);
  }
}
