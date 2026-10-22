import { Injectable } from "@nestjs/common";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { invoicePdfFilename, type AuthUser, type InvoicePdfLink } from "@motormate/types";
import { PrismaService } from "../prisma/prisma.service";
import { renderInvoicePdf } from "./invoice-pdf.renderer";
import { InvoicesService } from "./invoices.service";

/** How long a presigned download link stays valid. */
const LINK_SECONDS = 5 * 60;

/**
 * Invoice PDFs. With INVOICE_BUCKET set (AWS) the PDF is generated on its first download,
 * stored in S3 under `invoices/<invoiceId>/INV-0007.pdf` (its key saved in Invoice.pdfKey),
 * and every download gets a short-lived presigned link to that object. Without a bucket
 * (local development) it's generated each time and returned inline as a data: URL.
 *
 * Access is the invoice's own: staff, or the customer it belongs to (others → 404, via
 * InvoicesService.findOne); mechanics are refused by the controller's @Roles.
 */
@Injectable()
export class InvoicePdfService {
  private readonly bucket = process.env.INVOICE_BUCKET || null;
  private s3Client: S3Client | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  async link(user: AuthUser, id: string): Promise<InvoicePdfLink> {
    const invoice = await this.invoices.findOne(user, id);
    const filename = invoicePdfFilename(invoice.number);

    if (!this.bucket) {
      const pdf = await renderInvoicePdf(invoice);
      return { url: `data:application/pdf;base64,${pdf.toString("base64")}`, filename };
    }

    const stored = await this.prisma.invoice.findUnique({ where: { id }, select: { pdfKey: true } });
    let key = stored?.pdfKey ?? null;
    if (!key || !(await this.exists(key))) {
      key = `invoices/${id}/${filename}`;
      const pdf = await renderInvoicePdf(invoice);
      await this.s3().send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: pdf, ContentType: "application/pdf" }),
      );
      // Two first downloads at once both upload the same key — harmless; the column is set once.
      await this.prisma.invoice.updateMany({ where: { id, pdfKey: null }, data: { pdfKey: key } });
    }

    const url = await getSignedUrl(
      this.s3(),
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn: LINK_SECONDS },
    );
    return { url, filename };
  }

  /** The stored object can be gone (e.g. bucket emptied); then it's generated again. */
  private async exists(key: string): Promise<boolean> {
    try {
      await this.s3().send(new HeadObjectCommand({ Bucket: this.bucket!, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return false;
      throw error;
    }
  }

  /** Created on first use; on ECS it picks up the task role's credentials and region. */
  private s3(): S3Client {
    this.s3Client ??= new S3Client({});
    return this.s3Client;
  }
}
