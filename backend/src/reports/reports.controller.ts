import { BadRequestException, Controller, Get, Header, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { REPORT_EXPORTS, ReportQuerySchema, reportCsvFilename, type ReportExport, type ReportQuery, type ReportSummary } from "@motormate/types";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ReportsService } from "./reports.service";

@Roles("ADMIN")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("summary")
  summary(@Query(new ZodValidationPipe(ReportQuerySchema)) query: ReportQuery): Promise<ReportSummary> {
    return this.reports.summary(query);
  }

  @Get("export/:kind")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async export(
    @Param("kind") kind: string,
    @Query(new ZodValidationPipe(ReportQuerySchema)) query: ReportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    if (!(REPORT_EXPORTS as readonly string[]).includes(kind)) throw new BadRequestException(`Unknown export "${kind}"`);
    const csv = await this.csv(kind as ReportExport, query);
    res.setHeader("Content-Disposition", `attachment; filename="${reportCsvFilename(kind as ReportExport, query)}"`);
    return csv;
  }

  private csv(kind: ReportExport, query: ReportQuery): Promise<string> {
    if (kind === "invoices") return this.reports.invoicesCsv(query);
    if (kind === "work-orders") return this.reports.workOrdersCsv(query);
    return this.reports.partsCsv(query);
  }
}