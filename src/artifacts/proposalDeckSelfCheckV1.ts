/**
 * ProposalDeck Self-Check V1 — レンダリング前の決定的自己チェック。
 *
 * 設計の正本: ~/workspace/origin-fix/PROPOSAL_PIPELINE_DESIGN_2026-11-12.md §4
 * - 純関数。例外を投げない（不正な形の入力でも違反として返す）。
 * - 追加コストなし（モデル呼び出しなし）。不合格は violations の code で機械判定できる。
 */

import {
  PROPOSAL_COLOR_TOKEN_NAMES,
  PROPOSAL_DESIGN_TOKENS,
  type ProposalDeck,
} from './proposalDeckV1.js';
import type { ProposalDeckInput } from './proposalDeckPlannerV1.js';
import { checkProposalDeckNumericGrounding } from './proposalDeckNumericGroundingV1.js';
import { checkProposalDeckFinishGate } from './proposalDeckFinishGateV1.js';

export type ProposalDeckViolationCode =
  | 'SUMMARY_MISSING'
  | 'SUMMARY_POINTS'
  | 'HEADLINE_NOT_ASSERTION'
  | 'TOO_MANY_BULLETS'
  | 'BULLET_TOO_LONG'
  | 'PLACEHOLDER_REMAINING'
  | 'COLOR_OUT_OF_TOKENS'
  | 'SLIDE_COUNT_OUT_OF_RANGE'
  | 'NUMERIC_TOKEN_NOT_PRESERVED'
  // 数値の素材照合（proposalDeckNumericGroundingV1、shadow 専用コード）。
  // checkProposalDeck の violations には入らず、結果の
  // numericGroundingViolations に分離して返る（成立可否は変えない）。
  | 'NUMERIC_FORMULA_MISMATCH'
  | 'NUMERIC_NOT_GROUNDED'
  | 'SOURCE_NUMERIC_MISSING'
  // 仕上がり検証（proposalDeckFinishGateV1、shadow 専用コード）。
  // 同じく violations には入らず、結果の finishGateViolations に
  // 分離して返る（成立可否は変えない）。
  | 'TEMPLATE_TEXT_REMAINING'
  | 'GRAMMAR_POLITENESS_DUPLICATION'
  | 'SCHEDULE_COUNT_MISMATCH'
  | 'PRODUCT_RESULT_MISMATCH'
  | 'ASSUMPTION_NOT_LABELED';

export interface ProposalDeckViolation {
  code: ProposalDeckViolationCode;
  path: string;
  message: string;
}

export interface ProposalDeckSelfCheckResult {
  ok: boolean;
  violations: ProposalDeckViolation[];
  /**
   * 数値の素材照合（shadow）の検出結果。options.numericGrounding を
   * 指定した場合にだけ付き、ok には数えない（DOCUMENT_WAVE2 §4 単位2:
   * 注記・enforce は単位4で、オーナー承認待ち）。
   */
  numericGroundingViolations?: ProposalDeckViolation[];
  /**
   * 仕上がり検証（shadow）の検出結果。options.finishGate を指定した
   * 場合にだけ付き、ok には数えない（数値照合と同じ段階付け:
   * 注記・enforce は後段の単位で、オーナー承認待ち）。
   */
  finishGateViolations?: ProposalDeckViolation[];
}

/**
 * 見出しが結論文（主張文）かの決定的判定。
 * 「。」で終わる文、または述語で終わる文を合格とし、名詞止めのラベル（例「現状の課題」）を不合格とする。
 * 資料レコード再設計のゲート4（proposalDeckAssemblyV1）からも土台として
 * 参照するため export する。判定規則自体は変更しない（新経路側の
 * 受動形の追加は proposalDeckAssemblyV1 の isDeckAssertionSentence 側で行う）。
 */
const ASSERTION_ENDING =
  /(です|ます|した|します|できる|できます|なります|あります|います|高い|大きい|小さい|多い|少ない|必要です|可能です|有効です)$/;

export function isAssertion(message: string): boolean {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text === '') return false;
  if (text.endsWith('。')) return true;
  return ASSERTION_ENDING.test(text);
}

const PLACEHOLDER_BRACKET = /\[.+?\]/;
const PLACEHOLDER_TBD = /TBD/i;

/** プレースホルダー（[項目]・〇・××・TBD）の残存判定。ゲート3（proposalDeckAssemblyV1）と規則を共有するため export する。 */
export function hasPlaceholder(text: string): boolean {
  if (typeof text !== 'string') return false;
  return (
    PLACEHOLDER_BRACKET.test(text) ||
    text.includes('〇') ||
    text.includes('××') ||
    PLACEHOLDER_TBD.test(text)
  );
}

