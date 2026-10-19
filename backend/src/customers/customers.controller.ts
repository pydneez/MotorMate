import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  CreateCustomerSchema,
  CustomerDuplicateQuerySchema,
  ListQuerySchema,
  MergeCustomerSchema,
  UpdateCustomerSchema,
  UpdateOwnCustomerSchema,
  type AuthUser,
  type CustomerDetail,
  type CustomerDuplicateQuery,
  type CustomerDuplicates,
  type CustomerSummary,
  type ListQuery,
  type MergeCustomerInput,
  type Paginated,
} from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  CustomersService,
  type CreateCustomerData,
  type UpdateCustomerData,
  type UpdateOwnCustomerData,
} from "./customers.service";

@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  // "me" and "duplicates" are declared before ":id" so they aren't treated as ids.

  @Get("me")
  @Roles("CUSTOMER")
  findOwn(@CurrentUser() user: AuthUser): Promise<CustomerDetail> {
    return this.customers.findOwn(user);
  }

  @Patch("me")
  @Roles("CUSTOMER")
  updateOwn(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateOwnCustomerSchema)) body: UpdateOwnCustomerData,
  ): Promise<CustomerSummary> {
    return this.customers.updateOwn(user, body);
  }

  @Get("duplicates")
  @Roles("ADMIN", "ADVISOR")
  duplicates(
    @Query(new ZodValidationPipe(CustomerDuplicateQuerySchema)) query: CustomerDuplicateQuery,
  ): Promise<CustomerDuplicates> {
    return this.customers.duplicates(query);
  }

  @Get()
  @Roles("ADMIN", "ADVISOR")
  list(@Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery): Promise<Paginated<CustomerSummary>> {
    return this.customers.list(query);
  }

  @Get(":id")
  @Roles("ADMIN", "ADVISOR")
  findOne(@Param("id") id: string): Promise<CustomerDetail> {
    return this.customers.findOne(id);
  }

  @Post()
  @Roles("ADMIN", "ADVISOR")
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateCustomerSchema)) body: CreateCustomerData,
  ): Promise<CustomerSummary> {
    return this.customers.create(actor, body);
  }

  @Patch(":id")
  @Roles("ADMIN", "ADVISOR")
  update(
    @CurrentUser() actor: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateCustomerSchema)) body: UpdateCustomerData,
  ): Promise<CustomerSummary> {
    return this.customers.update(actor, id, body);
  }

  /** Merge another customer (same phone) into this one, then remove it. */
  @Post(":id/merge")
  @Roles("ADMIN", "ADVISOR")
  @HttpCode(HttpStatus.OK)
  merge(
    @CurrentUser() actor: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(MergeCustomerSchema)) body: MergeCustomerInput,
  ): Promise<CustomerDetail> {
    return this.customers.merge(actor, id, body.sourceId);
  }
}
