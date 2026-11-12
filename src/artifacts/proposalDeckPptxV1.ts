/**
 * ProposalDeck PPTX Renderer V1 — ProposalDeck を 16:9 スライドの PPTX に描く決定的レンダラー。
 *
 * 設計の正本: ~/workspace/origin-fix/PROPOSAL_PIPELINE_DESIGN_2026-11-12.md §2〜§3
 * - テンプレート5種: 表紙 / 要約 / 本文 / 図表（table・bar・steps）/ 締め
 * - 色・文字サイズは proposalDeckV1 のデザイントークン（PROPOSAL_DESIGN_TOKENS /
 *   PROPOSAL_COLOR_TOKENS / PROPOSAL_CATEGORY_COLOR_TOKENS）経由でのみ参照する
 * - フォントは全テキストに Noto Sans JP を明示する（同梱フォント前提、PR-3 の PDF と同じ前提）
 * - 同期・決定的（同じ deck には同じバイト列）。モデル呼び出しなし、追加コストなし
 * - deck は自己チェック合格済みの形が前提だが、壊れた入力（欠けたフィールド等）でも
 *   例外を投げず、空として扱って最低限のスライドを返す
 * - visual には数値データが含まれないため、グラフの数値は捏造しない。
 *   bar は軸とゼロ基線のフレームまで（データ付きグラフは後段フェーズの担当）
 *
 * パッケージ構造（[Content_Types] / rels / master / layout / theme）は
 * 既存生成器 artifactGeneratorV12 の makePptx と同じ組み立てで、ZIP 化は zipStore を再利用する。
 */

import { zipStore } from './zipStore.js';
import {
  PROPOSAL_CATEGORY_COLOR_TOKEN_NAMES,
  PROPOSAL_CATEGORY_COLOR_TOKENS,
  PROPOSAL_COLOR_TOKENS,
  PROPOSAL_DESIGN_TOKENS,
  type ProposalDeck,
  type ProposalDeckVisualKind,
} from './proposalDeckV1.js';

const PPT_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAW_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const FONT_FACE = 'Noto Sans JP';

/* ---- レイアウト定数（EMU、スライド 16:9 = 12192000 × 6858000） ---- */
const EMU_PER_INCH = 914400;
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;
/** 左右マージン 0.9in（設計 §2 のグリッド）。 */
const MARGIN_X = Math.round(0.9 * EMU_PER_INCH);
const CONTENT_W = SLIDE_W - MARGIN_X * 2;
const ACCENT_BAR_W = 152400;

/** コンテンツ系スライド共通の見出し配置。 */
const HEADLINE_Y = 457200;
const HEADLINE_H = 1371600;
const RULE_Y = 1920240;
const BODY_Y = 2286000;

/* ---- トークンから導くタイポグラフィ（sz は 1/100 pt） ---- */
const TYPO = PROPOSAL_DESIGN_TOKENS.typography;
const TITLE_SZ = TYPO.titlePt * 100;
const HEADLINE_SZ = TYPO.headlinePt * 100;
const SUBTITLE_SZ = TYPO.bodyPt.max * 100;
const SUMMARY_POINT_SZ = TYPO.bodyPt.max * 100;
/** 本文は bodyPt の中点（14〜18 → 16pt）。 */
const BODY_PT = Math.round((TYPO.bodyPt.min + TYPO.bodyPt.max) / 2);
const BODY_SZ = BODY_PT * 100;
const SMALL_SZ = TYPO.bodyPt.min * 100;
const NOTE_SZ = TYPO.notePtMin * 100;
/** 行間は lineHeight の中点（1.2〜1.3 → 125%）。 */
const LINE_PCT = Math.round(((TYPO.lineHeight.min + TYPO.lineHeight.max) / 2) * 100000);

