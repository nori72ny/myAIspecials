import { createHash } from 'node:crypto';
import { zipStore } from './zipStore.js';

export type ArtifactType = 'markdown' | 'csv' | 'pdf' | 'docx' | 'xlsx';
export type ArtifactRequest = {
  type: ArtifactType;
  title?: string;
  content?: string;
  rows?: Array<Array<string | number | boolean | null>>;
};
export type GeneratedArtifact = {
  type: ArtifactType;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  sha256: string;
  verified: boolean;
  verification: string[];
};

const xml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const safeName = (value: string | undefined, fallback: string) => (value || fallback).normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function makeCsv(rows: ArtifactRequest['rows'], content: string): Buffer {
  const table = rows?.length ? rows : content.split(/\r?\n/).filter(Boolean).map(line => [line]);
  return Buffer.from(table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
}

function pdfEscape(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?'); }
function makePdf(title: string, content: string): Buffer {
  const lines = [title, '', ...content.split(/\r?\n/)].slice(0, 46).map(line => pdfEscape(line.slice(0, 100)));
  const commands = ['BT', '/F1 12 Tf', '50 790 Td', ...lines.flatMap((line, index) => index === 0 ? [`(${line}) Tj`] : ['0 -16 Td', `(${line}) Tj`]), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((obj, index) => { offsets[index + 1] = Buffer.byteLength(body); body += `${index + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

function makeDocx(title: string, content: string): Buffer {
  const paragraphs = [title, ...content.split(/\r?\n/)].map(text => `<w:p><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`).join('');
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`) },
  ]);
}

function columnName(index: number): string {
  let value = index + 1, out = '';
  while (value > 0) { const rem = (value - 1) % 26; out = String.fromCharCode(65 + rem) + out; value = Math.floor((value - 1) / 26); }
  return out;
}
function makeXlsx(rows: ArtifactRequest['rows'], content: string): Buffer {
  const table = rows?.length ? rows : content.split(/\r?\n/).filter(Boolean).map(line => [line]);
  const rowXml = table.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join('')}</row>`).join('');
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`) },
  ]);
}

export function generateArtifactV12(input: ArtifactRequest): GeneratedArtifact {
  const title = String(input.title || 'ORIGIN Artifact').slice(0, 200);
  const content = String(input.content || '').slice(0, 120000);
  const stem = safeName(input.title, 'origin-artifact');
  let bytes: Buffer, ext: string, mimeType: string;
  if (input.type === 'markdown') { bytes = Buffer.from(`# ${title}\n\n${content}\n`, 'utf8'); ext = 'md'; mimeType = 'text/markdown; charset=utf-8'; }
  else if (input.type === 'csv') { bytes = makeCsv(input.rows, content); ext = 'csv'; mimeType = 'text/csv; charset=utf-8'; }
  else if (input.type === 'pdf') { bytes = makePdf(title, content); ext = 'pdf'; mimeType = 'application/pdf'; }
  else if (input.type === 'docx') { bytes = makeDocx(title, content); ext = 'docx'; mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
  else if (input.type === 'xlsx') { bytes = makeXlsx(input.rows, content); ext = 'xlsx'; mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }
  else throw new Error('UNSUPPORTED_ARTIFACT_TYPE');
  const verification: string[] = [];
  if (bytes.length > 0) verification.push('non-empty');
  if (input.type === 'pdf' && bytes.subarray(0, 5).toString() === '%PDF-') verification.push('pdf-signature');
  if ((input.type === 'docx' || input.type === 'xlsx') && bytes.readUInt32LE(0) === 0x04034b50) verification.push('zip-signature');
  if (input.type === 'markdown' || input.type === 'csv') verification.push('utf8-text');
  const verified = verification.length >= 2 || ((input.type === 'markdown' || input.type === 'csv') && verification.length >= 2);
  return { type: input.type, filename: `${stem}.${ext}`, mimeType, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), verified, verification };
}
