/**
 * Document Inspection V1 — 資料ファイルの実ファイル検査ハーネス（DG-0）。
 *
 * 設計の正本: ~/workspace/origin-fix/DOCUMENT_GENERATION_PROGRAM_2026-11-22.md §5 DG-0
 * - 生成された PPTX／XLSX／DOCX／PDF を「実際に開けるか」「数値が入力と一致するか」
 *   「テキストが描画領域に収まる見込みか」を決定的に検査する土台。
 * - 本番経路には接続しない。スイッチ・env・既存モジュールの挙動は一切変えない。
 * - 依存は Node 標準（zlib）と既存依存 pdf-lib のみ。費用 $0・外部送信なし。
 *
 * 検査の段階:
 *  (a) 形式の正しさ: ZIP を自前リーダーで読み（CRC 照合つき）、必須パーツの存在と
 *      全 XML パーツの整形式を検査する。PDF は pdf-lib の実パーサで開く。
 *  (b) 数値抽出照合: ファイル内テキストから数値を抽出し、入力側テキストの数値と
 *      全数照合する。正規化規則は既存の自己チェック（proposalDeckSelfCheckV1）と
 *      同一（NFKC・桁区切り除去・先行/末尾ゼロの正規化、多重集合で比較）。
 *  (c) はみ出し見積もり（PPTX）: スライド XML の図形寸法とフォントサイズから
 *      テキストの必要高さを見積もり、描画領域を超える図形を検出する。
 *      あくまで見積もりであり、実レンダリング検査（LibreOffice 画像化）は
 *      ランナースクリプト側の能力検出つきステージが担う。
 */

import { inflateRawSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

/* ================= ZIP リーダー ================= */

const ZIP_MAX_ENTRIES = 4096;
const ZIP_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipReadResult {
  ok: boolean;
  /** パーツ名 → 展開済みバイト列（読み取りに成功したものだけ）。 */
  entries: Map<string, Buffer>;
  entryNames: string[];
  errors: string[];
}

/**
 * ZIP アーカイブを読み、中央ディレクトリ・CRC・展開サイズを検証する。
 * ORIGIN 自身の zipStore（stored）だけでなく、一般の OOXML（deflate）も読む。
 */
export function readZipArchive(bytes: Buffer): ZipReadResult {
  const errors: string[] = [];
  const entries = new Map<string, Buffer>();
  const fail = (message: string): ZipReadResult => ({
    ok: false,
    entries,
    entryNames: [...entries.keys()],
    errors: [...errors, message],
  });

  if (bytes.length < 22) return fail("zip: too small for an archive");
  // End Of Central Directory を末尾から探す（コメント最大 65535 バイト）。
  let eocd = -1;
  const scanStart = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return fail("zip: end-of-central-directory not found");
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (totalEntries > ZIP_MAX_ENTRIES) {
    return fail(`zip: too many entries (${totalEntries})`);
  }
  if (cdOffset >= bytes.length) return fail("zip: central directory offset out of range");

  let cursor = cdOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < totalEntries; index++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      return fail(`zip: central directory entry ${index} is malformed`);
    }
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;

    if (
      localOffset + 30 > bytes.length ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      return fail(`zip: local header for "${name}" is malformed`);
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) {
      return fail(`zip: data for "${name}" is truncated`);
    }

    let data: Buffer;
    try {
      if (method === 0) {
        data = Buffer.from(compressed);
      } else if (method === 8) {
        data = inflateRawSync(compressed, { maxOutputLength: ZIP_MAX_TOTAL_BYTES });
      } else {
        return fail(`zip: unsupported compression method ${method} for "${name}"`);
      }
    } catch {
      return fail(`zip: cannot inflate "${name}"`);
    }
    if (data.length !== uncompressedSize) {
      return fail(`zip: size mismatch for "${name}"`);
    }
    if (crc32(data) !== expectedCrc) {
      return fail(`zip: CRC mismatch for "${name}"`);
    }
    totalUncompressed += data.length;
    if (totalUncompressed > ZIP_MAX_TOTAL_BYTES) {
      return fail("zip: total uncompressed size exceeds the inspection cap");
    }
    entries.set(name, data);
  }

  return { ok: errors.length === 0, entries, entryNames: [...entries.keys()], errors };
}

/* ================= XML スキャナ（整形式チェック＋テキスト抽出） ================= */

