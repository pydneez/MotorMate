import * as path from "node:path";
// CommonJS export (no `default`), and the backend doesn't enable esModuleInterop.
import PDFDocument = require("pdfkit");
import {
  formatInvoiceNumber,
  formatThaiPhone,
  formatWorkOrderNumber,
  SHOP,
  type InvoiceDetail,
} from "@motormate/types";

/**
 * The invoice as a PDF — the same content and amounts as the invoice page
 * (frontend/app/app/invoices/[id]/page.tsx), frozen at completion. It shows the invoice as
 * issued, with no paid stamp, so a stored copy never goes out of date; payment status lives
 * in the app.
 *
 * Sarabun (SIL Open Font License, assets/fonts/OFL.txt) is embedded so Thai names, plates
 * and provinces render; PDFs have no Thai glyphs of their own.
 */
const FONTS = path.join(__dirname, "..", "..", "assets", "fonts");
const REGULAR = path.join(FONTS, "Sarabun-Regular.ttf");
const BOLD = path.join(FONTS, "Sarabun-Bold.ttf");

const MARGIN = 50;
const GREY = "#475569";
const LIGHT = "#94a3b8";
const RULE = "#e2e8f0";
const TIME_ZONE = "Asia/Bangkok";

// Same formats as frontend/lib/format.ts.
const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE }).format(new Date(value));
const formatTHB = (amount: number) =>
  `฿${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatKm = (km: number) => `${km.toLocaleString("en-US")} km`;

export function renderInvoicePdf(invoice: InvoiceDetail): Promise<Buffer> {
  const number = formatInvoiceNumber(invoice.number);
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: { Title: number, Author: SHOP.name, Subject: `Invoice ${number}` },
  });
  doc.registerFont("regular", REGULAR);
  doc.registerFont("bold", BOLD);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = MARGIN;
  const right = doc.page.width - MARGIN;
  const width = right - left;
  const rule = (y: number) => doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
  const label = (text: string, x: number, y: number) =>
    doc.font("bold").fontSize(8).fillColor(LIGHT).text(text.toUpperCase(), x, y, { characterSpacing: 0.5 });

  // ── Shop and invoice number ────────────────────────────────────────────────
  let y = MARGIN;
  doc.font("bold").fontSize(16).fillColor("black").text(SHOP.name, left, y);
  doc.font("regular").fontSize(10).fillColor(GREY);
  for (const line of SHOP.address) doc.text(line);
  doc.text(`Tel. ${SHOP.phone} · Tax ID ${SHOP.taxId}`);
  const shopBottom = doc.y;

  doc.font("bold").fontSize(16).fillColor("black").text("Invoice", left, y, { width, align: "right" });
  doc.font("bold").fontSize(11).text(number, { width, align: "right" });
  doc.font("regular").fontSize(10).fillColor(GREY);
  doc.text(`Issued ${formatDate(invoice.issuedAt)}`, { width, align: "right" });
  doc.text(`Job ${formatWorkOrderNumber(invoice.workOrder.number)}`, { width, align: "right" });

  y = Math.max(shopBottom, doc.y) + 14;
  rule(y);

  // ── Bill to / vehicle ──────────────────────────────────────────────────────
  y += 14;
  const half = left + width / 2;
  const { customer, vehicle } = invoice;
  label("Bill to", left, y);
  doc.font("bold").fontSize(11).fillColor("black").text(customer.name, left, y + 12, { width: width / 2 - 10 });
  doc.font("regular").fontSize(10).fillColor(GREY).text(formatThaiPhone(customer.phone));
  if (customer.email) doc.text(customer.email);
  const billBottom = doc.y;

  label("Vehicle", half, y);
  doc.font("bold").fontSize(11).fillColor("black")
    .text(`${vehicle.make} ${vehicle.model} ${vehicle.year}`, half, y + 12, { width: width / 2 });
  doc.font("regular").fontSize(10).fillColor(GREY).text(`${vehicle.plate} ${vehicle.province}`);
  doc.text(`VIN ${vehicle.vin} · ${formatKm(invoice.mileageIn)}`);

  y = Math.max(billBottom, doc.y) + 14;
  rule(y);

  // ── Lines ──────────────────────────────────────────────────────────────────
  const col = { qty: right - 220, unit: right - 170, amount: right - 85 };
  const tableHeader = (top: number) => {
    label("Description", left, top);
    doc.font("bold").fontSize(8).fillColor(LIGHT);
    doc.text("QTY", col.qty, top, { width: 40, align: "right" });
    doc.text("UNIT PRICE", col.unit, top, { width: 75, align: "right" });
    doc.text("AMOUNT", col.amount, top, { width: 85, align: "right" });
    rule(top + 14);
    return top + 22;
  };
  const rows = [
    ...invoice.labour.map((line) => ({
      text: line.description, note: "(labour)", qty: 1, unit: line.laborCost, amount: line.laborCost,
    })),
    ...invoice.parts.map((part) => ({
      text: part.name, note: part.sku, qty: part.quantity, unit: part.unitPrice, amount: part.lineTotal,
    })),
  ];

  y = tableHeader(y + 14);
  for (const row of rows) {
    const descWidth = col.qty - left - 10;
    doc.font("regular").fontSize(10);
    const height = doc.heightOfString(`${row.text}  ${row.note}`, { width: descWidth });
    if (y + height > doc.page.height - MARGIN - 120) {
      doc.addPage();
      y = tableHeader(MARGIN);
    }
    // Same size for the note: pdfkit top-aligns mixed sizes on one line.
    doc.fillColor("black").text(row.text, left, y, { width: descWidth, continued: true })
      .fillColor(LIGHT).text(`  ${row.note}`);
    doc.font("regular").fontSize(10).fillColor("black");
    doc.text(String(row.qty), col.qty, y, { width: 40, align: "right" });
    doc.text(formatTHB(row.unit), col.unit, y, { width: 75, align: "right" });
    doc.text(formatTHB(row.amount), col.amount, y, { width: 85, align: "right" });
    y += Math.max(height, 14) + 6;
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totalsLeft = right - 200;
  doc.moveTo(totalsLeft, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
  y += 8;
  const totalRow = (name: string, amount: number, strong = false) => {
    doc.font(strong ? "bold" : "regular").fontSize(strong ? 12 : 10).fillColor(strong ? "black" : GREY);
    doc.text(name, totalsLeft, y, { width: 100 });
    doc.fillColor("black").text(formatTHB(amount), totalsLeft + 100, y, { width: 100, align: "right" });
    y += strong ? 20 : 16;
  };
  totalRow("Subtotal", invoice.subtotal);
  totalRow(`VAT ${Math.round(invoice.vatRate * 100)}%`, invoice.vat);
  doc.moveTo(totalsLeft, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
  y += 6;
  totalRow("Total", invoice.total, true);

  // ── Work performed ─────────────────────────────────────────────────────────
  if (invoice.workPerformed) {
    y += 10;
    label("Work performed", left, y);
    doc.font("regular").fontSize(10).fillColor(GREY).text(invoice.workPerformed, left, y + 12, { width });
    y = doc.y;
  }

  doc.font("regular").fontSize(9).fillColor(LIGHT)
    .text("Amounts in Thai baht. Thank you for choosing us.", left, Math.max(y + 24, doc.y + 24), { width, align: "center" });

  doc.end();
  return done;
}
