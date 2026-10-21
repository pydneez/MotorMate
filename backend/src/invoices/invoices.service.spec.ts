import { ConflictException, NotFoundException } from "@nestjs/common";
import { createPrismaMock, makeAuthUser } from "../../test/prisma-mock";
import { InvoicesService } from "./invoices.service";

const advisor = makeAuthUser({ id: "advisor-1", role: "ADVISOR" });
const customer = makeAuthUser({ id: "user-c", role: "CUSTOMER", customerId: "cust-1" });

function setup() {
  const { prisma, service } = createPrismaMock();
  const invoices = new InvoicesService(service);
  jest.spyOn(invoices, "findOne").mockResolvedValue({} as never);
  return { prisma, invoices };
}

describe("InvoicesService", () => {
  it("scopes a customer's list to their own vehicles", async () => {
    const { prisma, invoices } = setup();
    await invoices.list(customer, { page: 1, pageSize: 20 });

    expect(prisma.invoice.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ workOrder: { vehicle: { customerId: "cust-1" } } }),
    );
  });

  it("finds by invoice number, job number or plate", async () => {
    const { prisma, invoices } = setup();
    await invoices.list(advisor, { q: "INV-0007", page: 1, pageSize: 20 });
    await invoices.list(advisor, { q: "WO-0003", page: 1, pageSize: 20 });

    const [byInvoice, byJob] = prisma.invoice.findMany.mock.calls.map((call) => call[0].where.AND[0].OR);
    expect(byInvoice).toContainEqual({ number: 7 });
    expect(byInvoice).not.toContainEqual({ workOrder: { number: 7 } });
    expect(byJob).toContainEqual({ workOrder: { number: 3 } });
    expect(byJob).not.toContainEqual({ number: 3 });
  });

  it("returns not found for someone else's invoice", async () => {
    const { prisma } = setup();
    const invoices = new InvoicesService(prisma as never);
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(invoices.findOne(customer, "inv-9")).rejects.toThrow(NotFoundException);
    expect(prisma.invoice.findFirst.mock.calls[0][0].where).toEqual({ id: "inv-9", workOrder: { vehicle: { customerId: "cust-1" } } });
  });

  it("marks an unpaid invoice paid once, with an audit entry", async () => {
    const { prisma, invoices } = setup();
    prisma.invoice.findUnique.mockResolvedValue({ number: 7 });
    prisma.invoice.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await invoices.markPaid(advisor, "inv-7");
    expect(prisma.invoice.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "inv-7", status: "UNPAID" },
      data: { status: "PAID", paidAt: expect.any(Date) },
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ action: "invoice.paid", actorId: "advisor-1" }));

    await expect(invoices.markPaid(advisor, "inv-7")).rejects.toThrow(new ConflictException("INV-0007 is already paid"));
  });
});