/** コードポイント単位の文字数（サロゲートペアを1字として数える）。 */
function charCount(text: string): number {
  return [...text].length;
}

const NUMERIC_TOKEN_PATTERN = /\d+(?:\.\d+)?/g;

/** 数値トークンの正規形（先行ゼロ・末尾ゼロを落とし、表記ゆれを吸収する）。 */
function canonicalNumericToken(raw: string): string {
  const [intPart, fracPart = ''] = raw.split('.');
  const intNormalized = intPart.replace(/^0+(?=\d)/, '');
  const fracNormalized = fracPart.replace(/0+$/, '');
  return fracNormalized === '' ? intNormalized : `${intNormalized}.${fracNormalized}`;
}

/**
 * テキストから数値トークンを抽出する（全角→半角・桁区切り除去をしてから照合）。
 * 価格・件数・割合・日付などの「意味を持つ数」を、表記ではなく値で比べるための前処理。
 */
export function extractNumericTokens(text: string): string[] {
  if (typeof text !== 'string' || text === '') return [];
  const normalized = text.normalize('NFKC').replace(/,/g, '');
  const tokens: string[] = [];
  for (const match of normalized.matchAll(NUMERIC_TOKEN_PATTERN)) {
    tokens.push(canonicalNumericToken(match[0]));
  }
  return tokens;
}

