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

export type ProposalDeckViolationCode =
  | 'SUMMARY_MISSING'
  | 'SUMMARY_POINTS'
  | 'HEADLINE_NOT_ASSERTION'
  | 'TOO_MANY_BULLETS'
  | 'BULLET_TOO_LONG'
  | 'PLACEHOLDER_REMAINING'
  | 'COLOR_OUT_OF_TOKENS'
  | 'SLIDE_COUNT_OUT_OF_RANGE';

export interface ProposalDeckViolation {
  code: ProposalDeckViolationCode;
  path: string;
  message: string;
}

export interface ProposalDeckSelfCheckResult {
  ok: boolean;
  violations: ProposalDeckViolation[];
}

/**
 * 見出しが結論文（主張文）かの決定的判定。
 * 「。」で終わる文、または述語で終わる文を合格とし、名詞止めのラベル（例「現状の課題」）を不合格とする。
 */
const ASSERTION_ENDING =
  /(です|ます|した|します|できる|できます|なります|あります|います|高い|大きい|小さい|多い|少ない|必要です|可能です|有効です)$/;

function isAssertion(message: string): boolean {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text === '') return false;
  if (text.endsWith('。')) return true;
  return ASSERTION_ENDING.test(text);
}

const PLACEHOLDER_BRACKET = /\[.+?\]/;
const PLACEHOLDER_TBD = /TBD/i;

function hasPlaceholder(text: string): boolean {
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

export function checkProposalDeck(deck: ProposalDeck): ProposalDeckSelfCheckResult {
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

  return { ok: violations.length === 0, violations };
}