type XmlEvent =
  | { kind: "start"; name: string; selfClosing: boolean }
  | { kind: "end"; name: string }
  | { kind: "text"; text: string };

const XML_NAME_PATTERN = /^[A-Za-z_:\u0080-\uFFFF][\w.:-\u0080-\uFFFF]*$/;
const XML_ENTITY_PATTERN = /^&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/;

export function decodeXmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (whole, body: string) => {
      switch (body) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default: {
          const codePoint = body.startsWith("#x")
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
          return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : whole;
        }
      }
    },
  );
}

function validateTextEntities(text: string): string | null {
  let index = text.indexOf("&");
  while (index >= 0) {
    if (!XML_ENTITY_PATTERN.test(text.slice(index))) {
      return `invalid entity reference at offset ${index}`;
    }
    index = text.indexOf("&", index + 1);
  }
  return null;
}

/**
 * XML を走査し、イベント列と最初の整形式エラーを返す。
 * 要素の対応（開始/終了タグの一致）と単一ルートも検証する。
 */
function scanXml(xml: string): { events: XmlEvent[]; error: string | null } {
  const events: XmlEvent[] = [];
  const stack: string[] = [];
  let rootSeen = false;
  let i = 0;
  const fail = (error: string) => ({ events, error });

  while (i < xml.length) {
    if (xml[i] !== "<") {
      const next = xml.indexOf("<", i);
      const raw = xml.slice(i, next < 0 ? xml.length : next);
      const entityError = validateTextEntities(raw);
      if (entityError) return fail(entityError);
      if (stack.length === 0 && raw.trim() !== "") {
        return fail("text outside the root element");
      }
      events.push({ kind: "text", text: decodeXmlEntities(raw) });
      i = next < 0 ? xml.length : next;
      continue;
    }
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end < 0) return fail("unterminated comment");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 9);
      if (end < 0) return fail("unterminated CDATA section");
      events.push({ kind: "text", text: xml.slice(i + 9, end) });
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i + 2);
      if (end < 0) return fail("unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (xml.startsWith("<!", i)) {
      // DOCTYPE 等: 内部サブセット [ ... ] を読み飛ばす。
      let j = i + 2;
      let bracketDepth = 0;
      let closed = false;
      while (j < xml.length) {
        if (xml[j] === "[") bracketDepth++;
        else if (xml[j] === "]") bracketDepth--;
        else if (xml[j] === ">" && bracketDepth <= 0) {
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) return fail("unterminated declaration");
      i = j + 1;
      continue;
    }
    if (xml.startsWith("</", i)) {
      const end = xml.indexOf(">", i + 2);
      if (end < 0) return fail("unterminated end tag");
      const name = xml.slice(i + 2, end).trim();
      if (!XML_NAME_PATTERN.test(name)) return fail(`invalid end tag name "${name}"`);
      const open = stack.pop();
      if (open !== name) {
        return fail(`mismatched end tag: expected </${open ?? "?"}>, found </${name}>`);
      }
      events.push({ kind: "end", name });
      i = end + 1;
      continue;
    }
    // 開始タグ: 名前と属性（引用符内を正しく読み飛ばす）。
    let j = i + 1;
    const nameStart = j;
    while (j < xml.length && !/[\s/>]/.test(xml[j])) j++;
    const name = xml.slice(nameStart, j);
    if (!XML_NAME_PATTERN.test(name)) return fail(`invalid tag name "${name}"`);
    let selfClosing = false;
    let closed = false;
    while (j < xml.length) {
      while (j < xml.length && /\s/.test(xml[j])) j++;
      if (xml.startsWith("/>", j)) {
        selfClosing = true;
        closed = true;
        j += 2;
        break;
      }
      if (xml[j] === ">") {
        closed = true;
        j += 1;
        break;
      }
      const attrStart = j;
      while (j < xml.length && !/[\s=/>]/.test(xml[j])) j++;
      const attrName = xml.slice(attrStart, j);
      if (!XML_NAME_PATTERN.test(attrName)) {
        return fail(`invalid attribute name "${attrName}" in <${name}>`);
      }
      while (j < xml.length && /\s/.test(xml[j])) j++;
      if (xml[j] !== "=") return fail(`attribute "${attrName}" in <${name}> has no value`);
      j++;
      while (j < xml.length && /\s/.test(xml[j])) j++;
      const quote = xml[j];
      if (quote !== '"' && quote !== "'") {
        return fail(`attribute "${attrName}" in <${name}> is not quoted`);
      }
      const valueEnd = xml.indexOf(quote, j + 1);
      if (valueEnd < 0) return fail(`unterminated attribute "${attrName}" in <${name}>`);
      const value = xml.slice(j + 1, valueEnd);
      if (value.includes("<")) {
        return fail(`attribute "${attrName}" in <${name}> contains "<"`);
      }
      const entityError = validateTextEntities(value);
      if (entityError) return fail(`attribute "${attrName}" in <${name}>: ${entityError}`);
      j = valueEnd + 1;
    }
    if (!closed) return fail(`unterminated tag <${name}>`);
    if (stack.length === 0) {
      if (rootSeen) return fail("multiple root elements");
      rootSeen = true;
    }
    events.push({ kind: "start", name, selfClosing });
    if (!selfClosing) stack.push(name);
    else events.push({ kind: "end", name });
    i = j;
  }

  if (stack.length > 0) return fail(`unclosed element <${stack[stack.length - 1]}>`);
  if (!rootSeen) return fail("no root element");
  return { events, error: null };
}

