/**
 * 提案資料「資料レコード再設計」の材料レコード基盤（D-PR-1）。
 *
 * 設計正本: ~/workspace/origin-fix/DECK_RECORDS_REDESIGN_2026-11-15.md
 *
 * 本モジュールは新経路の土台だけを提供する（型、素材の単位分割、
 * 逐語照合・数値照合の部品）。既存経路（チャットルーター、現行
 * パーサー、自己チェック、レンダラー）には接続しない未配線の部品
 * であり、配置計画・起草・組立は後続 PR（D-PR-2 以降）の担当。
 *
 * 中心の考え方（設計 §2.2）: 資料の材料は「共通材料レコード」
 * （DeckMaterialUnit）で表し、モデルが返すのは配置（ID の選択）
 * だけに限定する。掲載文字列は常にアプリが材料レコードから取得
 * するため、変換時の追加創作ゼロ（保証 G1）が構造的に成立する。
 * 本モジュールの照合部品は、その性質を組立後に決定的に再確認する
 * 二重の防壁である（設計 §7.2）。
 *
 * 共通部品の扱い（設計 §14）: 文単位分割の境界規則・正規化・逐語
 * 検証の規則は、統合レコード方式（groundedResearchRecordsV13）の
 * 実装を正として import し、複製しない。出典の意味（検索の
 * S-ID／E-ID、カバレッジの概念）は資料側に持ち込まない。資料側の
 * ID 空間は M-ID（ユーザー素材）と D-ID（モデル起草）である。
 *
 * DG-1 修正（2026-11-22）: 散文の文については、V13 の文分割の上に
 * 資料側だけの追加分割（ラベル分割・節分割、splitDeckProseSentenceUnits）
 * を重ねる。追加分割は原文の部分文字列しか生まないため逐語性は
 * 保たれ、統合レコード方式側の分割には影響しない。
 */

import {
  RECORDS_MIN_UNIT_CHARS,
  normalizedRecordsText,
  spanText,
  splitEvidenceSpans,
} from '../research/groundedResearchRecordsV13.js';
import { extractNumericTokens } from './proposalDeckSelfCheckV1.js';

// ---------------------------------------------------------------------------
// 材料レコードの型（設計 §2.2）
// ---------------------------------------------------------------------------

/** 材料の種別（保証の切り分け、設計 §2.4）。 */
export type DeckMaterialSourceKind = 'user-material' | 'model-draft';

/**
 * 単位の形。表は分割せず1単位として保持する（設計 §3.1）。
 * 'label' は DG-1 修正（2026-11-22）で追加した形: 散文の文頭に
 * ある「項目名：」の項目名だけを切り出した単位。項目名は節の
 * 題目として使える構造情報であり、本文ではない（配置規則は
 * D-PR-3 側の決定的配置が担当する）。
 * 'theme' も DG-1 修正で追加した形: 依頼文の主題（例「値引き
 * キャンペーン」）を切り出した単位で、タイトル候補としてだけ
 * 使う。本モジュールの分割は生成せず、レコード経路の配線側
 * （originProposalDeckRecordsChat）が明示的に追加する。
 */
export type DeckMaterialUnitKind = 'sentence' | 'bullet' | 'table' | 'label' | 'theme';

export interface DeckMaterialUnit {
  /** 材料内の連番ID。素材由来は M1, M2, …、起草由来は D1, D2, …（接頭辞で由来を区別する）。 */
  id: string;
  /**
   * 逐語のテキスト。モードA（素材由来）ではアプリ側が原文から取得した
   * 文字列であり、モデル出力の写しではない。モードB（起草由来）では
   * タグブロックの逐語（変換は D-PR-2）。
   */
  text: string;
  /** 材料の種別（保証の切り分け、設計 §2.4）。 */
  sourceKind: DeckMaterialSourceKind;
  /** 単位の形。 */
  kind: DeckMaterialUnitKind;
}

/** ユーザー素材由来の単位IDの接頭辞。 */
export const DECK_MATERIAL_ID_PREFIX = 'M';
/** モデル起草由来の単位IDの接頭辞。 */
export const DECK_DRAFT_ID_PREFIX = 'D';

/**
 * 素材あたりの単位数の上限（設計 §3.1「上限は素材あたり別途定数」）。
 * 統合側の出典あたり上限（RECORDS_MAX_UNITS_PER_SOURCE）とは別の、
 * 資料側の定数である。超過分は V13 と同じ規則で最後の単位へ結合し、
 * テキスト自体は捨てない（アドレス可能な単位数を bound するだけ）。
 * 値は D-PR-1 の初期値であり、評価集合での較正対象。
 */
