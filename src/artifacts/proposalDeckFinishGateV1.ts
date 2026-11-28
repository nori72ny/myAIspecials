/**
 * ProposalDeck Finish Gate V1 — 資料の仕上がりの決定的検証（shadow）。
 *
 * 設計の正本:
 * ~/workspace/origin-fix/CHATGPT_ADVICE_SCORES_2026-11-28.md（統括裁定:
 * プレースホルダ／文法パターンの決定的ゲート＋数値の依存関係の機械検査を
 * 資料・企画の是正バッチの正本とし、既存のデッキ数値ゲート shadow と接続）。
 *
 * 背景: 独立採点（2026-11-28、資料 5.0 / 企画 4.0）で、生成された資料に
 * 次の仕上がり欠陥が残った。既存の自己チェック（proposalDeckSelfCheckV1）は
 * [ ]・〇・TBD 形のプレースホルダと構造しか見ず、数値の素材照合
 * （proposalDeckNumericGroundingV1）は素材との照合であって生成物内部の
 * 整合は見ないため、いずれも素通りしていた:
 *  1. タイトルが骨格指示の例文「提案のタイトル」のまま残った。
 *  2. 複数の節の書き出しに「〜しますです」の二重丁寧が残った。
 *  3. 価格（初期費用・月額）が仮定と明示されず断定された。
 *  4. 企画数値の自己矛盾: 参加者810人×転換率5%（受注見込み約40件）と
 *     KPI 10件の併記、「月3回・全9回」と言いながら予定表は6回分。
 *
 * 本モジュールは生成物（デッキ）のテキストだけから決定的に判定できる
 * 仕上がり欠陥を検出する:
 *  - TEMPLATE_TEXT_REMAINING: 骨格指示の例文・定型プレースホルダの残存。
 *  - GRAMMAR_POLITENESS_DUPLICATION: 「しますです」等の二重丁寧の
 *    決定的パターン（標準的な日本語では決して正しくならない並びだけ）。
 *  - SCHEDULE_COUNT_MISMATCH: 頻度×期間と総回数の不一致、総回数と
 *    列挙された回次・日付件数の不一致。
 *  - PRODUCT_RESULT_MISMATCH: 元数・割合・結果がすべて明記された主張の
 *    積の再計算（810人×5%≠10件 型）。割合主張の判定帯は数値照合と
 *    同じ |diff| <= max(0.5, scale × 2%) を使う。
 *  - ASSUMPTION_NOT_LABELED: 価格ラベルを伴う金額が、仮定マーカーの
 *    ある文にも前提セグメントにも現れず、無印で断定されている。
 *    効果額（削減額等）も対象に含める: 根拠表示のない見積り主張の
 *    規模を shadow で測ることが目的であり、素材由来の正当な転記も
 *    混ざりうるため、注記・enforce の判断は後段の単位に委ねる。
 *
 * - 純関数・決定的。モデル呼び出しなし、追加コストなし。例外を投げない。
 * - 既定ではどこからも呼ばれない。自己チェックの options 経由でのみ
 *   有効になり、結果は shadow として分離して返る（成立可否は変えない）。
 *   注記・enforce は数値照合と同じく後段の単位（オーナー承認待ち）。
 * - 誤検出を出さないことが合格条件: 仮定明示のある金額、正しい積、
 *   整合する回数、「ますます」等の正当な語は違反にしない。
 * - 違反の message は数値と固定語彙とマッチした定型断片だけを持ち、
 *   利用者の本文を長く引用しない（監査ログに個人情報を残さない）。
 */

import {
  extractGroundedNumericTokens,
  type GroundedNumericToken,
  type ProposalDeckTextSegment,
} from "./proposalDeckNumericGroundingV1.js";

export type ProposalDeckFinishGateViolationCode =
  | "TEMPLATE_TEXT_REMAINING"
  | "GRAMMAR_POLITENESS_DUPLICATION"
  | "SCHEDULE_COUNT_MISMATCH"
  | "PRODUCT_RESULT_MISMATCH"
  | "ASSUMPTION_NOT_LABELED";

export interface ProposalDeckFinishGateViolation {
  code: ProposalDeckFinishGateViolationCode;
  path: string;
  message: string;
}

export interface ProposalDeckFinishGateInput {
  /** 組み立て済みデッキのテキスト（path 付き）。数値照合と同じ形。 */
  deckSegments: readonly ProposalDeckTextSegment[];
}

// ---------------------------------------------------------------------------
// 前処理（数値照合の normalizeText と同一規則: トークンの index を
// この正規化テキスト上の位置として使うため、ずらさないこと）
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  let normalized = text.normalize("NFKC");
  normalized = normalized.replace(/[\u2010-\u2015\u2212]/g, "-");
  for (let i = 0; i < 4; i += 1) {
    normalized = normalized.replace(/(\d),(\d)/g, "$1$2");
  }
  return normalized;
}

