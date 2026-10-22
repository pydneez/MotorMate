import { HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import type { InvoiceDetail } from "@motormate/types";
import { createPrismaMock, makeAuthUser } from "../../test/prisma-mock";
import { renderInvoicePdf } from "./invoice-pdf.renderer";
import { InvoicePdfService } from "./invoice-pdf.service";
import type { InvoicesService } from "./invoices.service";

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://bucket.s3.amazonaws.com/signed"),
}));

const advisor = makeAuthUser({ id: "advisor-1", role: "ADVISOR" });

const invoice: InvoiceDetail = {
  id: "inv-7",
  number: 7,
  status: "UNPAID",
  total: 2140,
  issuedAt: "2026-10-20T07:00:00.000Z",
  paidAt: null,
  workOrder: { id: "wo-3", number: 3 },
  customer: { id: "cust-1", name: "สมชาย ใจดี", phone: "+66812345678", email: null },
  vehicle: { id: "veh-1", plate: "1กข 1234", province: "กรุงเทพมหานคร", make: "Honda", model: "Civic", year: 2019, vin: "VIN000001" },
  mileageIn: 42000,
  workPerformed: "เปลี่ยนน้ำมันเครื่อง / oil change",
  labour: [{ id: "l1", description: "Oil change", laborCost: 500 }],
  parts: [{ id: "p1", inventoryItemId: "i1", sku: "OIL-5W30", name: "Engine oil 5W-30", quantity: 4, unitPrice: 375, lineTotal: 1500 }],
  subtotal: 2000,
  vatRate: 0.07,
  vat: 140,
  paidBy: null,
};

describe("renderInvoicePdf", () => {
  it("renders a PDF titled with the invoice number, Thai text included", async () => {
    const pdf = await renderInvoicePdf(invoice);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("INV-0007");
    // The Thai font is embedded (subset), not left to the reader's machine.
    expect(pdf.toString("latin1")).toMatch(/Sarabun/);
  });

  it("spills long invoices onto further pages", async () => {
    const parts = Array.from({ length: 60 }, (_, i) => ({ ...invoice.parts[0], id: `p${i}` }));
    const pdf = await renderInvoicePdf({ ...invoice, parts });
    const pages = pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
  });
});

describe("InvoicePdfService", () => {
  const original = process.env.INVOICE_BUCKET;
  afterEach(() => {
    process.env.INVOICE_BUCKET = original;
    jest.restoreAllMocks();
  });

  function setup(bucket: string | undefined) {
    if (bucket) process.env.INVOICE_BUCKET = bucket;
    else delete process.env.INVOICE_BUCKET;
    const { prisma, service } = createPrismaMock();
    const invoices = { findOne: jest.fn().mockResolvedValue(invoice) } as unknown as InvoicesService;
    // S3Client.send is heavily overloaded; a loosely typed mock is enough here.
    const send = jest.spyOn(S3Client.prototype, "send") as unknown as jest.Mock;
    send.mockResolvedValue({});
    return { prisma, invoices, send, pdfs: new InvoicePdfService(service, invoices) };
  }

  it("without a bucket, returns the PDF inline and touches neither S3 nor the database", async () => {
    const { prisma, send, pdfs } = setup(undefined);
    const link = await pdfs.link(advisor, "inv-7");

    expect(link.filename).toBe("INV-0007.pdf");
    expect(link.url.startsWith("data:application/pdf;base64,JVBERi0")).toBe(true); // "%PDF-"
    expect(send).not.toHaveBeenCalled();
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("stores the PDF on first download, then links to it", async () => {
    const { prisma, send, pdfs } = setup("motormate-invoices-test");
    prisma.invoice.findUnique.mockResolvedValue({ pdfKey: null });

    const link = await pdfs.link(advisor, "inv-7");

    const put = send.mock.calls.map(([command]) => command).find((c) => c instanceof PutObjectCommand) as PutObjectCommand;
    expect(put.input).toEqual(expect.objectContaining({ Bucket: "motormate-invoices-test", Key: "invoices/inv-7/INV-0007.pdf", ContentType: "application/pdf" }));
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({ where: { id: "inv-7", pdfKey: null }, data: { pdfKey: "invoices/inv-7/INV-0007.pdf" } });
    expect(link).toEqual({ url: "https://bucket.s3.amazonaws.com/signed", filename: "INV-0007.pdf" });
  });

  it("reuses the stored PDF instead of generating it again", async () => {
    const { prisma, send, pdfs } = setup("motormate-invoices-test");
    prisma.invoice.findUnique.mockResolvedValue({ pdfKey: "invoices/inv-7/INV-0007.pdf" });

    await pdfs.link(advisor, "inv-7");

    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([HeadObjectCommand]);
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("generates it again when the stored object is gone", async () => {
    const { prisma, send, pdfs } = setup("motormate-invoices-test");
    prisma.invoice.findUnique.mockResolvedValue({ pdfKey: "invoices/inv-7/INV-0007.pdf" });
    send.mockRejectedValueOnce(
      new S3ServiceException({ name: "NotFound", $fault: "client", $metadata: { httpStatusCode: 404 } }),
    );

    await pdfs.link(advisor, "inv-7");

    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([HeadObjectCommand, PutObjectCommand]);
  });

  it("checks access through the invoice itself (404 for someone else's)", async () => {
    const { invoices, pdfs } = setup(undefined);
    (invoices.findOne as jest.Mock).mockRejectedValue(new Error("Invoice not found"));
    await expect(pdfs.link(makeAuthUser({ role: "CUSTOMER", customerId: "other" }), "inv-7")).rejects.toThrow("Invoice not found");
  });
});
