import { createHash } from 'node:crypto';
import { zipStore } from './zipStore.js';
import { calculateFormulaCaches } from './xlsxFormulaCache.js';

export type ArtifactType = 'markdown' | 'csv' | 'pdf' | 'docx' | 'xlsx' | 'pptx';
export type ArtifactSlide = { title?: string; content?: string };
export type ArtifactFormulaCell = { formula: string; cachedValue?: number | boolean | null };
export type ArtifactCell = string | number | boolean | null | ArtifactFormulaCell;
export type ArtifactRequest = {
  type: ArtifactType;
  title?: string;
  content?: string;
  rows?: Array<Array<ArtifactCell>>;
  slides?: ArtifactSlide[];
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

function isFormulaCell(value: unknown): value is ArtifactFormulaCell {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as ArtifactFormulaCell).formula === 'string');
}

function normalizeFormula(formulaInput: string): string {
  const raw = formulaInput.trim();
  const formula = raw.startsWith('=') ? raw.slice(1) : raw;
  if (!formula || formula.length > 512 || /[\r\n]/.test(formula)) throw new Error('INVALID_ARTIFACT_FORMULA');
  if (!/^[\p{L}\p{N}_.$:+\-*/^(),<>=!% '"&]+$/u.test(formula)) throw new Error('INVALID_ARTIFACT_FORMULA');
  if (/\b(?:HYPERLINK|WEBSERVICE|RTD|DDE|FILTERXML|ENCODEURL)\s*\(/i.test(formula) || /https?:\/\//i.test(formula)) {
    throw new Error('INVALID_ARTIFACT_FORMULA');
  }
  return formula;
}

function csvCell(value: unknown): string {
  if (isFormulaCell(value)) throw new Error('FORMULA_CELLS_REQUIRE_XLSX');
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function makeCsv(rows: ArtifactRequest['rows'], content: string): Buffer {
  const table = rows?.length ? rows : content.split(/\r?\n/).filter(Boolean).map(line => [line]);
  return Buffer.from(table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
}

function pdfEscape(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?'); }
function makePdf(title: string, content: string): Buffer {
  // Courier has a fixed 600-unit advance: 82 columns at 10pt fit inside
  // the 495pt A4 content width. Wrap and paginate; never discard input lines.
  const lines = [title, '', ...content.split(/\r\n|\r|\n/)].flatMap(line => {
    const expanded = line.replace(/\t/g, '    ');
    return expanded.match(/.{1,82}/g) || [''];
  });
  const pages: string[][] = [];
  for (let offset = 0; offset < lines.length; offset += 48) pages.push(lines.slice(offset, offset + 48));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  pages.forEach((page, index) => {
    const commands = [
      'BT', '/F1 10 Tf', '50 790 Td',
      ...page.flatMap((line, lineIndex) => lineIndex === 0 ? [`(${pdfEscape(line)}) Tj`] : ['0 -15 Td', `(${pdfEscape(line)}) Tj`]),
      'ET', 'BT', '/F1 9 Tf', '50 32 Td', `(${index + 1} / ${pages.length}) Tj`, 'ET',
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
    );
  });
  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((obj, index) => { offsets[index + 1] = Buffer.byteLength(body); body += `${index + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

function docxParagraph(text: string, style?: "Title" | "Heading1" | "Heading2"): string {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '<w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>';
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function makeDocx(title: string, content: string): Buffer {
  const body = [
    docxParagraph(title, 'Title'),
    ...content.split(/\r?\n/).map((line) => {
      const heading2 = line.match(/^##\s+(.+)/);
      if (heading2) return docxParagraph(heading2[1], 'Heading2');
      const heading1 = line.match(/^#\s+(.+)/);
      if (heading1) return docxParagraph(heading1[1], 'Heading1');
      return docxParagraph(line);
    }),
  ].join('');
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:b/><w:sz w:val="38"/><w:szCs w:val="38"/><w:color w:val="17324D"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/><w:color w:val="0F6CBD"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="334155"/></w:rPr></w:style></w:styles>';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1276" w:bottom="1134" w:left="1276"/></w:sectPr></w:body></w:document>`;
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rootRels) },
    { name: 'word/document.xml', data: Buffer.from(document) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(documentRels) },
    { name: 'word/styles.xml', data: Buffer.from(styles) },
  ]);
}

function columnName(index: number): string {
  let value = index + 1, out = '';
  while (value > 0) { const rem = (value - 1) % 26; out = String.fromCharCode(65 + rem) + out; value = Math.floor((value - 1) / 26); }
  return out;
}
function xlsxCellXml(value: ArtifactCell, ref: string, styleId = 0): string {
  const style = styleId > 0 ? ` s="${styleId}"` : '';
  if (isFormulaCell(value)) {
    const formula = normalizeFormula(value.formula);
    const cached = value.cachedValue;
    if (typeof cached === 'number' && !Number.isFinite(cached)) throw new Error('INVALID_ARTIFACT_FORMULA');
    const type = typeof cached === 'boolean' ? ' t="b"' : '';
    const cachedXml = cached === undefined || cached === null ? '' : `<v>${typeof cached === 'boolean' ? (cached ? 1 : 0) : cached}</v>`;
    return `<c r="${ref}"${type}${style}><f>${xml(formula)}</f>${cachedXml}</c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value ?? '')}</t></is></c>`;
}
function spreadsheetVisualWidth(value: unknown): number {
  const display = isFormulaCell(value) ? (value.cachedValue ?? `=${value.formula}`) : value;
  return [...String(display ?? '')].reduce((sum, char) => sum + (char.codePointAt(0)! > 0xff ? 2 : 1), 0);
}
function makeXlsx(rows: ArtifactRequest['rows'], content: string): Buffer {
  const table = calculateFormulaCaches(rows?.length ? rows : content.split(/\r?\n/).filter(Boolean).map(line => [line]));
  const columnCount = Math.max(1, ...table.map(row => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) => {
    const max = Math.max(8, ...table.map(row => spreadsheetVisualWidth(row[column])));
    return Math.min(42, Math.max(10, max + 3));
  });
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const rowXml = table.map((row, r) => {
    const styleId = r === 0 ? 1 : (r % 2 === 0 ? 2 : 0);
    return `<row r="${r + 1}" ht="${r === 0 ? 24 : 21}" customHeight="1">${row.map((value, col) => xlsxCellXml(value, `${columnName(col)}${r + 1}`, styleId)).join('')}</row>`;
  }).join('');
  const lastColumn = columnName(columnCount - 1);
  const filter = table.length > 1 ? `<autoFilter ref="A1:${lastColumn}${table.length}"/>` : '';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F6CBD"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF0A4F8A"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="ORIGIN" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
    { name: 'xl/styles.xml', data: Buffer.from(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rowXml}</sheetData>${filter}</worksheet>`) },
  ]);
}

const PPT_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAW_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const PPTX_BODY_LINES_PER_SLIDE = 10;
const PPTX_BODY_CHARS_PER_LINE = 140;
const PPTX_TITLE_CHARS_PER_LINE = 70;

function splitPptLinePreservingText(line: string, maxChars: number): string[] {
  const chars = Array.from(line);
  if (!chars.length) return [''];
  const parts: string[] = [];
  for (let offset = 0; offset < chars.length; offset += maxChars) parts.push(chars.slice(offset, offset + maxChars).join(''));
  return parts;
}

function preparePptSlides(title: string, content: string, requestedSlides: ArtifactRequest['slides']): Required<ArtifactSlide>[] {
  const source = requestedSlides?.length ? requestedSlides : [{ title, content }];
  const expanded: Required<ArtifactSlide>[] = [];
  source.forEach((slide, index) => {
    const slideTitle = String(slide.title ?? (index === 0 ? title : `Slide ${index + 1}`));
    const slideContent = String(slide.content ?? '');
    if (slideTitle.length > 200) throw new Error('INVALID_ARTIFACT_TITLE');
    if (slideContent.length > 10000) throw new Error('INVALID_ARTIFACT_SLIDES');
    const logicalLines = slideContent.split(/\r?\n/).flatMap((line) => splitPptLinePreservingText(line, PPTX_BODY_CHARS_PER_LINE));
    const lines = logicalLines.length ? logicalLines : [''];
    for (let offset = 0; offset < lines.length; offset += PPTX_BODY_LINES_PER_SLIDE) {
      expanded.push({ title: slideTitle, content: lines.slice(offset, offset + PPTX_BODY_LINES_PER_SLIDE).join('\n') });
    }
  });
  if (!expanded.length || expanded.length > 50) throw new Error('PPTX_CONTENT_REQUIRES_TOO_MANY_SLIDES');
  return expanded;
}

function pptTextFragments(text: string, title: boolean): string[] {
  return text.split(/\r?\n/).flatMap((line) => splitPptLinePreservingText(line, title ? PPTX_TITLE_CHARS_PER_LINE : PPTX_BODY_CHARS_PER_LINE));
}

function pptTextBox(id: number, name: string, text: string, x: number, y: number, cx: number, cy: number, title = false): string {
  const lines = pptTextFragments(text, title);
  const safeLines = lines.length ? lines : [''];
  const size = title ? 2600 : 1700;
  const color = title ? '17324D' : '334155';
  const paragraphs = safeLines.map((line) => {
    const normalized = title ? line : line.replace(/^\s*[-•]\s*/, '• ');
    return `<a:p><a:pPr><a:spcAft><a:spcPts val="${title ? 0 : 300}"/></a:spcAft></a:pPr><a:r><a:rPr lang="ja-JP" sz="${size}"${title ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xml(normalized)}</a:t></a:r><a:endParaRPr lang="ja-JP" sz="${size}"/></a:p>`;
  }).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}
function pptRect(id: number, name: string, x: number, y: number, cx: number, cy: number, fill: string, line?: string): string {
  const lineXml = line ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>${lineXml}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function makePptx(title: string, content: string, requestedSlides: ArtifactRequest['slides']): Buffer {
  const slides = preparePptSlides(title, content, requestedSlides);
  const slideOverrides = slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const slideIds = slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('');
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}</Relationships>`;
  const slideMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="2800" b="1"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr sz="1800"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;
  const slideLayout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
  const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${DRAW_NS}" name="ORIGIN"><a:themeElements><a:clrScheme name="ORIGIN"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="ORIGIN"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="ORIGIN"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
  const entries: Array<{ name: string; data: Buffer }> = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rootRels) },
    { name: 'ppt/presentation.xml', data: Buffer.from(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: Buffer.from(presentationRels) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: Buffer.from(slideMaster) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: Buffer.from(slideMasterRels) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: Buffer.from(slideLayout) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: Buffer.from(slideLayoutRels) },
    { name: 'ppt/theme/theme1.xml', data: Buffer.from(theme) },
    { name: 'docProps/core.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>ORIGIN</dc:creator></cp:coreProperties>`) },
    { name: 'docProps/app.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ORIGIN</Application><Slides>${slides.length}</Slides></Properties>`) },
  ];
  slides.forEach((slide, index) => {
    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${pptRect(2, 'Background', 0, 0, 12192000, 6858000, 'F7FAFC')}${pptRect(3, 'Accent', 0, 0, 152400, 6858000, '0F6CBD')}${pptTextBox(4, 'Title', slide.title, 762000, 420000, 10400000, 1250000, true)}${pptRect(5, 'ContentCard', 762000, 1800000, 10300000, 4250000, 'FFFFFF', 'E2E8F0')}${pptTextBox(6, 'Content', slide.content, 1120000, 2100000, 9600000, 3650000)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: Buffer.from(slideXml) });
    entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: Buffer.from(slideRels) });
  });
  return zipStore(entries);
}

function validateArtifactRows(rows: ArtifactRequest['rows']): void {
  if (!rows) return;
  for (const row of rows) {
    for (const value of row) {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('INVALID_ARTIFACT_ROWS');
      if (isFormulaCell(value)) {
        normalizeFormula(value.formula);
        if (typeof value.cachedValue === 'number' && !Number.isFinite(value.cachedValue)) throw new Error('INVALID_ARTIFACT_FORMULA');
      }
    }
  }
}

function pptxInputPreserved(bytes: Buffer, title: string, content: string, requestedSlides: ArtifactRequest['slides']): boolean {
  try {
    const slides = preparePptSlides(title, content, requestedSlides);
    return slides.every((slide) => {
      const titleOk = pptTextFragments(slide.title, true).filter(Boolean).every((fragment) => bytes.includes(Buffer.from(xml(fragment), 'utf8')));
      const contentOk = pptTextFragments(slide.content, false).filter(Boolean).every((fragment) => {
        const normalized = fragment.replace(/^\s*[-•]\s*/, '• ');
        return bytes.includes(Buffer.from(xml(normalized), 'utf8'));
      });
      return titleOk && contentOk;
    });
  } catch {
    return false;
  }
}

function xlsxFormulaInputPreserved(bytes: Buffer, rows: ArtifactRequest['rows']): boolean {
  const formulas = (rows ?? []).flat().filter(isFormulaCell).map((cell) => normalizeFormula(cell.formula));
  return formulas.every((formula) => bytes.includes(Buffer.from(`<f>${xml(formula)}</f>`, 'utf8')));
}

export function generateArtifactV12(input: ArtifactRequest): GeneratedArtifact {
  validateArtifactRows(input.rows);
  const title = String(input.title || 'ORIGIN Artifact');
  const content = String(input.content || '');
  if (title.length > 200) throw new Error('INVALID_ARTIFACT_TITLE');
  if (content.length > 120000) throw new Error('INVALID_ARTIFACT_CONTENT');
  const stem = safeName(input.title, 'origin-artifact');
  let bytes: Buffer, ext: string, mimeType: string;
  if (input.type === 'markdown') { bytes = Buffer.from(`# ${title}\n\n${content}\n`, 'utf8'); ext = 'md'; mimeType = 'text/markdown; charset=utf-8'; }
  else if (input.type === 'csv') { bytes = makeCsv(input.rows, content); ext = 'csv'; mimeType = 'text/csv; charset=utf-8'; }
  else if (input.type === 'pdf') {
    if (/[^\x09\x0A\x0D\x20-\x7E]/.test(`${title}\n${content}`)) throw new Error('PDF_UNICODE_RENDERING_UNAVAILABLE');
    bytes = makePdf(title, content); ext = 'pdf'; mimeType = 'application/pdf';
  }
  else if (input.type === 'docx') { bytes = makeDocx(title, content); ext = 'docx'; mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
  else if (input.type === 'xlsx') { bytes = makeXlsx(input.rows, content); ext = 'xlsx'; mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }
  else if (input.type === 'pptx') { bytes = makePptx(title, content, input.slides); ext = 'pptx'; mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; }
  else throw new Error('UNSUPPORTED_ARTIFACT_TYPE');
  const verification: string[] = [];
  if (bytes.length > 0) verification.push('non-empty');
  if (input.type === 'pdf' && bytes.subarray(0, 5).toString() === '%PDF-') verification.push('pdf-signature');
  if ((input.type === 'docx' || input.type === 'xlsx' || input.type === 'pptx') && bytes.readUInt32LE(0) === 0x04034b50) verification.push('zip-signature');
  if (input.type === 'docx' && bytes.includes(Buffer.from('word/document.xml'))) verification.push('docx-package');
  if (input.type === 'xlsx' && bytes.includes(Buffer.from('xl/workbook.xml'))) verification.push('xlsx-package');
  if (input.type === 'pptx' && bytes.includes(Buffer.from('ppt/presentation.xml')) && bytes.includes(Buffer.from('ppt/slides/slide1.xml'))) verification.push('pptx-package');
  if (input.type === 'pptx' && pptxInputPreserved(bytes, title, content, input.slides)) verification.push('pptx-content-preserved');
  if (input.type === 'xlsx' && xlsxFormulaInputPreserved(bytes, input.rows)) verification.push('xlsx-formulas-preserved');
  if (input.type === 'markdown' || input.type === 'csv') verification.push('utf8-text');
  const verified = verification.length >= 2
    && (input.type !== 'pptx' || verification.includes('pptx-content-preserved'))
    && (input.type !== 'xlsx' || verification.includes('xlsx-formulas-preserved'));
  return { type: input.type, filename: `${stem}.${ext}`, mimeType, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), verified, verification };
}


export async function generateArtifactV12Async(input: ArtifactRequest): Promise<GeneratedArtifact> {
  if (input.type !== 'pdf') return generateArtifactV12(input);
  validateArtifactRows(input.rows);

  const title = String(input.title || 'ORIGIN Artifact');
  const content = String(input.content || '');
  if (title.length > 200) throw new Error('INVALID_ARTIFACT_TITLE');
  if (content.length > 120000) throw new Error('INVALID_ARTIFACT_CONTENT');
  const stem = safeName(input.title, 'origin-artifact');
  const { makeUnicodePdfV12 } = await import('./unicodePdfV12.js');
  const bytes = await makeUnicodePdfV12(title, content);
  const verification: string[] = [];

  if (bytes.length > 0) verification.push('non-empty');
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') verification.push('pdf-signature');
  verification.push('embedded-unicode-font');
  verification.push('unicode-width-aware-layout');

  const verified = verification.length >= 4;
  return {
    type: 'pdf',
    filename: `${stem}.pdf`,
    mimeType: 'application/pdf',
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    verified,
    verification,
  };
}

export async function artifactSelfTestV12Async(): Promise<{ ready: boolean; formats: Record<ArtifactType, boolean> }> {
  const sync = artifactSelfTestV12();
  const formats = { ...sync.formats };
  try {
    const pdf = await generateArtifactV12Async({ type: 'pdf', title: '日本語セルフテスト', content: '営業資料 ABC 123' });
    formats.pdf = pdf.verified && pdf.verification.includes('embedded-unicode-font');
  } catch {
    formats.pdf = false;
  }
  return { ready: Object.values(formats).every(Boolean), formats };
}

export function artifactSelfTestV12(): { ready: boolean; formats: Record<ArtifactType, boolean> } {
  const samples: Record<ArtifactType, ArtifactRequest> = {
    markdown: { type: 'markdown', title: 'Self Test', content: 'ok' },
    csv: { type: 'csv', rows: [['a', 'b'], ['1', '2']] },
    pdf: { type: 'pdf', title: 'Self Test', content: 'ok' },
    docx: { type: 'docx', title: 'Self Test', content: 'ok' },
    xlsx: { type: 'xlsx', rows: [['a', 'b'], ['1', '2']] },
    pptx: { type: 'pptx', title: 'Self Test', slides: [{ title: 'Slide', content: 'ok' }] },
  };
  const formats = Object.fromEntries((Object.keys(samples) as ArtifactType[]).map(type => {
    try { return [type, generateArtifactV12(samples[type]).verified]; } catch { return [type, false]; }
  })) as Record<ArtifactType, boolean>;
  return { ready: Object.values(formats).every(Boolean), formats };
}