export const DECK_RECORDS_MAX_UNITS_PER_MATERIAL = 100;

/** ラベル（「項目名：」の項目名）の最大長。文の冒頭節と区別するための上限。 */
const DECK_LABEL_MAX_CHARS = 16;
/** 節分割（読点区切りの独立した事実列挙）で、各節に要求する最小長。 */
const DECK_CLAUSE_MIN_SEGMENT_CHARS = 4;

/**
 * 散文の1文を追加で割る（DG-1 修正, 2026-11-22）。
 *
 * DG-1 の十分群フィクスチャは「項目名: 内容。」形式の密な散文で、
 * 文単位のままでは作成に必要な最小単位（タイトル1＋要約3＋節3×2
 * ＋次の一手1＝11）に届かず、モデル配置でも決定的配置でも作成
 * 不能だった。ここでは原文の部分文字列だけを単位化する2つの
 * 保守的な分割を足す（新しいテキストは作らない）。
 *
 * 1. ラベル分割: 文頭の短い「項目名：／:」を 'label' 単位として
 *    切り出し、残りを本文単位とする。助詞・断定で終わる冒頭や
 *    数字だけの冒頭（時刻など）はラベルとみなさない。
 * 2. 括弧の切り出し: 内容が十分に長い括弧書きは独立した単位
 *    とする（splitDeckParentheticalPieces）。
 * 3. 節分割: 括弧外の読点が2つ以上あり、各節が独立した事実
 *    （主題「は／が」を早い位置に含み、十分な長さがある）として
 *    読める場合だけ読点で割る。読点が1つだけの場合はさらに
 *    厳しく、直前の節が数値・単位などで閉じた完結した事実で
 *    ある場合だけ割る（複合文の接続節は割らない）。条件を
 *    満たさない読点は残す（連結すると原文に戻る）。
 *
 * 箇条書き・表には適用しない（箇条書きは行単位が正本のまま）。
 */
export function splitDeckProseSentenceUnits(
  sentenceText: string,
): Array<{ text: string; kind: DeckMaterialUnitKind }> {
  const labelMatch = /^([^:：]{1,16})[:：]\s*(.+)$/s.exec(sentenceText);
  if (labelMatch) {
    const label = labelMatch[1].trim();
    const rest = labelMatch[2];
    if (isDeckLabelText(label) && isDeckLabelRestText(rest)) {
      return [
        { text: label, kind: 'label' },
        ...splitDeckSentenceBody(rest),
      ];
    }
  }
  return splitDeckSentenceBody(sentenceText);
}

/**
 * 文の本文部分の分割: 括弧書きの切り出し→節分割の順に適用する。
 * 括弧書きは、内容が十分に長く（8字以上）文を含まない場合だけ
 * 独立した単位として切り出す（「（60%の削減）」のような短い
 * 補足は文の中に残す）。切り出した場合は括弧自体を区切りとして
 * 落とし、各断片末尾の文末記号も落とす（節分割の読点と同じ扱い。
 * すべての断片は原文の部分文字列のままである）。
 */
function splitDeckSentenceBody(
  text: string,
): Array<{ text: string; kind: DeckMaterialUnitKind }> {
  return splitDeckParentheticalPieces(text).flatMap((piece) =>
    splitDeckClauseText(piece).map((clause) => ({
      text: clause,
      kind: 'sentence' as const,
    })),
  );
}

/** 括弧書き（全角括弧、入れ子なし）を独立単位として切り出す。 */
export function splitDeckParentheticalPieces(text: string): string[] {
  const pieces: string[] = [];
  let rest = '';
  let changed = false;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '（') {
      const close = text.indexOf('）', i);
      if (close > i) {
        const content = text.slice(i + 1, close);
        if (
          content.length >= 8 &&
          !content.includes('（') &&
          !/[。．]/.test(content)
        ) {
          pieces.push(rest);
          pieces.push(content);
          rest = '';
          changed = true;
          i = close + 1;
          continue;
        }
      }
    }
    rest += text[i];
    i += 1;
  }
  if (!changed) return [text];
  pieces.push(rest);
  return pieces
    .map((piece) => piece.replace(/^[、，]/, '').replace(/[。．]$/, ''))
    .filter((piece) => piece.trim() !== '');
}