/** '#0F6CBD' → '0F6CBD'（DrawingML の srgbClr 形式）。 */
function hex6(tokenValue: string): string {
  return tokenValue.replace(/^#/, '').toUpperCase();
}

const PAPER = hex6(PROPOSAL_COLOR_TOKENS.paper);
const INK = hex6(PROPOSAL_COLOR_TOKENS.ink);
const ACCENT = hex6(PROPOSAL_COLOR_TOKENS.accent);
const SLATE = hex6(PROPOSAL_COLOR_TOKENS.slate);

function categoryHex(index: number): string {
  const names = PROPOSAL_CATEGORY_COLOR_TOKEN_NAMES;
  return hex6(PROPOSAL_CATEGORY_COLOR_TOKENS[names[index % names.length]]);
}

/* ---- XML 部品 ---- */

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface RunSpec {
  text: string;
  size: number;
  color: string;
  bold?: boolean;
}

interface ParaSpec {
  runs: RunSpec[];
  align?: 'l' | 'ctr' | 'r';
  spcAft?: number;
}

function runXml(run: RunSpec): string {
  return `<a:r><a:rPr lang="ja-JP" sz="${run.size}"${run.bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${run.color}"/></a:solidFill><a:latin typeface="${FONT_FACE}"/><a:ea typeface="${FONT_FACE}"/></a:rPr><a:t>${escapeXml(run.text)}</a:t></a:r>`;
}

function paraXml(para: ParaSpec): string {
  const align = para.align && para.align !== 'l' ? ` algn="${para.align}"` : '';
  const spcAft = para.spcAft ? `<a:spcAft><a:spcPts val="${para.spcAft}"/></a:spcAft>` : '';
  const endSize = para.runs.length ? para.runs[para.runs.length - 1].size : BODY_SZ;
  return `<a:p><a:pPr${align}><a:lnSpc><a:spcPct val="${LINE_PCT}"/></a:lnSpc>${spcAft}</a:pPr>${para.runs.map(runXml).join('')}<a:endParaRPr lang="ja-JP" sz="${endSize}"><a:latin typeface="${FONT_FACE}"/><a:ea typeface="${FONT_FACE}"/></a:endParaRPr></a:p>`;
}

function txBodyXml(paras: ParaSpec[], anchor = 't'): string {
  const body = paras.length ? paras.map(paraXml).join('') : '<a:p/>';
  return `<p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody>`;
}

interface ShapeOptions {
  fill?: string | null;
  line?: string | null;
  lineWidth?: number;
  paras?: ParaSpec[];
  anchor?: string;
  prst?: string;
}

function shapeXml(id: number, name: string, x: number, y: number, cx: number, cy: number, opts: ShapeOptions = {}): string {
  const fillXml = opts.fill === null
    ? '<a:noFill/>'
    : opts.fill === undefined
      ? ''
      : `<a:solidFill><a:srgbClr val="${opts.fill}"/></a:solidFill>`;
  const lineXml = opts.line
    ? `<a:ln w="${opts.lineWidth ?? 12700}"><a:solidFill><a:srgbClr val="${opts.line}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  const txBody = opts.paras ? txBodyXml(opts.paras, opts.anchor ?? 't') : '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${opts.prst ?? 'rect'}"><a:avLst/></a:prstGeom>${fillXml}${lineXml}</p:spPr>${txBody}</p:sp>`;
}

function textBoxXml(id: number, name: string, x: number, y: number, cx: number, cy: number, paras: ParaSpec[], anchor = 't'): string {
  return shapeXml(id, name, x, y, cx, cy, { fill: null, line: null, paras, anchor });
}

/* ---- deck の防御的正規化（壊れた入力でも例外を投げない） ---- */

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

interface NormBullet { lead: string; detail: string }
interface NormVisual { kind: ProposalDeckVisualKind; title: string; colorHex: string | null }
interface NormSection { message: string; bullets: NormBullet[]; visual: NormVisual | null }
interface NormDeck {
  title: string;
  subtitle: string;
  presenter: string;
  date: string;
  summaryHeadline: string;
  points: string[];
  sections: NormSection[];
  ask: string;
  nextSteps: string[];
  assumptions: string[];
}

const VISUAL_KINDS: ReadonlySet<string> = new Set(['table', 'bar', 'steps']);

function normalizeDeck(input: ProposalDeck): NormDeck {
  const deck = (input ?? {}) as Partial<ProposalDeck>;
  const summary = (deck.summary ?? {}) as Partial<ProposalDeck['summary']>;
  const closing = (deck.closing ?? {}) as Partial<ProposalDeck['closing']>;

  const sections: NormSection[] = (Array.isArray(deck.sections) ? deck.sections : []).map((raw) => {
    const section = (raw ?? {}) as Partial<ProposalDeck['sections'][number]>;
    const bullets: NormBullet[] = (Array.isArray(section.bullets) ? section.bullets : []).map((rawBullet) => {
      const bullet = (rawBullet ?? {}) as Partial<NormBullet>;
      return { lead: textOf(bullet.lead), detail: textOf(bullet.detail) };
    });
    let visual: NormVisual | null = null;
    const rawVisual = section.visual as Partial<NonNullable<ProposalDeck['sections'][number]['visual']>> | undefined;
    if (rawVisual && VISUAL_KINDS.has(textOf(rawVisual.kind))) {
      const tokenName = textOf(rawVisual.colorToken);
      const colorHex = (PROPOSAL_COLOR_TOKENS as Record<string, string>)[tokenName]
        ? hex6((PROPOSAL_COLOR_TOKENS as Record<string, string>)[tokenName])
        : null;
      visual = {
        kind: textOf(rawVisual.kind) as ProposalDeckVisualKind,
        title: textOf(rawVisual.title),
        colorHex,
      };
    }
    return { message: textOf(section.message), bullets, visual };
  });

  return {
    title: textOf(deck.title),
    subtitle: textOf(deck.subtitle),
    presenter: textOf(deck.presenter),
    date: textOf(deck.date),
    summaryHeadline: textOf(summary.headline),
    points: (Array.isArray(summary.points) ? summary.points : []).map(textOf),
    sections,
    ask: textOf(closing.ask),
    nextSteps: (Array.isArray(closing.nextSteps) ? closing.nextSteps : []).map(textOf),
    assumptions: (Array.isArray(deck.assumptions) ? deck.assumptions : []).map(textOf),
  };
}

/* ---- スライドテンプレート ---- */

function slideXml(shapes: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function background(id: number): string {
  return shapeXml(id, 'Background', 0, 0, SLIDE_W, SLIDE_H, { fill: PAPER });
}

/** コンテンツ系スライド共通の見出し（結論の文＋アクセントルール）。 */
function headlineShapes(idStart: number, message: string): { shapes: string[]; nextId: number } {
  const shapes = [
    background(idStart),
    textBoxXml(idStart + 1, 'Headline', MARGIN_X, HEADLINE_Y, CONTENT_W, HEADLINE_H, [
      { runs: [{ text: message, size: HEADLINE_SZ, color: INK, bold: true }] },
    ]),
    shapeXml(idStart + 2, 'HeadlineRule', MARGIN_X, RULE_Y, 685800, 45720, { fill: ACCENT }),
  ];
  return { shapes, nextId: idStart + 3 };
}

function coverSlide(deck: NormDeck): string {
  let id = 2;
  const shapes: string[] = [
    background(id++),
    shapeXml(id++, 'AccentBar', 0, 0, ACCENT_BAR_W, SLIDE_H, { fill: ACCENT }),
    shapeXml(id++, 'TitleRule', MARGIN_X, 1700000, 914400, 63500, { fill: ACCENT }),
    textBoxXml(id++, 'Title', MARGIN_X, 1950000, CONTENT_W, 1750000, [
      { runs: [{ text: deck.title, size: TITLE_SZ, color: INK, bold: true }] },
    ]),
  ];
  if (deck.subtitle) {
    shapes.push(textBoxXml(id++, 'Subtitle', MARGIN_X, 3850000, CONTENT_W, 800000, [
      { runs: [{ text: deck.subtitle, size: SUBTITLE_SZ, color: SLATE }] },
    ]));
  }
  const meta = [deck.presenter, deck.date].filter(Boolean).join('　');
  if (meta) {
    shapes.push(textBoxXml(id++, 'Meta', MARGIN_X, 6000000, CONTENT_W, 420000, [
      { runs: [{ text: meta, size: NOTE_SZ, color: SLATE }] },
    ]));
  }
  return slideXml(shapes);
}

function summarySlide(deck: NormDeck): string {
  const { shapes, nextId } = headlineShapes(2, deck.summaryHeadline);
  let id = nextId;
  deck.points.forEach((point, index) => {
    const y = BODY_Y + index * 1250000;
    shapes.push(shapeXml(id++, `PointMarker${index + 1}`, MARGIN_X, y + 100000, 228600, 228600, { fill: ACCENT }));
    shapes.push(textBoxXml(id++, `Point${index + 1}`, MARGIN_X + 457200, y, CONTENT_W - 457200, 1100000, [
      { runs: [{ text: point, size: SUMMARY_POINT_SZ, color: INK }] },
    ]));
  });
  return slideXml(shapes);
}

/** bullets を「lead（bold・ink）＋detail（slate）」の段落列にする。 */
function bulletParas(bullets: NormBullet[], size: number, spcAft: number): ParaSpec[] {
  return bullets.map((bullet) => {
    const runs: RunSpec[] = [{ text: bullet.lead, size, color: INK, bold: true }];
    if (bullet.detail) runs.push({ text: ` ${bullet.detail}`, size, color: SLATE });
    return { runs, spcAft };
  });
}

function bodySlide(section: NormSection): string {
  const { shapes, nextId } = headlineShapes(2, section.message);
  shapes.push(textBoxXml(nextId, 'Bullets', MARGIN_X, BODY_Y, CONTENT_W, 3900000,
    bulletParas(section.bullets, BODY_SZ, 600)));
  return slideXml(shapes);
}

/* -- 図表テンプレート -- */

function tableVisual(idStart: number, section: NormSection, visual: NormVisual, frameY: number): { shapes: string[]; frameH: number } {
  const shapes: string[] = [];
  let id = idStart;
  const rows = Math.max(1, section.bullets.length);
  const rowH = 600000;
  const frameH = rows * rowH;
  const leadColW = Math.round(CONTENT_W * 0.36);
  const lineColor = visual.colorHex ?? SLATE;
  shapes.push(shapeXml(id++, 'TableFrame', MARGIN_X, frameY, CONTENT_W, frameH, { fill: PAPER, line: lineColor, lineWidth: 12700 }));
  for (let row = 1; row < rows; row++) {
    shapes.push(shapeXml(id++, `TableRowLine${row}`, MARGIN_X, frameY + row * rowH, CONTENT_W, 9525, { fill: lineColor }));
  }
  shapes.push(shapeXml(id++, 'TableColLine', MARGIN_X + leadColW, frameY, 9525, frameH, { fill: lineColor }));
  section.bullets.forEach((bullet, row) => {
    const y = frameY + row * rowH;
    shapes.push(textBoxXml(id++, `TableLead${row + 1}`, MARGIN_X + 180000, y, leadColW - 360000, rowH, [
      { runs: [{ text: bullet.lead, size: SMALL_SZ, color: INK, bold: true }] },
    ], 'ctr'));
    shapes.push(textBoxXml(id++, `TableDetail${row + 1}`, MARGIN_X + leadColW + 180000, y, CONTENT_W - leadColW - 360000, rowH, [
      { runs: [{ text: bullet.detail, size: SMALL_SZ, color: SLATE }] },
    ], 'ctr'));
  });
  return { shapes, frameH };
}

function barVisual(idStart: number, visual: NormVisual, frameY: number): { shapes: string[]; frameH: number } {
  const shapes: string[] = [];
  let id = idStart;
  const frameH = 2200000;
  const axisColor = visual.colorHex ?? ACCENT;
  const plotX = MARGIN_X + 300000;
  const plotW = CONTENT_W - 300000;
  // 縦軸とゼロ基線のみ。数値データがないためバーや目盛り数値は描かない（「0」のみ基線原点として表示）。
  shapes.push(shapeXml(id++, 'BarAxisY', plotX, frameY, 19050, frameH, { fill: SLATE }));
  shapes.push(shapeXml(id++, 'BarBaseline', plotX, frameY + frameH - 19050, plotW, 19050, { fill: axisColor }));
  shapes.push(textBoxXml(id++, 'BarOrigin', MARGIN_X, frameY + frameH - 170000, 260000, 300000, [
    { runs: [{ text: '0', size: NOTE_SZ, color: SLATE }], align: 'r' },
  ]));
  return { shapes, frameH };
}

function stepsVisual(idStart: number, section: NormSection, visual: NormVisual, frameY: number): { shapes: string[]; frameH: number } {
  const shapes: string[] = [];
  let id = idStart;
  const frameH = 1250000;
  const steps = section.bullets.length ? section.bullets : [{ lead: '', detail: '' }];
  const gap = 120000;
  const stepW = Math.floor((CONTENT_W - gap * (steps.length - 1)) / steps.length);
  steps.forEach((bullet, index) => {
    const x = MARGIN_X + index * (stepW + gap);
    const fill = visual.colorHex ?? categoryHex(index);
    const paras: ParaSpec[] = [
      { runs: [{ text: bullet.lead, size: SMALL_SZ, color: PAPER, bold: true }], align: 'ctr' },
    ];
    if (bullet.detail) {
      paras.push({ runs: [{ text: bullet.detail, size: NOTE_SZ, color: PAPER }], align: 'ctr' });
    }
    shapes.push(shapeXml(id++, `Step${index + 1}`, x, frameY, stepW, frameH, {
      fill,
      prst: index === 0 ? 'pentagon' : 'chevron',
      paras,
      anchor: 'ctr',
    }));
  });
  return { shapes, frameH };
}

function visualSlide(section: NormSection, visual: NormVisual): string {
  const { shapes, nextId } = headlineShapes(2, section.message);
  let id = nextId;
  let frameY = BODY_Y;
  if (visual.title) {
    shapes.push(textBoxXml(id++, 'VisualTitle', MARGIN_X, 2000000, CONTENT_W, 360000, [
      { runs: [{ text: visual.title, size: NOTE_SZ, color: SLATE }] },
    ]));
    frameY = 2480000;
  }
  if (visual.kind === 'table') {
    const part = tableVisual(id, section, visual, frameY);
    shapes.push(...part.shapes);
  } else if (visual.kind === 'steps') {
    const part = stepsVisual(id, section, visual, frameY);
    shapes.push(...part.shapes);
  } else {
    const part = barVisual(id, visual, frameY);
    shapes.push(...part.shapes);
    id += part.shapes.length;
    // bar はフレームに数値を持たないため、bullets をフレーム下に併記する（table/steps は bullets 自体が図になる）。
    shapes.push(textBoxXml(id++, 'Bullets', MARGIN_X, frameY + part.frameH + 228600, CONTENT_W, 1300000,
      bulletParas(section.bullets, SMALL_SZ, 400)));
  }
  return slideXml(shapes);
}

function closingSlide(deck: NormDeck): string {
  const { shapes, nextId } = headlineShapes(2, deck.ask);
  let id = nextId;
  shapes.push(textBoxXml(id++, 'NextSteps', MARGIN_X, BODY_Y, CONTENT_W, 2600000,
    deck.nextSteps.map((step, index) => ({
      runs: [
        { text: `${index + 1}. `, size: BODY_SZ, color: ACCENT, bold: true },
        { text: step, size: BODY_SZ, color: INK },
      ],
      spcAft: 500,
    }))));
  if (deck.assumptions.length) {
    const paras: ParaSpec[] = [
      { runs: [{ text: '前提条件', size: NOTE_SZ, color: SLATE, bold: true }], spcAft: 200 },
      ...deck.assumptions.map((item) => ({
        runs: [{ text: `・${item}`, size: NOTE_SZ, color: SLATE }],
      })),
    ];
    shapes.push(textBoxXml(id++, 'Assumptions', MARGIN_X, 5200000, CONTENT_W, 1000000, paras));
  }
  return slideXml(shapes);
}

/* ---- パッケージ組み立て（artifactGeneratorV12 の makePptx と同構造） ---- */

const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;

function buildPackage(title: string, slides: string[]): Buffer {
  const slideOverrides = slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const slideIds = slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('');
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}</Relationships>`;
  const slideMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="${HEADLINE_SZ}" b="1"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="${BODY_SZ}"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr sz="${BODY_SZ}"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;
  const slideLayout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="${DRAW_NS}" xmlns:r="${REL_NS}" xmlns:p="${PPT_NS}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
  const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${DRAW_NS}" name="ORIGIN Proposal"><a:themeElements><a:clrScheme name="ORIGIN Proposal"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${INK}"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="${ACCENT}"/></a:accent1><a:accent2><a:srgbClr val="${SLATE}"/></a:accent2><a:accent3><a:srgbClr val="${categoryHex(0)}"/></a:accent3><a:accent4><a:srgbClr val="${categoryHex(1)}"/></a:accent4><a:accent5><a:srgbClr val="${categoryHex(2)}"/></a:accent5><a:accent6><a:srgbClr val="${categoryHex(3)}"/></a:accent6><a:hlink><a:srgbClr val="${ACCENT}"/></a:hlink><a:folHlink><a:srgbClr val="${SLATE}"/></a:folHlink></a:clrScheme><a:fontScheme name="ORIGIN Proposal"><a:majorFont><a:latin typeface="${FONT_FACE}"/><a:ea typeface="${FONT_FACE}"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${FONT_FACE}"/><a:ea typeface="${FONT_FACE}"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="ORIGIN Proposal"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
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
    { name: 'docProps/core.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(title)}</dc:title><dc:creator>ORIGIN</dc:creator></cp:coreProperties>`) },
    { name: 'docProps/app.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ORIGIN</Application><Slides>${slides.length}</Slides></Properties>`) },
  ];
  slides.forEach((slide, index) => {
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: Buffer.from(slide) });
    entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: Buffer.from(SLIDE_RELS) });
  });
  return zipStore(entries);
}

/**
 * ProposalDeck を PPTX バイト列に変換する。
 * スライド順: 表紙 → 要約 → 各セクション（visual なし=本文 / あり=図表）→ 締め。
 */
export function renderProposalDeckPptx(deck: ProposalDeck): Buffer {
  const normalized = normalizeDeck(deck);
  const slides: string[] = [
    coverSlide(normalized),
    summarySlide(normalized),
    ...normalized.sections.map((section) => (section.visual ? visualSlide(section, section.visual) : bodySlide(section))),
    closingSlide(normalized),
  ];
  return buildPackage(normalized.title, slides);
}
