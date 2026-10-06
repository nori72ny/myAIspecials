import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN_X = 52;
const TOP_Y = A4_HEIGHT - 58;
const BOTTOM_Y = 54;
const TITLE_SIZE = 16;
const BODY_SIZE = 10;
const FOOTER_SIZE = 8;
const TITLE_LINE_HEIGHT = 23;
const BODY_LINE_HEIGHT = 15;
const MAX_FONT_BYTES = 2_500_000;
const MAX_FONT_FILES = 160;
const MAX_TOTAL_FONT_BYTES = 24_000_000;

export const UNICODE_PDF_RENDERER_VERSION_V12 = 'unicode-pdf-renderer-v7' as const;

type LoadedFontSource = {
  filename: string;
  bytes: Uint8Array;
  supported: ReadonlySet<number>;
};
type PdfFonts = {
  byCodePoint: ReadonlyMap<number, PDFFont>;
};

const FONT_SPECIFIERS = [
  '@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff',
  '@fontsource/noto-sans-jp/files/noto-sans-jp-latin-400-normal.woff',
  '@fontsource/noto-sans-jp/files/noto-sans-jp-latin-ext-400-normal.woff',
  '@fontsource/noto-sans-jp/files/noto-sans-jp-cyrillic-400-normal.woff',
] as const;

function fontFiles(): readonly string[] {
  const projectRequire = createRequire(resolve(process.cwd(), 'package.json'));
  const files = FONT_SPECIFIERS.map((specifier) => projectRequire.resolve(specifier));
  if (!files.length || files.length > MAX_FONT_FILES) throw new Error('PDF_UNICODE_FONT_CATALOG_INVALID');
  return files;
}

async function loadFontsForText(pdfDoc: PDFDocument, text: string): Promise<PdfFonts> {
  const files = fontFiles();
  const fontkitApi = fontkit as unknown as {
    create(data: Uint8Array): { characterSet?: number[] };
  };
  const loaded = new Map<string, LoadedFontSource>();
  const selectedFileByCodePoint = new Map<number, string>();
  let totalBytes = 0;
  let scanIndex = 0;

  const loadSource = (filename: string): LoadedFontSource => {
    const cached = loaded.get(filename);
    if (cached) return cached;
    const raw = readFileSync(filename);
    totalBytes += raw.length;
    if (raw.length < 1_000 || raw.length > MAX_FONT_BYTES || totalBytes > MAX_TOTAL_FONT_BYTES) {
      throw new Error('PDF_UNICODE_FONT_INVALID');
    }
    const bytes = Uint8Array.from(raw);
    const source = fontkitApi.create(bytes);
    if (!Array.isArray(source.characterSet)) throw new Error('PDF_UNICODE_FONT_CHARACTER_SET_UNAVAILABLE');
    const value = { filename: basename(filename), bytes, supported: new Set(source.characterSet) } satisfies LoadedFontSource;
    loaded.set(filename, value);
    return value;
  };

  const findFileForCodePoint = (codePoint: number): string => {
    for (const source of loaded.values()) {
      if (source.supported.has(codePoint)) return source.filename;
    }
    while (scanIndex < files.length) {
      const source = loadSource(files[scanIndex++]);
      if (source.supported.has(codePoint)) return source.filename;
    }
    throw new Error('PDF_UNICODE_GLYPH_UNSUPPORTED');
  };

  const uniqueCodePoints = new Set(
    Array.from(text)
      .map((char) => char.codePointAt(0))
      .filter((value): value is number => value !== undefined && value !== 0x09 && value !== 0x0a && value !== 0x0d),
  );
  for (const codePoint of uniqueCodePoints) selectedFileByCodePoint.set(codePoint, findFileForCodePoint(codePoint));

  const selectedFiles = new Set(selectedFileByCodePoint.values());
  if (!selectedFiles.size || selectedFiles.size > MAX_FONT_FILES) throw new Error('PDF_UNICODE_FONT_CATALOG_INVALID');
  const embeddedByFile = new Map<string, PDFFont>();
  for (const filename of selectedFiles) {
    const source = loadSource(filename);
    embeddedByFile.set(filename, await pdfDoc.embedFont(source.bytes, { subset: true }));
  }

  const byCodePoint = new Map<number, PDFFont>();
  for (const [codePoint, filename] of selectedFileByCodePoint) {
    const embedded = embeddedByFile.get(filename);
    if (!embedded) throw new Error('PDF_UNICODE_FONT_COVERAGE_MISMATCH');
    byCodePoint.set(codePoint, embedded);
  }
  return { byCodePoint };
}

function fontFor(char: string, fonts: PdfFonts): PDFFont {
  const codePoint = char.codePointAt(0);
  const font = codePoint === undefined ? undefined : fonts.byCodePoint.get(codePoint);
  if (!font) throw new Error('PDF_UNICODE_GLYPH_UNSUPPORTED');
  return font;
}