function countNumericTokens(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of extractNumericTokens(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return counts;
}

function compareNumericTokens(a: string, b: string): number {
  const diff = Number(a) - Number(b);
  return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0;
}

function pushText(texts: string[], value: unknown) {
  if (typeof value === 'string') texts.push(value);
}

/** デッキ側の全テキスト（path 付き）。数値保全・素材照合の比較対象。 */
export function collectProposalDeckTextSegments(
  deck: Partial<ProposalDeck>,
): { path: string; text: string }[] {
  const segments: { path: string; text: string }[] = [];
  const push = (path: string, value: unknown) => {
    if (typeof value === 'string') segments.push({ path, text: value });
  };
  push('title', deck.title);
  push('subtitle', deck.subtitle);
  push('presenter', deck.presenter);
  push('date', deck.date);
  push('summary.headline', deck.summary?.headline);
  (Array.isArray(deck.summary?.points) ? deck.summary.points : []).forEach((point, index) => {
    push(`summary.points[${index}]`, point);
  });
  (Array.isArray(deck.sections) ? deck.sections : []).forEach((section, sectionIndex) => {
    push(`sections[${sectionIndex}].message`, section?.message);
    push(`sections[${sectionIndex}].visual.title`, section?.visual?.title);
    (Array.isArray(section?.bullets) ? section.bullets : []).forEach((bullet, bulletIndex) => {
      push(`sections[${sectionIndex}].bullets[${bulletIndex}].lead`, bullet?.lead);
      push(`sections[${sectionIndex}].bullets[${bulletIndex}].detail`, bullet?.detail);
    });
  });
  push('closing.ask', deck.closing?.ask);
  (Array.isArray(deck.closing?.nextSteps) ? deck.closing.nextSteps : []).forEach((step, index) => {
    push(`closing.nextSteps[${index}]`, step);
  });
  (Array.isArray(deck.assumptions) ? deck.assumptions : []).forEach((assumption, index) => {
    push(`assumptions[${index}]`, assumption);
  });
  return segments;
}

/** デッキ側の全テキスト（数値保全チェックの比較対象）。 */
function collectDeckTexts(deck: Partial<ProposalDeck>): string[] {
  return collectProposalDeckTextSegments(deck).map((segment) => segment.text);
}

/**
 * 数値保全チェックの「原文」側テキストを、パース済みの骨格入力から集める。
 * 原文の生の散文ではなく骨格入力（＝原文のキーセクションの抽出結果）を原文とするのは、
 * 導入文や確認質問の選択肢など、資料へ載せないことが設計上の前提である数まで
 * 「欠落」と数えないため。
 */
export function proposalDeckNumericSourceTexts(input: ProposalDeckInput): string[] {
  const source = (input ?? {}) as ProposalDeckInput;
  const texts: string[] = [];
  pushText(texts, source.title);
  pushText(texts, source.subtitle);
  pushText(texts, source.presenter);
  pushText(texts, source.date);
  pushText(texts, source.summary?.headline);
  for (const point of Array.isArray(source.summary?.points) ? source.summary.points : []) {
    pushText(texts, point);
  }
  for (const section of Array.isArray(source.sections) ? source.sections : []) {
    pushText(texts, section?.message);
    pushText(texts, section?.visual?.title);
    for (const bullet of Array.isArray(section?.bullets) ? section?.bullets : []) {
      pushText(texts, bullet?.lead);
      pushText(texts, bullet?.detail);
    }
  }
  pushText(texts, source.closing?.ask);
  for (const step of Array.isArray(source.closing?.nextSteps) ? source.closing.nextSteps : []) {
    pushText(texts, step);
  }
  for (const assumption of Array.isArray(source.assumptions) ? source.assumptions : []) {
    pushText(texts, assumption);
  }
  return texts;
}

export interface ProposalDeckSelfCheckOptions {
  /**
   * 指定された場合のみ、原文テキスト群と資料の数値トークンの多重集合が
   * 一致するかを追加で検証する（NUMERIC_TOKEN_NOT_PRESERVED）。
   * 既知の制限: トークン単位の比較であり、数値が指す対象・時点・単位の
   * 対応までは検証しない（意味付きの照合は検索強化トラック側の設計に委ねる）。
   */
  numericSourceTexts?: readonly string[];
  /**
   * 指定された場合のみ、デッキの数値を素材テキストと照合する
   * （proposalDeckNumericGroundingV1、DOCUMENT_WAVE2 §4 単位2）。
   * 結果は shadow として結果の numericGroundingViolations に分離して
   * 返り、ok（成立可否）は変えない。未指定時は一切実行しない
   * （現行挙動と同一）。
   */
  numericGrounding?: {
    /** 素材テキスト（依頼文＋素材）。 */
    sourceTexts: readonly string[];
    /** 当日日付の刻印を根拠なしとしないための基準日。 */
    referenceDate?: Date;
  };
  /**
   * 指定された場合のみ、生成物の仕上がり（定型文の残存・文法の
   * 二重丁寧・回数と積の整合・仮定の明示）を検証する
   * （proposalDeckFinishGateV1）。素材テキストは不要で、結果は
   * shadow として結果の finishGateViolations に分離して返り、
   * ok（成立可否）は変えない。未指定時は一切実行しない
   * （現行挙動と同一）。enabled: false の指定でも実行しない。
   */
  finishGate?: {
    enabled?: boolean;
  };
}

export function checkProposalDeck(
  deck: ProposalDeck,
  options?: ProposalDeckSelfCheckOptions,
): ProposalDeckSelfCheckResult {
  const violations: ProposalDeckViolation[] = [];
  const add = (code: ProposalDeckViolationCode, path: string, message: string) => {
    violations.push({ code, path, message });
  };
  const checkPlaceholder = (text: unknown, path: string) => {
    if (typeof text === 'string' && hasPlaceholder(text)) {
      add('PLACEHOLDER_REMAINING', path, `プレースホルダーが残っています: ${path}`);
    }
  };

  const source = (deck ?? {}) as Partial<ProposalDeck>;

  checkPlaceholder(source.title, 'title');
  checkPlaceholder(source.subtitle, 'subtitle');

  // 要約: 存在し、ポイントが3つあること。
  const summary = source.summary;
  if (!summary || typeof summary !== 'object') {
    add('SUMMARY_MISSING', 'summary', 'エグゼクティブサマリーがありません');
  } else {
    checkPlaceholder(summary.headline, 'summary.headline');
    const points = Array.isArray(summary.points) ? summary.points : [];
    if (points.length !== 3) {
      add(
        'SUMMARY_POINTS',
        'summary.points',
        `summary.points は3件ちょうどが必要です（実際: ${points.length}件）`,
      );
    }
    points.forEach((point, index) => checkPlaceholder(point, `summary.points[${index}]`));
  }

  const sections = Array.isArray(source.sections) ? source.sections : [];
  const { maxPerSection, maxChars } = PROPOSAL_DESIGN_TOKENS.bullets;
  sections.forEach((section, sectionIndex) => {
    const sectionPath = `sections[${sectionIndex}]`;
    if (!isAssertion(section?.message)) {
      add(
        'HEADLINE_NOT_ASSERTION',
        `${sectionPath}.message`,
        `見出しが結論の文になっていません: ${sectionPath}.message`,
      );
    }
    checkPlaceholder(section?.message, `${sectionPath}.message`);

    const bullets = Array.isArray(section?.bullets) ? section.bullets : [];
    if (bullets.length > maxPerSection) {
      add(
        'TOO_MANY_BULLETS',
        `${sectionPath}.bullets`,
        `箇条書きは1セクション${maxPerSection}件までです（実際: ${bullets.length}件）: ${sectionPath}.bullets`,
      );
    }
    bullets.forEach((bullet, bulletIndex) => {
      const bulletPath = `${sectionPath}.bullets[${bulletIndex}]`;
      const length = charCount(bullet?.lead ?? '') + charCount(bullet?.detail ?? '');
      if (length > maxChars) {
        add(
          'BULLET_TOO_LONG',
          bulletPath,
          `箇条書きは1件${maxChars}字以内です（実際: ${length}字）: ${bulletPath}`,
        );
      }
      checkPlaceholder(bullet?.lead, `${bulletPath}.lead`);
      checkPlaceholder(bullet?.detail, `${bulletPath}.detail`);
    });

    const colorToken = section?.visual?.colorToken;
    if (
      colorToken !== undefined &&
      !(PROPOSAL_COLOR_TOKEN_NAMES as ReadonlySet<string>).has(colorToken)
    ) {
      add(
        'COLOR_OUT_OF_TOKENS',
        `${sectionPath}.visual.colorToken`,
        `色トークンにない色が指定されています: ${sectionPath}.visual.colorToken`,
      );
    }
  });

  checkPlaceholder(source.closing?.ask, 'closing.ask');
  const nextSteps = Array.isArray(source.closing?.nextSteps) ? source.closing.nextSteps : [];
  nextSteps.forEach((step, index) => checkPlaceholder(step, `closing.nextSteps[${index}]`));

  // 総スライド数 = 表紙1 + 要約1 + sections + 締め1。
  const slideCount = sections.length + 3;
  const { min, max } = PROPOSAL_DESIGN_TOKENS.slideCount;
  if (slideCount < min || slideCount > max) {
    add(
      'SLIDE_COUNT_OUT_OF_RANGE',
      'sections',
      `総スライド数は${min}〜${max}です（実際: ${slideCount}）`,
    );
  }

  // 数値トークン保全（options 指定時のみ）: 原文のキーセクションに現れた数値が
  // 資料に同じ件数だけ残っていること。欠落・改変・原文にない数の混入を、
  // ゲートを強める方向でのみ検出する。
  if (options?.numericSourceTexts) {
    const sourceCounts = countNumericTokens(options.numericSourceTexts);
    const deckCounts = countNumericTokens(collectDeckTexts(source));
    const tokens = [...new Set([...sourceCounts.keys(), ...deckCounts.keys()])].sort(
      compareNumericTokens,
    );
    for (const token of tokens) {
      const inSource = sourceCounts.get(token) ?? 0;
      const inDeck = deckCounts.get(token) ?? 0;
      if (inDeck < inSource) {
        add(
          'NUMERIC_TOKEN_NOT_PRESERVED',
          'numericTokens',
          `原文の数値が資料に残っていません: ${token}（原文${inSource}件・資料${inDeck}件）`,
        );
      } else if (inDeck > inSource) {
        add(
          'NUMERIC_TOKEN_NOT_PRESERVED',
          'numericTokens',
          `原文にない数値が資料に含まれています: ${token}（原文${inSource}件・資料${inDeck}件）`,
        );
      }
    }
  }

  // 数値の素材照合（shadow、options 指定時のみ）: 検出は成立可否に
  // 一切影響させず、別のフィールドで返す（DOCUMENT_WAVE2 §4 単位2）。
  const numericGroundingViolations = options?.numericGrounding
    ? checkProposalDeckNumericGrounding({
        deckSegments: collectProposalDeckTextSegments(source),
        sourceTexts: options.numericGrounding.sourceTexts,
        referenceDate: options.numericGrounding.referenceDate,
      })
    : undefined;

  // 仕上がり検証（shadow、options 指定時のみ）: 数値照合と同じ段階
  // 付けで、検出は成立可否に一切影響させず、別のフィールドで返す。
  const finishGateViolations =
    options?.finishGate && options.finishGate.enabled !== false
      ? checkProposalDeckFinishGate({
          deckSegments: collectProposalDeckTextSegments(source),
        })
      : undefined;

  return {
    ok: violations.length === 0,
    violations,
    ...(numericGroundingViolations ? { numericGroundingViolations } : {}),
    ...(finishGateViolations ? { finishGateViolations } : {}),
  };
}