/** 文頭の「項目名」として認める形か。文の冒頭節（散文）と区別する。 */
function isDeckLabelText(label: string): boolean {
  if (label.length === 0 || label.length > DECK_LABEL_MAX_CHARS) return false;
  if (/[。．！？!?、，\s]/.test(label)) return false;
  if (!/[^\d０-９]/.test(label)) return false; // 数字だけ（時刻・番号）はラベルにしない
  if (/(?:は|が|を|に|へ|と|も)$/.test(label)) return false; // 助詞で終わる冒頭は散文
  if (/(?:です|ます|でした|である|だ)$/.test(label)) return false; // 断定で終わる冒頭は散文
  return true;
}

/** ラベルの後に続く本文として認める形か。 */
function isDeckLabelRestText(rest: string): boolean {
  if (rest.length < DECK_CLAUSE_MIN_SEGMENT_CHARS) return false;
  if (/^[、。，．/／]/.test(rest)) return false; // URL（https://…）や区切りの続きは割らない
  return true;
}

/**
 * 読点区切りの独立した事実列挙だけを割る。括弧内の読点は数えない。
 * 割らなかった読点は '、' で連結し直すため、結果を連結すると
 * 必ず原文に戻る（逐語性の保存）。
 */
export function splitDeckClauseText(text: string): string[] {
  const cuts: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '（' || ch === '(' || ch === '「' || ch === '『' || ch === '【') {
      depth += 1;
    } else if (ch === '）' || ch === ')' || ch === '」' || ch === '』' || ch === '】') {
      depth = Math.max(0, depth - 1);
    } else if (ch === '、' && depth === 0) {
      cuts.push(i);
    }
  }
  if (cuts.length === 0) return [text];
  const rawSegments: string[] = [];
  let start = 0;
  for (const cut of cuts) {
    rawSegments.push(text.slice(start, cut));
    start = cut + 1;
  }
  rawSegments.push(text.slice(start));
  // 読点が1つだけの文は複合文であることが多いため、境界の条件を
  // 厳しくする（完結した事実の列挙だけを割る）。
  const isBoundary =
    cuts.length === 1 ? isDeckFactBoundary : isDeckClauseBoundary;
  const merged: string[] = [];
  for (const segment of rawSegments) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && isBoundary(previous, segment)) {
      merged.push(segment);
    } else if (previous !== undefined) {
      merged[merged.length - 1] = `${previous}、${segment}`;
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

/** 直前の蓄積節と次の節の間が、独立した事実の境界として割れるか。 */
function isDeckClauseBoundary(previous: string, segment: string): boolean {
  const core = segment.replace(/[。．]$/, '');
  if (previous.length < DECK_CLAUSE_MIN_SEGMENT_CHARS) return false;
  if (core.length < DECK_CLAUSE_MIN_SEGMENT_CHARS) return false;
  // 次の節が早い位置に主題（は／が）を持たない列挙（名詞の並び等）は割らない。
  return /[はが]/.test(core.slice(0, 12));
}

/**
 * 読点が1つだけの場合の、より厳しい境界判定。直前の節が数値・
 * 単位・完結した名詞句で閉じている（＝独立した事実として完結
 * している）場合だけ、次の節との間を事実の境界とみなす。動詞・
 * 形容詞の連用形で続く複合文（「…が少なく、…」等）は、直前の
 * 節がその形で終わらないため割れない。
 */
function isDeckFactBoundary(previous: string, segment: string): boolean {
  if (!isDeckClauseBoundary(previous, segment)) return false;
  return /(?:[\d０-９%％]|円|件|人|社|店|か所|回|週間|か月|ヶ月|点|倍|割|増|減|こと|ため)$/.test(
    previous,
  );
}

const DECK_MATERIAL_ID_PATTERN = /^M\d+$/;
const DECK_DRAFT_ID_PATTERN = /^D\d+$/;

/**
 * 単位IDの接頭辞から材料の種別を判定する。M-ID はユーザー素材、
 * D-ID はモデル起草。それ以外の形は null（資料側の ID 空間に属さない。
 * 統合側の E-ID／S-ID を資料側の種別に読み替えることはしない）。
 */
export function deckMaterialSourceKindFromId(id: string): DeckMaterialSourceKind | null {
  if (DECK_MATERIAL_ID_PATTERN.test(id)) return 'user-material';
  if (DECK_DRAFT_ID_PATTERN.test(id)) return 'model-draft';
  return null;
}

// ---------------------------------------------------------------------------
// 素材の単位分割（設計 §3.1）
// ---------------------------------------------------------------------------

/** Markdown 表の行（行頭が `|`）。連続する表行は表全体で1単位になる。 */
function isDeckTableLine(trimmedLine: string): boolean {
  return trimmedLine.startsWith('|');
}

const DECK_BULLET_MARKER_PATTERN = /^[-*+•・●○◎▪▸]\s*/;
const DECK_NUMBERED_MARKER_PATTERN = /^\d{1,3}[.、．)]\s+/;