export function checkXmlWellFormed(xml: string): { ok: boolean; error?: string } {
  const { error } = scanXml(xml);
  return error ? { ok: false, error } : { ok: true };
}

function localNameOf(name: string): string {
  const index = name.lastIndexOf(":");
  return index >= 0 ? name.slice(index + 1) : name;
}

/** 指定したローカル名の要素の直下テキストを出現順に抽出する（例: a:t の "t"）。 */
export function extractXmlTextValues(xml: string, localNames: ReadonlySet<string>): string[] {
  const { events, error } = scanXml(xml);
  if (error) return [];
  const values: string[] = [];
  const stack: string[] = [];
  for (const event of events) {
    if (event.kind === "start") {
      stack.push(event.name);
    } else if (event.kind === "end") {
      stack.pop();
    } else {
      const current = stack[stack.length - 1];
      if (current && localNames.has(localNameOf(current))) values.push(event.text);
    }
  }
  return values;
}

/* ================= 数値抽出・全数照合 =================
 * 正規化規則は proposalDeckSelfCheckV1 の数値保全チェックと同一に揃える
 * （NFKC 正規化・桁区切り除去・先行ゼロ/末尾ゼロの正規化、多重集合で比較）。
 * これにより、既存ゲートの結果とハーネスの照合結果が同じ物差しで比較できる。
 */

const NUMERIC_TOKEN_PATTERN = /\d+(?:\.\d+)?/g;

function normalizeNumericToken(token: string): string {
  const dotIndex = token.indexOf(".");
  const intPart = dotIndex >= 0 ? token.slice(0, dotIndex) : token;
  const fracPart = dotIndex >= 0 ? token.slice(dotIndex + 1) : "";
  const intNormalized = intPart.replace(/^0+(?=\d)/, "");
  const fracNormalized = fracPart.replace(/0+$/, "");
  return fracNormalized === "" ? intNormalized : `${intNormalized}.${fracNormalized}`;
}

/** テキストから数値トークン（正規形）を出現順に抽出する。 */
export function extractNumericTokens(text: string): string[] {
  const normalized = text.normalize("NFKC").replace(/,/g, "");
  const tokens: string[] = [];
  for (const match of normalized.matchAll(NUMERIC_TOKEN_PATTERN)) {
    tokens.push(normalizeNumericToken(match[0]));
  }
  return tokens;
}

