import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  normalizePlate,
  normalizeThaiPhone,
  type AuthUser,
  type CreateCustomerSchema,
  type CustomerDetail,
  type CustomerDuplicateQuery,
  type CustomerDuplicates,
  type CustomerSummary,
  type ListQuery,
  type Paginated,
  type UpdateCustomerSchema,
  type UpdateOwnCustomerSchema,
} from "@motormate/types";
import type { z } from "zod";
import { diffFields, writeAudit } from "../common/utils/audit";
import { pageArgs, paginated, searchTokens } from "../common/utils/pagination";
import { phoneSearchFragment } from "../common/utils/phone-search";
import { PrismaService } from "../prisma/prisma.service";
import { toVehicleSummary, vehicleSummaryInclude } from "../vehicles/vehicle.mapper";

export type CreateCustomerData = z.output<typeof CreateCustomerSchema>;
export type UpdateCustomerData = z.output<typeof UpdateCustomerSchema>;
export type UpdateOwnCustomerData = z.output<typeof UpdateOwnCustomerSchema>;

const summaryInclude = { _count: { select: { vehicles: true } } } satisfies Prisma.CustomerInclude;

type CustomerWithCount = Prisma.CustomerGetPayload<{ include: typeof summaryInclude }>;

function toSummary({ _count, ...customer }: CustomerWithCount): CustomerSummary {
  return { ...customer, vehicleCount: _count.vehicles, hasPortalAccount: customer.userId !== null };
}

/** One search word matched against every searchable customer field, including their vehicles. */
function tokenFilter(token: string): Prisma.CustomerWhereInput {
  const or: Prisma.CustomerWhereInput[] = [
    { firstName: { contains: token, mode: "insensitive" } },
    { lastName: { contains: token, mode: "insensitive" } },
    { email: { contains: token, mode: "insensitive" } },
    { lineId: { contains: token, mode: "insensitive" } },
    { vehicles: { some: { vin: { contains: token.toUpperCase() } } } },
  ];
  const phone = phoneSearchFragment(token);
  if (phone) or.push({ phone: { contains: phone } });
  const plate = normalizePlate(token);
  if (plate) or.push({ vehicles: { some: { plateNormalized: { contains: plate } } } });
  return { OR: or };
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQuery): Promise<Paginated<CustomerSummary>> {
    const where: Prisma.CustomerWhereInput = { AND: searchTokens(query.q).map(tokenFilter) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: summaryInclude,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        ...pageArgs(query),
      }),
      this.prisma.customer.count({ where }),
    ]);
    return paginated(rows.map(toSummary), total, query);
  }

  async findOne(id: string): Promise<CustomerDetail> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { ...summaryInclude, vehicles: { include: vehicleSummaryInclude, orderBy: { createdAt: "asc" } } },
    });
    if (!customer) throw new NotFoundException("Customer not found");
    const { vehicles, ...rest } = customer;
    return { ...toSummary(rest), vehicles: vehicles.map(toVehicleSummary) };
  }

  async create(actor: AuthUser, input: CreateCustomerData): Promise<CustomerSummary> {
    if (input.email) await this.assertEmailFree(input.email);
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({ data: input, include: summaryInclude });
      await writeAudit(tx, { actorId: actor.id, action: "customer.created", entity: "Customer", entityId: customer.id });
      return toSummary(customer);
    });
  }

  async update(actor: AuthUser, id: string, input: UpdateCustomerData): Promise<CustomerSummary> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException("Customer not found");

    const emailChanged = input.email !== undefined && input.email !== customer.email;
    if (emailChanged && !input.email && customer.userId) {
      throw new BadRequestException({
        message: "This customer signs in to the portal with their email, so it can't be removed",
        errors: { email: ["Required for customers with a portal account"] },
      });
    }
    if (emailChanged && input.email) await this.assertEmailFree(input.email, id, customer.userId);
    const changes = diffFields(customer, input);
    if (Object.keys(changes).length === 0) return this.summary(id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({ where: { id }, data: input, include: summaryInclude });
      // A portal customer signs in with this email, so keep their login in step.
      if (emailChanged && input.email && customer.userId) {
        await tx.user.update({ where: { id: customer.userId }, data: { email: input.email } });
      }
      await writeAudit(tx, { actorId: actor.id, action: "customer.updated", entity: "Customer", entityId: id, changes });
      return toSummary(updated);
    });
  }

  /** Possible duplicates for the warning shown before saving. Never throws on a match. */
  async duplicates(query: CustomerDuplicateQuery): Promise<CustomerDuplicates> {
    const exclude = query.excludeId ? { id: { not: query.excludeId } } : {};
    const phone = query.phone ? normalizeThaiPhone(query.phone) : null;

    const [byPhone, byEmail] = await Promise.all([
      phone
        ? this.prisma.customer.findMany({ where: { phone, ...exclude }, include: summaryInclude, take: 5 })
        : Promise.resolve([]),
      query.email
        ? this.prisma.customer.findFirst({ where: { email: query.email, ...exclude }, include: summaryInclude })
        : Promise.resolve(null),
    ]);
    return { byPhone: byPhone.map(toSummary), byEmail: byEmail ? toSummary(byEmail) : null };
  }

  /** GET /customers/me — the signed-in customer's own record. */
  async findOwn(user: AuthUser): Promise<CustomerDetail> {
    if (!user.customerId) throw new NotFoundException("Your account isn't linked to a customer profile");
    return this.findOne(user.customerId);
  }

  /** PATCH /customers/me — phone and LINE ID only (the schema rejects anything else). */
  async updateOwn(user: AuthUser, input: UpdateOwnCustomerData): Promise<CustomerSummary> {
    if (!user.customerId) throw new NotFoundException("Your account isn't linked to a customer profile");
    return this.update(user, user.customerId, input);
  }

  private async summary(id: string): Promise<CustomerSummary> {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id }, include: summaryInclude });
    return toSummary(customer);
  }

  /** Customer emails are unique, and a portal customer's email is also their login. */
  private async assertEmailFree(email: string, excludeCustomerId?: string, excludeUserId?: string | null): Promise<void> {
    const [customer, user] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { email, ...(excludeCustomerId ? { id: { not: excludeCustomerId } } : {}) },
        select: { id: true },
      }),
      excludeUserId
        ? this.prisma.user.findFirst({ where: { email, id: { not: excludeUserId } }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    if (customer || user) {
      throw new ConflictException({
        message: "Another customer already uses this email",
        errors: { email: ["Another customer already uses this email"] },
        ...(customer ? { customerId: customer.id } : {}),
      });
    }
  }
}