/**
 * 箇条書き行のテキスト（行頭マーカーを除いた逐語）。箇条書き行で
 * なければ null。番号付き行（`1. ` 等）も箇条書きとして扱う。
 * 年号や小数で始まる散文行は、数字の直後がマーカー＋空白の形に
 * 一致しないため箇条書きとは判定しない。
 */
function deckBulletLineText(trimmedLine: string): string | null {
  if (DECK_BULLET_MARKER_PATTERN.test(trimmedLine)) {
    return trimmedLine.replace(DECK_BULLET_MARKER_PATTERN, '').trim();
  }
  if (DECK_NUMBERED_MARKER_PATTERN.test(trimmedLine)) {
    return trimmedLine.replace(DECK_NUMBERED_MARKER_PATTERN, '').trim();
  }
  return null;
}

/**
 * 散文ブロックを文単位に分割する。境界規則は統合レコード方式
 * §3.2 と同一（splitEvidenceSpans を共有）: 終端符で切り、括弧内・
 * 小数点・URL 内では分割せず、閉じ括弧・引用符は前の文へ吸収し、
 * 8字未満の単位は直前へ結合する（RECORDS_MIN_UNIT_CHARS を共有）。
 * ブロック内の空白（改行含む）は V13 の抜粋圧縮と同じく単一空白へ
 * 圧縮してから分割する。
 */
function segmentDeckProseBlock(block: string): string[] {
  const compacted = block.replace(/\s+/g, ' ').trim();
  if (compacted === '') return [];
  const rawTexts = splitEvidenceSpans(compacted)
    .map((span) => spanText(compacted, span))
    .filter((text) => text.length > 0);
  const merged: string[] = [];
  for (const text of rawTexts) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && text.length < RECORDS_MIN_UNIT_CHARS) {
      merged[merged.length - 1] = previous + text;
    } else {
      merged.push(text);
    }
  }
  return merged;
}

/**
 * ユーザー素材を材料レコードへ分割し、M-ID（M1, M2, …）を付与する。
 * 決定的処理であり、同じ入力には常に同じ単位列を返す。
 *
 * 分割の形（設計 §3.1）:
 * - 散文は文単位に分割する（規則は segmentDeckProseBlock のとおり）。
 * - 箇条書きの各行（番号付き行を含む）は、そのまま1単位とする。
 * - 表は分割せず、連続する表行全体を1単位とする（テキストは行を
 *   改行で結んだ逐語。セル単位の書き換えはしない、設計 §7.2）。
 * - 空行はブロックの区切りになる。単位の順序は原文の出現順。
 * - 単位数が DECK_RECORDS_MAX_UNITS_PER_MATERIAL を超える場合は、
 *   超過分を最後の単位へ結合する（テキストは捨てない）。
 *
 * 見出し行（`## ` 等）の扱いはここでは特別扱いしない（散文として
 * 分割する）。見出しを題目候補として拾う決定的配置は D-PR-3 の担当。
 */