export function countNumericTokens(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of extractNumericTokens(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return counts;
}

export interface NumericTokenDiff {
  token: string;
  /** 片側にだけある個数（不足分／余分）。 */
  count: number;
}

export interface NumericReconciliation {
  ok: boolean;
  sourceTotal: number;
  documentTotal: number;
  /** 入力側にあるのに資料側に無い数値（落ちた数値）。 */
  missing: NumericTokenDiff[];
  /** 資料側にあるのに入力側に無い数値（増えた数値＝創作の疑い）。 */
  unexpected: NumericTokenDiff[];
}

function compareToken(a: string, b: string): number {
  const diff = Number(a) - Number(b);
  return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 資料側テキストの数値集合と、入力側テキストの数値集合を全数照合する。
 * 多重集合として比較するため、同じ数値の出現回数の増減も検出する。
 */
export function reconcileNumericTokens(
  documentTexts: readonly string[],
  sourceTexts: readonly string[],
): NumericReconciliation {
  const documentCounts = countNumericTokens(documentTexts);
  const sourceCounts = countNumericTokens(sourceTexts);
  const missing: NumericTokenDiff[] = [];
  const unexpected: NumericTokenDiff[] = [];
  let sourceTotal = 0;
  let documentTotal = 0;
  for (const [token, count] of sourceCounts) {
    sourceTotal += count;
    const inDocument = documentCounts.get(token) ?? 0;
    if (inDocument < count) missing.push({ token, count: count - inDocument });
  }
  for (const [token, count] of documentCounts) {
    documentTotal += count;
    const inSource = sourceCounts.get(token) ?? 0;
    if (inSource < count) unexpected.push({ token, count: count - inSource });
  }
  missing.sort((a, b) => compareToken(a.token, b.token));
  unexpected.sort((a, b) => compareToken(a.token, b.token));
  return {
    ok: missing.length === 0 && unexpected.length === 0,
    sourceTotal,
    documentTotal,
    missing,
    unexpected,
  };
}

/* ================= OOXML 検査 ================= */

export type OoxmlFormat = "pptx" | "xlsx" | "docx";
export type DocumentFileFormat = OoxmlFormat | "pdf";

export interface OoxmlInspection {
  format: OoxmlFormat;
  ok: boolean;
  errors: string[];
  partNames: string[];
  malformedParts: Array<{ part: string; error: string }>;
  /** pptx のみ: スライド数。それ以外は null。 */
  slideCount: number | null;
  /** xlsx のみ: シート数。それ以外は null。 */
  sheetCount: number | null;
  textsByPart: Array<{ part: string; text: string }>;
  /**
   * 数値照合用のテキスト。PPTX では、描画側が付ける番号付きリストのマーカー
   * （数字＋ピリオドだけの run）は内容の数値ではないため、照合用からだけ除く。
   * allText（原文のまま）とは別に持ち、使い分けを明示する。
   */
  numericTextsByPart: Array<{ part: string; text: string }>;
  allText: string;
}

const REQUIRED_PARTS: Record<OoxmlFormat, string[]> = {
  pptx: ["[Content_Types].xml", "ppt/presentation.xml"],
  xlsx: ["[Content_Types].xml", "xl/workbook.xml"],
  docx: ["[Content_Types].xml", "word/document.xml"],
};

function partSortKey(name: string): [string, number] {
  const match = name.match(/^(.*?)(\d+)(\.xml)$/);
  return match ? [match[1], Number(match[2])] : [name, 0];
}

function comparePartNames(a: string, b: string): number {
  const [prefixA, numA] = partSortKey(a);
  const [prefixB, numB] = partSortKey(b);
  if (prefixA !== prefixB) return prefixA < prefixB ? -1 : 1;
  return numA - numB;
}

/**
 * OOXML ファイル（PPTX／XLSX／DOCX）を実際に開いて検査する。
 * ZIP の読み取り（CRC 照合つき）→ 必須パーツの存在 → 全 XML パーツの整形式 →
 * テキスト抽出までを決定的に行う。
 */
export function inspectOoxmlDocument(bytes: Buffer, format: OoxmlFormat): OoxmlInspection {
  const errors: string[] = [];
  const malformedParts: Array<{ part: string; error: string }> = [];
  const textsByPart: Array<{ part: string; text: string }> = [];
  const numericTextsByPart: Array<{ part: string; text: string }> = [];

  const zip = readZipArchive(bytes);
  if (!zip.ok) {
    return {
      format,
      ok: false,
      errors: zip.errors,
      partNames: zip.entryNames,
      malformedParts,
      slideCount: null,
      sheetCount: null,
      textsByPart,
      numericTextsByPart,
      allText: "",
    };
  }

  for (const required of REQUIRED_PARTS[format]) {
    if (!zip.entries.has(required)) errors.push(`missing required part: ${required}`);
  }

  const partNames = [...zip.entries.keys()].sort(comparePartNames);
  const xmlByPart = new Map<string, string>();
  for (const name of partNames) {
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      const xml = zip.entries.get(name)!.toString("utf8");
      xmlByPart.set(name, xml);
      const check = checkXmlWellFormed(xml);
      if (!check.ok) malformedParts.push({ part: name, error: check.error ?? "malformed" });
    }
  }
  if (malformedParts.length > 0) {
    errors.push(
      `malformed XML parts: ${malformedParts.map((item) => item.part).join(", ")}`,
    );
  }

  let slideCount: number | null = null;
  let sheetCount: number | null = null;
  if (format === "pptx") {
    const slides = partNames.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    slideCount = slides.length;
    if (slides.length === 0) errors.push("no slides found");
    for (const slide of slides) {
      const values = extractXmlTextValues(xmlByPart.get(slide) ?? "", new Set(["t"]));
      textsByPart.push({ part: slide, text: values.join("") });
      numericTextsByPart.push({
        part: slide,
        text: values.filter((value) => !/^\s*\d+\.\s*$/.test(value)).join(""),
      });
    }
  } else if (format === "xlsx") {
    const shared = xmlByPart.get("xl/sharedStrings.xml");
    if (shared) {
      textsByPart.push({
        part: "xl/sharedStrings.xml",
        text: extractXmlTextValues(shared, new Set(["t"])).join("\n"),
      });
    }
    const sheets = partNames.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    sheetCount = sheets.length;
    if (sheets.length === 0) errors.push("no worksheets found");
    for (const sheet of sheets) {
      const values = extractXmlTextValues(xmlByPart.get(sheet) ?? "", new Set(["t", "v"]));
      textsByPart.push({ part: sheet, text: values.join("\n") });
    }
  } else {
    const docParts = partNames.filter(
      (name) => name === "word/document.xml" || /^word\/(header|footer)\d+\.xml$/.test(name),
    );
    for (const part of docParts) {
      const text = extractXmlTextValues(xmlByPart.get(part) ?? "", new Set(["t"])).join("");
      textsByPart.push({ part, text });
    }
  }

  if (format !== "pptx") {
    for (const item of textsByPart) numericTextsByPart.push(item);
  }

  return {
    format,
    ok: errors.length === 0,
    errors,
    partNames,
    malformedParts,
    slideCount,
    sheetCount,
    textsByPart,
    numericTextsByPart,
    allText: textsByPart.map((item) => item.text).join("\n"),
  };
}

/* ================= PPTX はみ出し見積もり =================
 * スライド XML の図形寸法（a:ext）とフォントサイズ（a:rPr の sz）から、
 * テキストの必要高さを見積もり、描画領域を超える図形を検出する。
 * 行高は「単一改行 = フォントサイズ × 1.2」に spcPct の倍率を掛けて見積もる。
 * 文字幅は全角 1.0em・半角 0.55em の近似。実レンダリングとは差が出るため、
 * OVERFLOW_TOLERANCE_PT を超えるものだけを「はみ出し見込み」として数える。
 */

export const OVERFLOW_TOLERANCE_PT = 2;
const EMU_PER_PT = 12700;
const DEFAULT_RUN_SIZE_HUNDREDTHS = 1800;
const DEFAULT_INSET_X_EMU = 91440;
const DEFAULT_INSET_Y_EMU = 45720;

export interface ShapeOverflowEstimate {
  slidePart: string;
  shapeName: string;
  textChars: number;
  boxWidthPt: number;
  boxHeightPt: number;
  estimatedTextHeightPt: number;
  overflowPt: number;
}

export interface PptxOverflowReport {
  estimates: ShapeOverflowEstimate[];
  overflowing: ShapeOverflowEstimate[];
  /** テキストはあるが寸法が取れず見積もりを省略した図形の数。 */
  skippedShapes: number;
}

function isFullWidthChar(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    codePoint >= 0x20000
  );
}

