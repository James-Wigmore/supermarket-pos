import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';

interface Label {
  name: string;
  code: string;
  price?: number;
}

const COLS = 3;
const ROWS = 9;
const MM = 72 / 25.4;

const collect = (doc: PDFKit.PDFDocument) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });

export const code128Png = (text: string) =>
  bwipjs.toBuffer({ bcid: 'code128', text, scale: 3, height: 10, includetext: true, textxalign: 'center' });

/** A4 sheet of 63×30 mm barcode labels (Code 128, scannable by any USB/Bluetooth scanner). */
export const labelsPdf = async (labels: Label[], currency: string) => {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const w = 63 * MM;
  const h = 30 * MM;
  const left = (doc.page.width - COLS * w) / 2;
  const top = (doc.page.height - ROWS * h) / 2;

  for (const [index, label] of labels.entries()) {
    const slot = index % (COLS * ROWS);
    if (index > 0 && slot === 0) doc.addPage();
    const x = left + (slot % COLS) * w;
    const y = top + Math.floor(slot / COLS) * h;
    doc.font('Helvetica-Bold').fontSize(7).text(label.name, x + 4, y + 4, { width: w - 8, height: 18, ellipsis: true });
    doc.image(await code128Png(label.code), x + 6, y + 20, { fit: [w - 12, h - 34], align: 'center' });
    if (label.price !== undefined) doc.font('Helvetica-Bold').fontSize(9).text(`${currency} ${label.price.toLocaleString('en-US')}`, x + 4, y + h - 12, { width: w - 8, align: 'center' });
  }
  return collect(doc);
};

export interface ReceiptData {
  store: { storeName: string; header: string; footer: string; branch?: string; address?: string | null; phone?: string | null };
  sale: {
    receiptNo: string; soldAt: Date; cashierName: string | null; subtotal: unknown; discountTotal: unknown; taxTotal: unknown; total: unknown; changeGiven: unknown;
    items: { name: string; quantity: unknown; unitPrice: unknown; lineTotal: unknown }[];
    payments: { method: string; amount: unknown }[];
  };
}

const fmt = (value: unknown) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** 80 mm thermal-style receipt. */
export const receiptPdf = ({ store, sale }: ReceiptData) => {
  const width = 80 * MM;
  const doc = new PDFDocument({ size: [width, 800], margin: 8 });
  const line = (left: string, right = '', bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const y = doc.y;
    doc.text(left, 8, y, { width: width - 16 - 70, continued: false });
    const after = doc.y;
    doc.text(right, width - 78, y, { width: 70, align: 'right' });
    doc.y = Math.max(after, doc.y);
  };
  doc.font('Helvetica-Bold').fontSize(11).text(store.storeName, { align: 'center' });
  doc.font('Helvetica').fontSize(8);
  for (const text of [store.branch, store.address, store.phone, store.header]) if (text) doc.text(text, { align: 'center' });
  doc.moveDown(0.5);
  line(`Receipt ${sale.receiptNo}`);
  line(sale.soldAt.toISOString().slice(0, 16).replace('T', ' '), sale.cashierName ?? '');
  doc.moveDown(0.5);
  for (const item of sale.items) line(`${item.name}\n${fmt(item.quantity)} x ${fmt(item.unitPrice)}`, fmt(item.lineTotal));
  doc.moveDown(0.5);
  if (Number(sale.discountTotal) > 0) line('Discount', `-${fmt(sale.discountTotal)}`);
  if (Number(sale.taxTotal) > 0) line('Tax included', fmt(sale.taxTotal));
  line('TOTAL', fmt(sale.total), true);
  for (const p of sale.payments) line(p.method.replace('_', ' '), fmt(p.amount));
  if (Number(sale.changeGiven) > 0) line('Change', fmt(sale.changeGiven));
  doc.moveDown().font('Helvetica').fontSize(8).text(store.footer, { align: 'center' });
  return collect(doc);
};
