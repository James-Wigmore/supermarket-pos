import type { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportData } from '../services/report.service';

export const EXPORT_FORMATS = ['json', 'csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

type Column = ReportData['columns'][number];

const asNumber = (value: unknown) => Number(value ?? 0);
const asDate = (value: unknown) => (value ? new Date(value as string).toISOString().slice(0, 10) : '');

const cell = (column: Column, value: unknown): string | number => {
  if (column.type === 'money' || column.type === 'number') return asNumber(value);
  if (column.type === 'date') return asDate(value);
  return value === null || value === undefined ? '' : String(value);
};

const fmt = (column: Column, value: string | number) =>
  typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: column.type === 'money' ? 2 : 3 }) : value;

// Prevents spreadsheet formula injection from user-controlled text.
const safeText = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

const toCsv = ({ columns, rows }: ReportData) => {
  const escape = (v: string | number) => `"${String(typeof v === 'string' ? safeText(v) : v).replaceAll('"', '""')}"`;
  const lines = [columns.map((c) => escape(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => escape(cell(c, row[c.key]))).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
};

const toXlsx = async ({ title, columns, rows }: ReportData) => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(title.slice(0, 31));
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.type === 'text' ? 28 : 16 }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(Object.fromEntries(columns.map((c) => {
      const value = cell(c, row[c.key]);
      return [c.key, typeof value === 'string' ? safeText(value) : value];
    })));
  }
  columns.forEach((c, i) => {
    if (c.type === 'money') sheet.getColumn(i + 1).numFmt = '#,##0.00';
  });
  return Buffer.from(await book.xlsx.writeBuffer());
};

const collect = (doc: PDFKit.PDFDocument) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });

const toPdf = ({ title, columns, rows }: ReportData) => {
  const doc = new PDFDocument({ size: 'A4', layout: columns.length > 5 ? 'landscape' : 'portrait', margin: 36 });
  const width = (doc.page.width - 72) / columns.length;
  const drawRow = (values: string[], bold = false) => {
    if (doc.y > doc.page.height - 60) doc.addPage();
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const height = Math.max(...values.map((v, i) => doc.heightOfString(v, { width: width - 6 }) + (i ? 0 : 0)));
    values.forEach((v, i) => doc.text(v, 36 + i * width, y, { width: width - 6, align: columns[i]?.type === 'text' ? 'left' : 'right' }));
    doc.y = y + height + 4;
  };
  doc.font('Helvetica-Bold').fontSize(14).text(title).moveDown(0.2);
  doc.font('Helvetica').fontSize(8).text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`).moveDown();
  drawRow(columns.map((c) => c.label), true);
  for (const row of rows) drawRow(columns.map((c) => fmt(c, cell(c, row[c.key]))));
  return collect(doc);
};

const MIME = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' } as const;

export const sendReport = async (res: Response, format: ExportFormat, report: ReportData, fileBase: string) => {
  if (format === 'json') {
    res.json(report);
    return;
  }
  const body = format === 'csv' ? toCsv(report) : format === 'xlsx' ? await toXlsx(report) : await toPdf(report);
  res.setHeader('Content-Type', MIME[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.${format}"`);
  res.send(body);
};