function textWidthPt(text: string, sizePt: number): number {
  let width = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    width += (isFullWidthChar(codePoint) ? 1.0 : 0.55) * sizePt;
  }
  return width;
}

function attrNumber(source: string, name: string): number | null {
  const match = source.match(new RegExp(`\\b${name}="(\\d+)"`));
  return match ? Number(match[1]) : null;
}

interface ParagraphEstimate {
  heightPt: number;
  maxRunSizePt: number;
  chars: number;
}

function estimateParagraph(
  paraXml: string,
  availableWidthPt: number,
): ParagraphEstimate {
  const spcPct = attrNumber(paraXml.match(/<a:lnSpc>[\s\S]*?<\/a:lnSpc>/)?.[0] ?? "", "val");
  const spcAftHundredths = attrNumber(
    paraXml.match(/<a:spcAft>[\s\S]*?<\/a:spcAft>/)?.[0] ?? "",
    "val",
  );
  const endParaSize = attrNumber(
    paraXml.match(/<a:endParaRPr[^>]*>/)?.[0] ?? "",
    "sz",
  );
  let widthPt = 0;
  let maxRunSizePt = (endParaSize ?? DEFAULT_RUN_SIZE_HUNDREDTHS) / 100;
  let chars = 0;
  for (const runMatch of paraXml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
    const runXml = runMatch[1];
    const sizeHundredths =
      attrNumber(runXml.match(/<a:rPr[^>]*>/)?.[0] ?? "", "sz") ??
      endParaSize ??
      DEFAULT_RUN_SIZE_HUNDREDTHS;
    const sizePt = sizeHundredths / 100;
    if (sizePt > maxRunSizePt) maxRunSizePt = sizePt;
    const textMatch = runXml.match(/<a:t>([\s\S]*?)<\/a:t>/);
    const text = textMatch ? decodeXmlEntities(textMatch[1]) : "";
    chars += [...text].length;
    widthPt += textWidthPt(text, sizePt);
  }
  const explicitBreaks = (paraXml.match(/<a:br\s*\/>/g) ?? []).length;
  const lines =
    availableWidthPt > 0
      ? Math.max(1, Math.ceil(widthPt / availableWidthPt - 1e-9) + explicitBreaks)
      : 1 + explicitBreaks;
  const lineHeightPt = maxRunSizePt * 1.2 * (spcPct ? spcPct / 100000 : 1);
  const heightPt = lines * lineHeightPt + (spcAftHundredths ? spcAftHundredths / 100 : 0);
  return { heightPt, maxRunSizePt, chars };
}

