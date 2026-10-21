import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  formatInvoiceNumber,
  normalizePlate,
  parseInvoiceNumber,
  parseWorkOrderNumber,
  type AuthUser,
  type InvoiceDetail,
  type InvoiceListQuery,
  type InvoiceSummary,
  type Paginated,
} from "@motormate/types";
import { writeAudit } from "../common/utils/audit";
import { pageArgs, paginated, searchTokens } from "../common/utils/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { invoiceDetailInclude, invoiceSummaryInclude, toInvoiceDetail, toInvoiceSummary } from "./invoice.mapper";

/**
 * Invoices are issued by completing a work order (WorkOrdersService); here they're listed,
 * read and marked paid. Customers only ever see their own (others → 404).
 */
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: InvoiceListQuery): Promise<Paginated<InvoiceSummary>> {
    const where: Prisma.InvoiceWhereInput = {
      ...this.scope(user),
      ...(query.status ? { status: query.status } : {}),
      AND: searchTokens(query.q).map((token) => {
        const or: Prisma.InvoiceWhereInput[] = [
          { workOrder: { vehicle: { customer: { firstName: { contains: token, mode: "insensitive" } } } } },
          { workOrder: { vehicle: { customer: { lastName: { contains: token, mode: "insensitive" } } } } },
          { workOrder: { vehicle: { make: { contains: token, mode: "insensitive" } } } },
          { workOrder: { vehicle: { model: { contains: token, mode: "insensitive" } } } },
        ];
        // "INV-0003" is an invoice number, "WO-0003" a job number; a bare "3" could be either.
        const invoiceNumber = /^wo/i.test(token) ? null : parseInvoiceNumber(token);
        const workOrderNumber = /^inv/i.test(token) ? null : parseWorkOrderNumber(token);
        if (invoiceNumber !== null) or.push({ number: invoiceNumber });
        if (workOrderNumber !== null) or.push({ workOrder: { number: workOrderNumber } });
        const plate = normalizePlate(token);
        if (plate) or.push({ workOrder: { vehicle: { plateNormalized: { contains: plate } } } });
        return { OR: or };
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, include: invoiceSummaryInclude, orderBy: [{ issuedAt: "desc" }], ...pageArgs(query) }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginated(rows.map(toInvoiceSummary), total, query);
  }

  async findOne(user: AuthUser, id: string): Promise<InvoiceDetail> {
    const row = await this.prisma.invoice.findFirst({ where: { id, ...this.scope(user) }, include: invoiceDetailInclude });
    if (!row) throw new NotFoundException("Invoice not found");
    const paid = row.status === "PAID"
      ? await this.prisma.auditLog.findFirst({
          where: { entity: "Invoice", entityId: id, action: "invoice.paid" },
          orderBy: { createdAt: "desc" },
          select: { actor: { select: { firstName: true, lastName: true } } },
        })
      : null;
    return toInvoiceDetail(row, paid?.actor ? `${paid.actor.firstName} ${paid.actor.lastName}` : null);
  }

  /** Just a flag with who/when — there's no payment integration. */
  async markPaid(actor: AuthUser, id: string): Promise<InvoiceDetail> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, select: { number: true } });
    if (!invoice) throw new NotFoundException("Invoice not found");

    await this.prisma.$transaction(async (tx) => {
      // Conditional, so two clicks can't both "pay" it.
      const { count } = await tx.invoice.updateMany({ where: { id, status: "UNPAID" }, data: { status: "PAID", paidAt: new Date() } });
      if (count === 0) throw new ConflictException(`${formatInvoiceNumber(invoice.number)} is already paid`);
      await writeAudit(tx, { actorId: actor.id, action: "invoice.paid", entity: "Invoice", entityId: id });
    });
    return this.findOne(actor, id);
  }

  private scope(user: AuthUser): Prisma.InvoiceWhereInput {
    return user.role === "CUSTOMER" ? { workOrder: { vehicle: { customerId: user.customerId ?? "__none__" } } } : {};
  }
}
