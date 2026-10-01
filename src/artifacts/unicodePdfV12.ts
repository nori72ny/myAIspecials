import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
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

export const UNICODE_PDF_RENDERER_VERSION_V12 = 'unicode-pdf-renderer-v1' as const;

type PdfFonts = {
  japanese: PDFFont;
  latin: PDFFont;
};

function fontFile(name: 'japanese' | 'latin'): Uint8Array {
  const projectRequire = createRequire(resolve(process.cwd(), 'package.json'));
  const cssPath = projectRequire.resolve('@fontsource/noto-sans-jp/400.css');
  const path = join(dirname(cssPath), 'files', `noto-sans-jp-${name}-400-normal.woff2`);
  const bytes = readFileSync(path);
  if (bytes.length < 1_000 || bytes.length > MAX_FONT_BYTES) {
    throw new Error('PDF_UNICODE_FONT_INVALID');
  }
  return Uint8Array.from(bytes);
}

function isLatinCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0x024f
    || (code >= 0x2000 && code <= 0x206f)
    || (code >= 0x20a0 && code <= 0x20cf);
}

function fontFor(char: string, fonts: PdfFonts): PDFFont {
  return isLatinCharacter(char) ? fonts.latin : fonts.japanese;
}

function textWidth(text: string, size: number, fonts: PdfFonts): number {
  let width = 0;
  for (const char of Array.from(text)) {
    width += fontFor(char, fonts).widthOfTextAtSize(char, size);
  }
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
      if (textWidth(current, size, fonts) > maxWidth) {
        throw new Error('PDF_UNICODE_GLYPH_TOO_WIDE');
      }
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
  let runFont = fontFor(chars[0] ?? '', fonts);

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
  const width = fonts.latin.widthOfTextAtSize(label, FOOTER_SIZE);
  page.drawText(label, {
    x: (A4_WIDTH - width) / 2,
    y: 28,
    size: FOOTER_SIZE,
    font: fonts.latin,
    color: rgb(0.45, 0.49, 0.55),
  });
}

export async function makeUnicodePdfV12(titleInput: string, contentInput: string): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const [japaneseBytes, latinBytes] = [fontFile('japanese'), fontFile('latin')];
    const [japanese, latin] = await Promise.all([
      pdfDoc.embedFont(japaneseBytes, { subset: true }),
      pdfDoc.embedFont(latinBytes, { subset: true }),
    ]);
    const fonts: PdfFonts = { japanese, latin };

    const title = titleInput.normalize('NFC').replace(/[\r\n\t]+/g, ' ').trim() || 'ORIGIN Artifact';
    const content = contentInput.normalize('NFC').replace(/\r\n|\r/g, '\n');
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
    if (buffer.length < 512 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('PDF_UNICODE_RENDERING_INVALID');
    }
    return buffer;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PDF_UNICODE_')) throw error;
    if (process.env.ORIGIN_PDF_DIAGNOSTIC === 'true') {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`PDF_UNICODE_RENDERING_UNAVAILABLE:${reason.slice(0, 240)}`);
    }
    throw new Error('PDF_UNICODE_RENDERING_UNAVAILABLE');
  }
}