function estimateShape(
  slidePart: string,
  shapeXml: string,
): ShapeOverflowEstimate | "skip" | null {
  const textValues = extractXmlTextValues(shapeXml, new Set(["t"]));
  const allText = textValues.join("");
  if (allText.trim() === "") return null;
  const extMatch = shapeXml.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/);
  if (!extMatch) return "skip";
  const cx = Number(extMatch[1]);
  const cy = Number(extMatch[2]);
  const bodyPrAttrs = shapeXml.match(/<a:bodyPr[^>]*>/)?.[0] ?? "";
  const lIns = attrNumber(bodyPrAttrs, "lIns") ?? DEFAULT_INSET_X_EMU;
  const rIns = attrNumber(bodyPrAttrs, "rIns") ?? DEFAULT_INSET_X_EMU;
  const tIns = attrNumber(bodyPrAttrs, "tIns") ?? DEFAULT_INSET_Y_EMU;
  const bIns = attrNumber(bodyPrAttrs, "bIns") ?? DEFAULT_INSET_Y_EMU;
  const nameMatch = shapeXml.match(/<p:cNvPr[^>]*\bname="([^"]*)"/);
  const availableWidthPt = Math.max(0, (cx - lIns - rIns) / EMU_PER_PT);
  const availableHeightPt = Math.max(0, (cy - tIns - bIns) / EMU_PER_PT);

  let textHeightPt = 0;
  let chars = 0;
  for (const paraMatch of shapeXml.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\s*\/>/g)) {
    const estimate = estimateParagraph(paraMatch[1] ?? "", availableWidthPt);
    textHeightPt += estimate.heightPt;
    chars += estimate.chars;
  }
  const overflowPt = Math.max(0, textHeightPt - availableHeightPt);
  return {
    slidePart,
    shapeName: nameMatch ? decodeXmlEntities(nameMatch[1]) : "",
    textChars: chars,
    boxWidthPt: Math.round(availableWidthPt * 10) / 10,
    boxHeightPt: Math.round(availableHeightPt * 10) / 10,
    estimatedTextHeightPt: Math.round(textHeightPt * 10) / 10,
    overflowPt: Math.round(overflowPt * 10) / 10,
  };
}

