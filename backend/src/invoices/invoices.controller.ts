import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import {
  InvoiceListQuerySchema,
  type AuthUser,
  type InvoiceDetail,
  type InvoiceListQuery,
  type InvoicePdfLink,
  type InvoiceSummary,
  type Paginated,
} from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { InvoicePdfService } from "./invoice-pdf.service";
import { InvoicesService } from "./invoices.service";

/** Advisors/admins see every invoice; customers their own (scoped in the service). */
@Roles("ADMIN", "ADVISOR", "CUSTOMER")
@Controller("invoices")
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly pdfs: InvoicePdfService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(InvoiceListQuerySchema)) query: InvoiceListQuery,
  ): Promise<Paginated<InvoiceSummary>> {
    return this.invoices.list(user, query);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<InvoiceDetail> {
    return this.invoices.findOne(user, id);
  }

  /** A link that downloads the invoice as a PDF (see InvoicePdfService). */
  @Get(":id/pdf")
  pdf(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<InvoicePdfLink> {
    return this.pdfs.link(user, id);
  }

  @Post(":id/pay")
  @Roles("ADMIN", "ADVISOR")
  @HttpCode(HttpStatus.OK)
  markPaid(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<InvoiceDetail> {
    return this.invoices.markPaid(user, id);
  }
}