function textWidth(text: string, size: number, fonts: PdfFonts): number {
  let width = 0;
  for (const char of Array.from(text)) width += fontFor(char, fonts).widthOfTextAtSize(char, size);
  return width;
}

function wrapLine(line: string, maxWidth: number, size: number, fonts: PdfFonts): string[] {
  const normalized = line.normalize('NFC').replace(/\t/g, '    ');
  if (!normalized) return [''];
  const wrapped: string[] = [];
  let current = '';
  for (const char of Array.from(normalized)) {
    const candidate = current + char;
    if (current && textWidth(candidate, size, fonts) > maxWidth) {
      wrapped.push(current);
      current = char;
      if (textWidth(current, size, fonts) > maxWidth) throw new Error('PDF_UNICODE_GLYPH_TOO_WIDE');
    } else {
      current = candidate;
    }
  }
  wrapped.push(current);
  return wrapped;
}

function drawMixedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  fonts: PdfFonts,
  color = rgb(0.13, 0.16, 0.2),
): void {
  if (!text) return;
  const chars = Array.from(text);
  let cursor = x;
  let run = '';
  let runFont = fontFor(chars[0], fonts);
  const flush = () => {
    if (!run) return;
    page.drawText(run, { x: cursor, y, size, font: runFont, color });
    cursor += runFont.widthOfTextAtSize(run, size);
    run = '';
  };
  for (const char of chars) {
    const nextFont = fontFor(char, fonts);
    if (nextFont !== runFont) {
      flush();
      runFont = nextFont;
    }
    run += char;
  }
  flush();
}

function pageWithHeader(pdfDoc: PDFDocument): PDFPage {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  page.drawLine({
    start: { x: MARGIN_X, y: A4_HEIGHT - 40 },
    end: { x: A4_WIDTH - MARGIN_X, y: A4_HEIGHT - 40 },
    thickness: 0.6,
    color: rgb(0.88, 0.9, 0.93),
  });
  return page;
}

function drawFooter(page: PDFPage, pageNumber: number, fonts: PdfFonts): void {
  const label = String(pageNumber);
  const width = Array.from(label).reduce((sum, char) => sum + fontFor(char, fonts).widthOfTextAtSize(char, FOOTER_SIZE), 0);
  let cursor = (A4_WIDTH - width) / 2;
  for (const char of Array.from(label)) {
    const nextFont = fontFor(char, fonts);
    page.drawText(char, { x: cursor, y: 28, size: FOOTER_SIZE, font: nextFont, color: rgb(0.45, 0.49, 0.55) });
    cursor += nextFont.widthOfTextAtSize(char, FOOTER_SIZE);
  }
}

export async function makeUnicodePdfV12(titleInput: string, contentInput: string): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const title = titleInput.normalize('NFC').replace(/[\r\n\t]+/g, ' ').trim() || 'ORIGIN Artifact';
    const content = contentInput.normalize('NFC').replace(/\r\n|\r/g, '\n');
    const fonts = await loadFontsForText(pdfDoc, `${title}\n${content}\n0123456789`);
    const maxWidth = A4_WIDTH - MARGIN_X * 2;
    const titleLines = wrapLine(title, maxWidth, TITLE_SIZE, fonts);
    const bodyLines = content.split('\n').flatMap(line => wrapLine(line, maxWidth, BODY_SIZE, fonts));

    let page = pageWithHeader(pdfDoc);
    let pageNumber = 1;
    let y = TOP_Y;
    for (const line of titleLines) {
      if (y < BOTTOM_Y + TITLE_LINE_HEIGHT) {
        drawFooter(page, pageNumber++, fonts);
        page = pageWithHeader(pdfDoc);
        y = TOP_Y;
      }
      drawMixedText(page, line, MARGIN_X, y, TITLE_SIZE, fonts, rgb(0.06, 0.31, 0.53));
      y -= TITLE_LINE_HEIGHT;
    }
    y -= 8;
    for (const line of bodyLines) {
      if (y < BOTTOM_Y + BODY_LINE_HEIGHT) {
        drawFooter(page, pageNumber++, fonts);
        page = pageWithHeader(pdfDoc);
        y = TOP_Y;
      }
      drawMixedText(page, line, MARGIN_X, y, BODY_SIZE, fonts);
      y -= BODY_LINE_HEIGHT;
    }
    drawFooter(page, pageNumber, fonts);

    pdfDoc.setTitle(title);
    pdfDoc.setCreator('ORIGIN Personal');
    pdfDoc.setProducer('ORIGIN Artifact V1.2 Unicode PDF');
    const bytes = await pdfDoc.save({ useObjectStreams: false });
    const buffer = Buffer.from(bytes);
    if (buffer.length < 512 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('PDF_UNICODE_RENDERING_INVALID');
    return buffer;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PDF_UNICODE_')) throw error;
    throw new Error('PDF_UNICODE_RENDERING_UNAVAILABLE');
  }
}