/** PPTX の全スライドについて、テキストのはみ出しを見積もる。 */
export function estimatePptxTextOverflow(bytes: Buffer): PptxOverflowReport {
  const zip = readZipArchive(bytes);
  const estimates: ShapeOverflowEstimate[] = [];
  let skippedShapes = 0;
  if (!zip.ok) return { estimates, overflowing: [], skippedShapes };
  const slides = [...zip.entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(comparePartNames);
  for (const slide of slides) {
    const xml = zip.entries.get(slide)!.toString("utf8");
    for (const shapeMatch of xml.matchAll(/<p:sp(?=[\s>])([\s\S]*?)<\/p:sp>/g)) {
      const result = estimateShape(slide, shapeMatch[0]);
      if (result === "skip") skippedShapes++;
      else if (result) estimates.push(result);
    }
  }
  return {
    estimates,
    overflowing: estimates.filter((item) => item.overflowPt > OVERFLOW_TOLERANCE_PT),
    skippedShapes,
  };
}

/* ================= PDF 検査 ================= */

export interface PdfInspection {
  ok: boolean;
  errors: string[];
  pageCount: number;
  pageSizesPt: Array<{ width: number; height: number }>;
}

/** PDF を pdf-lib の実パーサで開き、ページ数と寸法を取得する。 */
export async function inspectPdfDocument(bytes: Buffer): Promise<PdfInspection> {
  const errors: string[] = [];
  const headerWindow = bytes.subarray(0, 1024).toString("latin1");
  if (!headerWindow.includes("%PDF-")) errors.push("missing %PDF- header");
  try {
    // Buffer をそのまま渡すと、実行環境（vitest の jsdom 等）によっては
    // pdf-lib の Uint8Array 判定が別レルム扱いで落ちるため、コピーを渡す。
    const doc = await PDFDocument.load(new Uint8Array(bytes), {
      ignoreEncryption: false,
    });
    const pages = doc.getPages();
    if (pages.length === 0) errors.push("no pages");
    return {
      ok: errors.length === 0,
      errors,
      pageCount: pages.length,
      pageSizesPt: pages.map((page) => {
        const size = page.getSize();
        return {
          width: Math.round(size.width * 10) / 10,
          height: Math.round(size.height * 10) / 10,
        };
      }),
    };
  } catch (error) {
    return {
      ok: false,
      errors: [
        ...errors,
        `pdf-lib load failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pageCount: 0,
      pageSizesPt: [],
    };
  }
}

/* ================= 統合エントリ ================= */

export type NumericInspection =
  | { stage: "done"; result: NumericReconciliation }
  | { stage: "unsupported"; reason: string };

export interface DocumentInspection {
  format: DocumentFileFormat;
  /** 実パーサ／構造検査で「開ける」と判定できたか。 */
  openOk: boolean;
  errors: string[];
  ooxml?: OoxmlInspection;
  pdf?: PdfInspection;
  /** sourceTexts を渡した場合のみ。PDF は in-process のテキスト抽出が未対応。 */
  numeric?: NumericInspection;
  /** pptx のみ。 */
  overflow?: PptxOverflowReport;
  extractedTextLength: number;
}

/**
 * 資料バイト列の検査をまとめて実行する。
 * sourceTexts（依頼文・素材・原稿など入力側のテキスト群）を渡すと、
 * 資料内テキストの数値との全数照合も行う。
 */
export async function inspectDocumentBytes(
  bytes: Buffer,
  format: DocumentFileFormat,
  sourceTexts?: readonly string[],
): Promise<DocumentInspection> {
  if (format === "pdf") {
    const pdf = await inspectPdfDocument(bytes);
    return {
      format,
      openOk: pdf.ok,
      errors: pdf.errors,
      pdf,
      numeric: sourceTexts
        ? {
            stage: "unsupported",
            reason:
              "PDF のテキスト抽出は in-process では未対応。ランナーの pdftotext ステージで代替する。",
          }
        : undefined,
      extractedTextLength: 0,
    };
  }

  const ooxml = inspectOoxmlDocument(bytes, format);
  return {
    format,
    openOk: ooxml.ok,
    errors: ooxml.errors,
    ooxml,
    numeric: sourceTexts
      ? {
          stage: "done",
          result: reconcileNumericTokens(
            ooxml.numericTextsByPart.map((item) => item.text),
            sourceTexts,
          ),
        }
      : undefined,
    overflow: format === "pptx" ? estimatePptxTextOverflow(bytes) : undefined,
    extractedTextLength: ooxml.allText.length,
  };
}
