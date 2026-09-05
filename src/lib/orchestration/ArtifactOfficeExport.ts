const encoder = new TextEncoder();

const xmlEscape = (value: string) => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;',
}[character] ?? character));

const safeStem = (title: string) => title.replace(/[^a-z0-9._-]/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'origin-artifact';

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const u16 = (value: number) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
const u32 = (value: number) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
const join = (chunks: readonly Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
};

/** A small ZIP writer using stored entries only; no runtime dependency is required. */
export const createStoredZip = (entries: readonly { path: string; content: string }[]): Blob => {
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path); const data = encoder.encode(entry.content); const crc = crc32(data);
    const localHeader = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    const centralHeader = join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    local.push(localHeader); central.push(centralHeader); offset += localHeader.length;
  }
  const directory = join(central);
  return new Blob([join([...local, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)])], { type: 'application/zip' });
};

const normalizeRows = (content: string): string[][] => content
  .split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  .map((line) => line.includes('\t') ? line.split('\t') : line.split(',').map((cell) => cell.trim()));

export type OfficeExport = { fileName: string; type: string; blob: Blob };

export const createCsvExport = (title: string, content: string): OfficeExport => {
  const rows = normalizeRows(content);
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  return { fileName: `${safeStem(title)}.csv`, type: 'text/csv;charset=utf-8', blob: new Blob([`\ufeff${csv}\r\n`], { type: 'text/csv;charset=utf-8' }) };
};

export const createDocxExport = (title: string, content: string): OfficeExport => {
  const paragraphs = content.split(/\r?\n/).map((line) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const blob = createStoredZip([{ path: '[Content_Types].xml', content: contentTypes }, { path: '_rels/.rels', content: rels }, { path: 'word/document.xml', content: documentXml }]);
  return { fileName: `${safeStem(title)}.docx`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', blob };
};

export const createXlsxExport = (title: string, content: string): OfficeExport => {
  const rows = normalizeRows(content);
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => {
    const ref = `${String.fromCharCode(65 + Math.min(columnIndex, 25))}${rowIndex + 1}`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ORIGIN" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const blob = createStoredZip([
    { path: '[Content_Types].xml', content: contentTypes }, { path: '_rels/.rels', content: rootRels },
    { path: 'xl/workbook.xml', content: workbook }, { path: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { path: 'xl/worksheets/sheet1.xml', content: sheet },
  ]);
  return { fileName: `${safeStem(title)}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', blob };
};

const pdfEscape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Minimal standards-compliant PDF text export. It intentionally avoids network assets and third-party runtime code. */
export const createPdfExport = (title: string, content: string): OfficeExport => {
  const lines = [`${title}`, ...content.split(/\r?\n/)].flatMap((line) => line.match(/.{1,88}(?:\s|$)/g) ?? [line]).slice(0, 48);
  const textCommands = ['BT', '/F1 14 Tf', '50 760 Td', ...lines.map((line, index) => `${index === 0 ? '' : '0 -15 Td ' }(${pdfEscape(line.trim())}) Tj`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${encoder.encode(textCommands).length} >>\nstream\n${textCommands}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets.push(encoder.encode(pdf).length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = encoder.encode(pdf).length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return { fileName: `${safeStem(title)}.pdf`, type: 'application/pdf', blob: new Blob([pdf], { type: 'application/pdf' }) };
};