export function buildDeckMaterialUnits(materialText: string): DeckMaterialUnit[] {
  const units: Omit<DeckMaterialUnit, 'id' | 'sourceKind'>[] = [];
  let proseLines: string[] = [];
  let tableLines: string[] = [];

  const flushProse = () => {
    if (proseLines.length === 0) return;
    for (const text of segmentDeckProseBlock(proseLines.join('\n'))) {
      // DG-1 修正: 散文の文はラベル分割・節分割で追加分割する
      // （splitDeckProseSentenceUnits。箇条書き・表には適用しない）。
      for (const part of splitDeckProseSentenceUnits(text)) {
        units.push(part);
      }
    }
    proseLines = [];
  };
  const flushTable = () => {
    if (tableLines.length === 0) return;
    units.push({ text: tableLines.join('\n'), kind: 'table' });
    tableLines = [];
  };

  for (const rawLine of materialText.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '') {
      flushProse();
      flushTable();
      continue;
    }
    if (isDeckTableLine(line)) {
      flushProse();
      tableLines.push(line);
      continue;
    }
    flushTable();
    const bulletText = deckBulletLineText(line);
    if (bulletText !== null) {
      flushProse();
      if (bulletText !== '') units.push({ text: bulletText, kind: 'bullet' });
      continue;
    }
    proseLines.push(line);
  }
  flushProse();
  flushTable();

  // 素材あたり上限: 超過分は最後の単位へ結合する（V13 の上限規則と同型）。
  if (units.length > DECK_RECORDS_MAX_UNITS_PER_MATERIAL) {
    const kept = units.slice(0, DECK_RECORDS_MAX_UNITS_PER_MATERIAL - 1);
    const tail = units.slice(DECK_RECORDS_MAX_UNITS_PER_MATERIAL - 1);
    const involvesTable = tail.some((unit) => unit.kind === 'table');
    kept.push({
      text: tail.map((unit) => unit.text).join(involvesTable ? '\n' : ' '),
      kind: involvesTable ? 'table' : tail[0].kind,
    });
    units.length = 0;
    units.push(...kept);
  }

  return units.map((unit, index) => ({
    id: `${DECK_MATERIAL_ID_PREFIX}${index + 1}`,
    text: unit.text,
    sourceKind: 'user-material' as const,
    kind: unit.kind,
  }));
}

// ---------------------------------------------------------------------------
// 起草由来の単位への D-ID 付与の基盤（設計 §4.2 の土台）
// ---------------------------------------------------------------------------

export interface DeckDraftUnitEntry {
  /** 単位の逐語テキスト（タグブロックから切り出した1単位分）。 */
  text: string;
  /** 単位の形。省略時は 'sentence'。 */
  kind?: DeckMaterialUnitKind;
}

/**
 * 起草由来の単位列に D-ID（D1, D2, …）を付与し、材料レコードにする。
 * モードBではタグブロックの各行・各文がそのまま1単位になる
 * （設計 §4.2）ため、ここでは「既に1単位に切り出されたテキスト列」
 * を受けて ID と種別を与えるだけに留める。タグのパースと切り出し
 * 自体は D-PR-2 の担当。空テキストの項目は単位にしない。
 */
export function buildDeckDraftUnits(entries: readonly DeckDraftUnitEntry[]): DeckMaterialUnit[] {
  const units: DeckMaterialUnit[] = [];
  for (const entry of entries) {
    const text = entry.text.trim();
    if (text === '') continue;
    units.push({
      id: `${DECK_DRAFT_ID_PREFIX}${units.length + 1}`,
      text,
      sourceKind: 'model-draft',
      kind: entry.kind ?? 'sentence',
    });
  }
  return units;
}

// ---------------------------------------------------------------------------
// 逐語照合の部品（設計 §7.2 ゲート2：原文忠実性）
// ---------------------------------------------------------------------------

export interface DeckVerbatimCheckResult {
  /** 掲載テキストがすべて材料単位の逐語であれば true。 */
  ok: boolean;
  /** 照合した掲載テキストの件数（空文字列は数えない）。 */
  checkedCount: number;
  /** 材料単位の逐語ではなかった掲載テキスト（出現順、重複はそのまま）。 */
  unmatchedTexts: readonly string[];
}

/**
 * 組立後の掲載テキストが、すべて材料単位の逐語であることを決定的に
 * 照合する（設計 §7.2）。配置は ID 参照で組み立て、文字列はアプリが
 * 材料から取得するため、この性質は構造的に成立する。本関数は将来の
 * 変更への二重の防壁として、組立後のテキスト集合を材料単位の集合と
 * 突き合わせる（統合レコード方式の描画後検査と同型）。
 *
 * 照合の意味論:
 * - 「逐語」は単位全体との一致（メンバーシップ）で判定する。単位の
 *   一部分だけを切り出した文字列は逐語とはみなさない（掲載は単位
 *   単位で行う前提、設計 §2.2）。
 * - 比較は統合側と共有の形式のみの正規化（normalizedRecordsText:
 *   NFKC・小文字化・空白とカンマ類の除去）を通して行う。値の換算・
 *   丸めを等価扱いすることはしない。
 * - 本照合が保証するのは「変換側が材料にない文字列を足していない」
 *   こと（G1）だけであり、材料自体の真実性は保証しない（設計 §7.6）。
 */
