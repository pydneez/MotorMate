import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  CreateServiceSchema,
  ServiceListQuerySchema,
  UpdateServiceSchema,
  type AuthUser,
  type ServiceCatalogEntry,
  type ServiceListQuery,
} from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ServicesService, type CreateServiceData, type UpdateServiceData } from "./services.service";

@Controller("services")
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  /** Everyone signed in; what they see depends on the role (see ServicesService.list). */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(ServiceListQuerySchema)) query: ServiceListQuery): Promise<ServiceCatalogEntry[]> {
    return this.services.list(user, query);
  }

  @Post()
  @Roles("ADMIN")
  create(@CurrentUser() actor: AuthUser, @Body(new ZodValidationPipe(CreateServiceSchema)) body: CreateServiceData): Promise<ServiceCatalogEntry> {
    return this.services.create(actor, body);
  }

  @Patch(":id")
  @Roles("ADMIN")
  update(
    @CurrentUser() actor: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateServiceSchema)) body: UpdateServiceData,
  ): Promise<ServiceCatalogEntry> {
    return this.services.update(actor, id, body);
  }
}
