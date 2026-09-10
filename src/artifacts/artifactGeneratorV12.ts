import { createHash } from 'node:crypto';
import { zipStore } from './zipStore.js';

export type ArtifactType = 'markdown' | 'csv' | 'pdf' | 'docx' | 'xlsx' | 'pptx';
export type ArtifactSlide = { title?: string; content?: string };
export type ArtifactRequest = {
  type: ArtifactType;
  title?: string;
  content?: string;
  rows?: Array<Array<string | number | boolean | null>>;
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

const PPT_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAW_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function pptTextBox(id: number, name: string, text: string, x: number, y: number, cx: number, cy: number, title = false): string {
  const paragraphs = (text.split(/\r?\n/).slice(0, title ? 1 : 28).length ? text.split(/\r?\n/).slice(0, title ? 1 : 28) : ['']).map(line => `<a:p><a:r><a:rPr lang="ja-JP" sz="${title ? 2800 : 1800}"${title ? ' b="1"' : ''}/><a:t>${xml(line.slice(0, title ? 160 : 500))}</a:t></a:r><a:endParaRPr lang="ja-JP"/></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function makePptx(title: string, content: string, requestedSlides: ArtifactRequest['slides']): Buffer {
  const slides = (requestedSlides?.length ? requestedSlides : [{ title, content }]).slice(0, 50).map((slide, index) => ({
    title: String(slide.title ?? (index === 0 ? title : `Slide ${index + 1}`)).slice(0, 200),
    content: String(slide.content ?? '').slice(0, 10000),
  }));
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
    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${pptTextBox(2, 'Title', slide.title, 685800, 457200, 10820400, 914400, true)}${pptTextBox(3, 'Content', slide.content, 685800, 1600200, 10820400, 4572000)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: Buffer.from(slideXml) });
    entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: Buffer.from(slideRels) });
  });
  return zipStore(entries);
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
  else if (input.type === 'pptx') { bytes = makePptx(title, content, input.slides); ext = 'pptx'; mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; }
  else throw new Error('UNSUPPORTED_ARTIFACT_TYPE');
  const verification: string[] = [];
  if (bytes.length > 0) verification.push('non-empty');
  if (input.type === 'pdf' && bytes.subarray(0, 5).toString() === '%PDF-') verification.push('pdf-signature');
  if ((input.type === 'docx' || input.type === 'xlsx' || input.type === 'pptx') && bytes.readUInt32LE(0) === 0x04034b50) verification.push('zip-signature');
  if (input.type === 'docx' && bytes.includes(Buffer.from('word/document.xml'))) verification.push('docx-package');
  if (input.type === 'xlsx' && bytes.includes(Buffer.from('xl/workbook.xml'))) verification.push('xlsx-package');
  if (input.type === 'pptx' && bytes.includes(Buffer.from('ppt/presentation.xml')) && bytes.includes(Buffer.from('ppt/slides/slide1.xml'))) verification.push('pptx-package');
  if (input.type === 'markdown' || input.type === 'csv') verification.push('utf8-text');
  const verified = verification.length >= 2;
  return { type: input.type, filename: `${stem}.${ext}`, mimeType, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), verified, verification };
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