export function checkDeckVerbatim(
  placedTexts: readonly string[],
  units: readonly DeckMaterialUnit[],
): DeckVerbatimCheckResult {
  const unitTextSet = new Set(units.map((unit) => normalizedRecordsText(unit.text)));
  const unmatchedTexts: string[] = [];
  let checkedCount = 0;
  for (const placed of placedTexts) {
    if (placed.trim() === '') continue;
    checkedCount += 1;
    if (!unitTextSet.has(normalizedRecordsText(placed))) {
      unmatchedTexts.push(placed);
    }
  }
  return { ok: unmatchedTexts.length === 0, checkedCount, unmatchedTexts };
}

// ---------------------------------------------------------------------------
// 数値照合の部品（設計 §7.2 ゲート2：数値の保全）
// ---------------------------------------------------------------------------

export interface DeckNumericDiscrepancy {
  /** 正規化済みの数値トークン（extractNumericTokens の正規形）。 */
  token: string;
  /** 材料側の出現回数。 */
  materialCount: number;
  /** 掲載側の出現回数。 */
  placedCount: number;
}

export interface DeckNumericCheckResult {
  /** 両側の多重集合が一致すれば true。 */
  ok: boolean;
  /** 材料にあるのに掲載で不足しているトークン（欠落・改変の材料側）。 */
  missing: readonly DeckNumericDiscrepancy[];
  /** 材料にないのに掲載へ混入しているトークン（改変の掲載側・混入）。 */
  unexpected: readonly DeckNumericDiscrepancy[];
}

function compareDeckNumericTokens(a: string, b: string): number {
  const diff = Number(a) - Number(b);
  return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0;
}

function countDeckNumericTokens(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of extractNumericTokens(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * 採用した材料の数値が、改変・換算・丸めなく掲載されていることを、
 * 数値トークンの多重集合一致で照合する。現行の自己チェックの
 * NUMERIC_TOKEN_NOT_PRESERVED と同型の検査であり、トークン抽出・
 * 正規化は現行実装（extractNumericTokens: NFKC・桁区切り除去・
 * 値の正規化）をそのまま使う。統括裁定により、対象範囲は現行同型
 * （方式 (a)：採用した材料の全数値について多重集合一致を要求する）
 * とする。
 *
 * 対象範囲の意味論（設計 §1.4／§7.2 の記述どおり）:
 * - 「材料側」は呼び出し側が渡したテキスト集合であり、新経路では
 *   「配置に採用した材料単位」の集合を渡す想定である。生の依頼文・
 *   回答文全体ではない。採用されなかった単位の数値は対象範囲の外
 *   にあり、掲載されなくても違反にならない（網羅性の保証ではない）。
 * - トークンは数字部分のみ（`\d+(?:\.\d+)?`）であり、単位・対象・
 *   期間（月額／年額、1名ごと、10GBごと等）の対応は検査しない。
 *   数字が逐語でも、単位の取り違えは本照合では検出できない。
 * - 多重集合で比べるため、欠落・混入のどちらも検出する。値の改変は
 *   「元の値の欠落＋別の値の混入」として現れる。
 * - 現行フォールバック経由の注意（設計 §1.4 (b)）: 骨格入力に
 *   入らなかった数値（箇条書きの切り詰め等）は現行検査でも範囲外
 *   である。新経路では材料単位がそのまま対象になるため、範囲は
 *   「採用した単位」の定義に帰着する。
 */
export function checkDeckNumericPreservation(
  materialTexts: readonly string[],
  placedTexts: readonly string[],
): DeckNumericCheckResult {
  const materialCounts = countDeckNumericTokens(materialTexts);
  const placedCounts = countDeckNumericTokens(placedTexts);
  const missing: DeckNumericDiscrepancy[] = [];
  const unexpected: DeckNumericDiscrepancy[] = [];
  for (const [token, materialCount] of materialCounts) {
    const placedCount = placedCounts.get(token) ?? 0;
    if (placedCount < materialCount) {
      missing.push({ token, materialCount, placedCount });
    }
  }
  for (const [token, placedCount] of placedCounts) {
    const materialCount = materialCounts.get(token) ?? 0;
    if (placedCount > materialCount) {
      unexpected.push({ token, materialCount, placedCount });
    }
  }
  missing.sort((a, b) => compareDeckNumericTokens(a.token, b.token));
  unexpected.sort((a, b) => compareDeckNumericTokens(a.token, b.token));
  return { ok: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}