/** 丸め一致: |diff| <= max(0.5, scale × 2%)。数値照合・監査ゲートと同じ帯。 */
function numbersAgree(computed: number, stated: number): boolean {
  if (!Number.isFinite(computed) || !Number.isFinite(stated)) return false;
  const diff = Math.abs(computed - stated);
  const scale = Math.max(Math.abs(computed), Math.abs(stated));
  return diff <= Math.max(0.5, scale * 0.02);
}

function roundForMessage(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

interface Segment {
  path: string;
  text: string;
  normalized: string;
  tokens: GroundedNumericToken[];
}

// ---------------------------------------------------------------------------
// 1) テンプレート・プレースホルダ残存
// ---------------------------------------------------------------------------

/** 骨格指示の例文タイトルそのもの（モデルが例文を反復した形）。 */
const TEMPLATE_TITLES: ReadonlySet<string> = new Set([
  "提案のタイトル",
  "ご提案のタイトル",
  "提案タイトル",
  "仮タイトル",
  "タイトル未定",
  "サンプルタイトル",
  "テストタイトル",
]);

/** セグメント全体が指示文の例文行と一致する形（箇条書きの例文の反復）。 */
const TEMPLATE_EXACT_SEGMENTS: ReadonlySet<string> = new Set([
  "要点の1つ目",
  "要点の2つ目",
  "要点の3つ目",
  "次に取るステップ",
  "依頼事項：相手に決めてほしいこと、頼みたいこと",
]);

/** 文中に残っていたら定型文・プレースホルダと断定できる断片。 */
const TEMPLATE_FRAGMENTS: readonly string[] = [
  "あれば1行だけ",
  "（課題と同じ形式で書きます）",
  "ここにタイトル",
  "ここに本文",
  "タイトルを入力",
  "テキストを入力",
  "サンプルテキスト",
  "ダミーテキスト",
  "Lorem ipsum",
  "lorem ipsum",
];

function checkTemplateText(
  segment: Segment,
  add: (code: ProposalDeckFinishGateViolationCode, path: string, message: string) => void,
): void {
  const trimmed = segment.normalized.trim();
  if (segment.path === "title" && TEMPLATE_TITLES.has(trimmed)) {
    add(
      "TEMPLATE_TEXT_REMAINING",
      segment.path,
      `タイトルが定型文のまま残っています: ${trimmed}: ${segment.path}`,
    );
    return;
  }
  if (TEMPLATE_EXACT_SEGMENTS.has(trimmed)) {
    add(
      "TEMPLATE_TEXT_REMAINING",
      segment.path,
      `骨格指示の例文がそのまま残っています: ${trimmed}: ${segment.path}`,
    );
    return;
  }
  for (const fragment of TEMPLATE_FRAGMENTS) {
    if (segment.normalized.includes(fragment)) {
      add(
        "TEMPLATE_TEXT_REMAINING",
        segment.path,
        `定型文・プレースホルダが残っています: ${fragment}: ${segment.path}`,
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 2) 文法: 二重丁寧の決定的パターン
// ---------------------------------------------------------------------------

/**
 * 「〜しますです」型: 丁寧語尾に「です」が重なった形と、「ですます」型。
 * 文末（句読点・引用符・行末）の位置に限るため、「ますます重要」の
 * ような副詞の用法には一致しない。
 */
const GRAMMAR_PATTERNS: readonly RegExp[] = [
  /(?:します|しました|でした|ます|です|でしょう|ください|ございます|なります|できます|あります|います)です(?=[。、！？\s」』）)]|$)/,
  /(?:です|ます)ます(?=[。、！？\s」』）)]|$)/,
];

function checkGrammar(
  segment: Segment,
  add: (code: ProposalDeckFinishGateViolationCode, path: string, message: string) => void,
): void {
  for (const pattern of GRAMMAR_PATTERNS) {
    const match = pattern.exec(segment.normalized);
    if (match) {
      add(
        "GRAMMAR_POLITENESS_DUPLICATION",
        segment.path,
        `文法の疑わしいパターン（二重丁寧）があります: ${match[0]}: ${segment.path}`,
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 3) 回数の整合: 頻度×期間 vs 総回数 / 総回数 vs 列挙件数
// ---------------------------------------------------------------------------

interface StatedCount {
  value: number;
  path: string;
}

function collectMatches(
  segments: readonly Segment[],
  pattern: RegExp,
): { value: number; path: string }[] {
  const found: { value: number; path: string }[] = [];
  for (const segment of segments) {
    for (const match of segment.normalized.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) found.push({ value, path: segment.path });
    }
  }
  return found;
}

function uniqueValue(entries: readonly StatedCount[]): number | null {
  const values = new Set(entries.map((entry) => entry.value));
  return values.size === 1 ? [...values][0] : null;
}

function checkScheduleCounts(
  segments: readonly Segment[],
  add: (code: ProposalDeckFinishGateViolationCode, path: string, message: string) => void,
): void {
  const totals = [
    ...collectMatches(segments, /全(\d+(?:\.\d+)?)回/g),
    ...collectMatches(segments, /合計(\d+(?:\.\d+)?)回/g),
  ];
  const total = uniqueValue(totals);
  const totalPath = totals[0]?.path ?? "schedule";

  // 頻度×期間 = 総回数（デッキ全体で各値が一意な場合だけ判定する。
  // 複数の独立した予定が併記された資料では誤検出になるため）。
  const hasPartialNote = segments.some((segment) =>
    /未定|調整中|仮の|一部のみ/.test(segment.normalized),
  );
  if (total !== null && !hasPartialNote) {
    const monthlyFreq = uniqueValue(collectMatches(segments, /(?:月|月に)(\d+(?:\.\d+)?)回/g));
    const months = uniqueValue(collectMatches(segments, /(\d+(?:\.\d+)?)(?:か月|ヶ月|ヵ月)(?!目)/g));
    if (monthlyFreq !== null && months !== null) {
      const expected = monthlyFreq * months;
      if (Math.abs(expected - total) > 0.001) {
        add(
          "SCHEDULE_COUNT_MISMATCH",
          totalPath,
          `回数が一致しません: 月${monthlyFreq}回×${months}か月=${roundForMessage(expected)}回 に対し、総回数は${total}回と記載されています: ${totalPath}`,
        );
      }
    }
    const weeklyFreq = uniqueValue(collectMatches(segments, /(?:週|週に)(\d+(?:\.\d+)?)回/g));
    const weeks = uniqueValue(collectMatches(segments, /(\d+(?:\.\d+)?)週間/g));
    if (weeklyFreq !== null && weeks !== null) {
      const expected = weeklyFreq * weeks;
      if (Math.abs(expected - total) > 0.001) {
        add(
          "SCHEDULE_COUNT_MISMATCH",
          totalPath,
          `回数が一致しません: 週${weeklyFreq}回×${weeks}週間=${roundForMessage(expected)}回 に対し、総回数は${total}回と記載されています: ${totalPath}`,
        );
      }
    }
  }

  // 第N回 の列挙: 総回数を超える回次があれば、それ自体が矛盾。
  let maxLabel = 0;
  let maxLabelPath = "";
  for (const segment of segments) {
    for (const match of segment.normalized.matchAll(/第(\d+)回/g)) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > maxLabel) {
        maxLabel = value;
        maxLabelPath = segment.path;
      }
    }
  }
  if (total !== null && maxLabel > total) {
    add(
      "SCHEDULE_COUNT_MISMATCH",
      maxLabelPath,
      `予定表の回次が総回数を超えています: 第${maxLabel}回 まで列挙されていますが、総回数は${total}回と記載されています: ${maxLabelPath}`,
    );
  }

  // 同一セグメント内の自己完結した矛盾: 総回数の主張と同じ文面に
  // 列挙された回次・日付の件数が食い違う。
  for (const segment of segments) {
    const segmentTotals = [
      ...segment.normalized.matchAll(/全(\d+(?:\.\d+)?)回/g),
      ...segment.normalized.matchAll(/合計(\d+(?:\.\d+)?)回/g),
    ].map((match) => Number(match[1])).filter((value) => Number.isFinite(value));
    if (segmentTotals.length === 0) continue;
    const segmentTotal = segmentTotals[0];
    const labels = new Set<number>();
    for (const match of segment.normalized.matchAll(/第(\d+)回/g)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) labels.add(value);
    }
    if (labels.size >= 2 && labels.size !== segmentTotal) {
      add(
        "SCHEDULE_COUNT_MISMATCH",
        segment.path,
        `回数が一致しません: 全${segmentTotal}回と記載されていますが、同じ箇所に列挙された回次は${labels.size}件です: ${segment.path}`,
      );
      continue;
    }
    const dates = new Set(
      segment.tokens
        .filter((token) => token.cls === "date" && token.dateKey !== undefined)
        .map((token) => token.dateKey),
    );
    if (dates.size >= 2 && dates.size !== segmentTotal) {
      add(
        "SCHEDULE_COUNT_MISMATCH",
        segment.path,
        `回数が一致しません: 全${segmentTotal}回と記載されていますが、同じ箇所に列挙された日付は${dates.size}件です: ${segment.path}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4) 積の整合: 元数・割合・結果がすべて明記された主張の再計算
// ---------------------------------------------------------------------------

const PRODUCT_BASE_GAP = /(×|✕|\*|の|に|、|率|で)/;
const PRODUCT_RESULT_GAP = /(=|＝|→|で|見込み|想定|予測|推計|受注|約)/;

function checkProductClaims(
  segment: Segment,
  add: (code: ProposalDeckFinishGateViolationCode, path: string, message: string) => void,
): void {
  const tokens = segment.tokens;
  const counts = tokens.filter((token) => token.cls === "count");
  const percents = tokens.filter((token) => token.cls === "percent");
  const usedResults = new Set<GroundedNumericToken>();

  for (const percent of percents) {
    // 元数: 割合より前にある最も近い件数トークン。間の文面に関係の
    // 手がかり（×・の・率・転換率の「率」等）がある場合だけ組にする。
    let base: GroundedNumericToken | undefined;
    for (const candidate of counts) {
      if (candidate.end <= percent.start && (!base || candidate.start > base.start)) {
        base = candidate;
      }
    }
    if (!base) continue;
    const baseGap = segment.normalized.slice(base.end, percent.start);
    if (baseGap.length > 14 || !PRODUCT_BASE_GAP.test(baseGap)) continue;

    // 結果: 割合より後にある最も近い件数トークン。間に結果らしい
    // 手がかり（=・→・見込み・想定・約 等）がある場合だけ組にする。
    let result: GroundedNumericToken | undefined;
    for (const candidate of counts) {
      if (
        candidate.start >= percent.end
        && !usedResults.has(candidate)
        && (!result || candidate.start < result.start)
      ) {
        result = candidate;
      }
    }
    if (!result) continue;
    const resultGap = segment.normalized.slice(percent.end, result.start);
    if (resultGap.length > 16 || !PRODUCT_RESULT_GAP.test(resultGap)) continue;

    usedResults.add(result);
    const expected = (base.value * percent.value) / 100;
    if (!numbersAgree(expected, result.value)) {
      add(
        "PRODUCT_RESULT_MISMATCH",
        segment.path,
        `割合の計算が一致しません: ${base.raw}の${percent.raw}は${roundForMessage(expected)}ですが、結果は${result.raw}と記載されています: ${segment.path}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5) 仮定の明示: 価格ラベルを伴う金額の無印断定
// ---------------------------------------------------------------------------

const ASSUMPTION_MARKER = /仮定|想定|目安|試算|概算|前提|仮置き|見込み|暫定|推計|推定/;
const PRICE_LABEL =
  /初期費用|導入費用|導入費|初期コスト|月額|年額|価格|料金|単価|利用料|費用|予算|コスト/;

function checkAssumptionLabels(
  segments: readonly Segment[],
  add: (code: ProposalDeckFinishGateViolationCode, path: string, message: string) => void,
): void {
  // 仮定マーカーのある文面（前提セグメント含む）に現れた金額は、
  // 本文で同額が再掲されても「明示済み」として扱う。
  const labeledValues = new Set<number>();
  for (const segment of segments) {
    if (!ASSUMPTION_MARKER.test(segment.normalized)) continue;
    for (const token of segment.tokens) {
      if (token.cls === "money") labeledValues.add(token.value);
    }
  }

  for (const segment of segments) {
    if (segment.path.startsWith("assumptions[")) continue;
    if (ASSUMPTION_MARKER.test(segment.normalized)) continue;
    if (!PRICE_LABEL.test(segment.normalized)) continue;
    const unlabeled = segment.tokens.find(
      (token) => token.cls === "money" && !labeledValues.has(token.value),
    );
    if (unlabeled) {
      add(
        "ASSUMPTION_NOT_LABELED",
        segment.path,
        `価格・費用の数値が仮定と明示されずに断定されています: ${unlabeled.raw}: ${segment.path}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

export function checkProposalDeckFinishGate(
  input: ProposalDeckFinishGateInput,
): ProposalDeckFinishGateViolation[] {
  const violations: ProposalDeckFinishGateViolation[] = [];
  const add = (code: ProposalDeckFinishGateViolationCode, path: string, message: string) => {
    violations.push({ code, path, message });
  };

  const segments: Segment[] = [];
  for (const segment of input.deckSegments ?? []) {
    const text = typeof segment?.text === "string" ? segment.text : "";
    if (text === "") continue;
    segments.push({
      path: segment.path,
      text,
      normalized: normalizeText(text),
      tokens: extractGroundedNumericTokens(text),
    });
  }

  for (const segment of segments) {
    checkTemplateText(segment, add);
    checkGrammar(segment, add);
    checkProductClaims(segment, add);
  }
  checkScheduleCounts(segments, add);
  checkAssumptionLabels(segments, add);

  return violations;
}
