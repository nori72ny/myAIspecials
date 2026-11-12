/**
 * ProposalDeck Planner V1 — 構造化入力を検証・正規化して ProposalDeck を返す決定的ビルダー。
 *
 * 設計の正本: ~/workspace/origin-fix/PROPOSAL_PIPELINE_DESIGN_2026-11-12.md §1
 * - 純関数。LLM は呼ばない。同じ入力には同じ出力（日付等の暗黙の既定値も持たない）。
 * - 構造的に作れない入力は ProposalDeckBuildError（code 付き）で失敗する。
 * - 内容の良し悪し（プレースホルダー残り、見出しが結論文か等）はここでは直さない。
 *   それは proposalDeckSelfCheckV1 の担当。
 */

import {
  PROPOSAL_SECTION_ROLE_ORDER,
  type ProposalDeck,
  type ProposalDeckBullet,
  type ProposalDeckSection,
  type ProposalDeckSectionRole,
  type ProposalDeckVisual,
  type ProposalDeckVisualKind,
} from './proposalDeckV1.js';

export type ProposalDeckBuildErrorCode =
  | 'TITLE_EMPTY'
  | 'SUMMARY_POINTS_INVALID'
  | 'NEXT_STEPS_EMPTY'
  | 'SECTIONS_EMPTY'
  | 'SECTION_ROLE_INVALID'
  | 'SECTION_MESSAGE_EMPTY'
  | 'SECTION_VISUAL_INVALID'
  | 'BULLET_LEAD_EMPTY';

export class ProposalDeckBuildError extends Error {
  readonly code: ProposalDeckBuildErrorCode;
  readonly path: string;

  constructor(code: ProposalDeckBuildErrorCode, path: string, message: string) {
    super(message);
    this.name = 'ProposalDeckBuildError';
    this.code = code;
    this.path = path;
  }
}

/** ビルダーへの入力。未検証の構造化データを受けるため、各フィールドは任意で緩く受ける。 */
export interface ProposalDeckSectionInput {
  role?: string;
  message?: string;
  bullets?: Array<{ lead?: string; detail?: string }>;
  visual?: { kind?: string; title?: string; colorToken?: string };
}

export interface ProposalDeckInput {
  title?: string;
  subtitle?: string;
  presenter?: string;
  date?: string;
  summary?: { headline?: string; points?: string[] };
  sections?: ProposalDeckSectionInput[];
  closing?: { ask?: string; nextSteps?: string[] };
  assumptions?: string[];
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function trimmedList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const text = trimmed(item);
    if (text !== '') result.push(text);
  }
  return result;
}

const ROLE_RANK = new Map<ProposalDeckSectionRole, number>(
  PROPOSAL_SECTION_ROLE_ORDER.map((role, index) => [role, index]),
);

const VISUAL_KINDS: ReadonlySet<string> = new Set(['table', 'bar', 'steps']);

function buildVisual(
  input: ProposalDeckSectionInput['visual'],
  path: string,
): ProposalDeckVisual | undefined {
  if (input === undefined || input === null) return undefined;
  const kind = trimmed(input.kind);
  if (!VISUAL_KINDS.has(kind)) {
    throw new ProposalDeckBuildError(
      'SECTION_VISUAL_INVALID',
      `${path}.kind`,
      `visual.kind は table | bar | steps のいずれかが必要です: ${path}`,
    );
  }
  const visual: ProposalDeckVisual = { kind: kind as ProposalDeckVisualKind };
  const title = trimmed(input.title);
  if (title !== '') visual.title = title;
  const colorToken = trimmed(input.colorToken);
  if (colorToken !== '') visual.colorToken = colorToken;
  return visual;
}

function buildSection(input: ProposalDeckSectionInput, index: number): ProposalDeckSection {
  const path = `sections[${index}]`;
  const role = trimmed(input?.role);
  if (!ROLE_RANK.has(role as ProposalDeckSectionRole)) {
    throw new ProposalDeckBuildError(
      'SECTION_ROLE_INVALID',
      `${path}.role`,
      `section の role が不正です: ${path}.role`,
    );
  }
  const message = trimmed(input?.message);
  if (message === '') {
    throw new ProposalDeckBuildError(
      'SECTION_MESSAGE_EMPTY',
      `${path}.message`,
      `section の message（結論の文）が空です: ${path}.message`,
    );
  }
  const rawBullets = Array.isArray(input?.bullets) ? input.bullets : [];
  const bullets: ProposalDeckBullet[] = rawBullets.map((bullet, bulletIndex) => {
    const lead = trimmed(bullet?.lead);
    if (lead === '') {
      throw new ProposalDeckBuildError(
        'BULLET_LEAD_EMPTY',
        `${path}.bullets[${bulletIndex}].lead`,
        `bullet の lead が空です: ${path}.bullets[${bulletIndex}].lead`,
      );
    }
    return { lead, detail: trimmed(bullet?.detail) };
  });
  const section: ProposalDeckSection = {
    role: role as ProposalDeckSectionRole,
    message,
    bullets,
  };
  const visual = buildVisual(input?.visual, `${path}.visual`);
  if (visual !== undefined) section.visual = visual;
  return section;
}

/**
 * 構造化入力を検証・正規化して ProposalDeck を返す。
 * 正規化: 全文字列を trim し、sections を role の固定順（同順位は入力順）へ並べ替える。
 */
export function buildProposalDeck(input: ProposalDeckInput): ProposalDeck {
  const source: ProposalDeckInput = input ?? {};

  const title = trimmed(source.title);
  if (title === '') {
    throw new ProposalDeckBuildError('TITLE_EMPTY', 'title', 'title が空です');
  }

  const rawPoints = Array.isArray(source.summary?.points) ? source.summary.points : [];
  if (rawPoints.length !== 3) {
    throw new ProposalDeckBuildError(
      'SUMMARY_POINTS_INVALID',
      'summary.points',
      `summary.points は3件ちょうどが必要です（実際: ${rawPoints.length}件）`,
    );
  }
  const points = rawPoints.map((point) => trimmed(point)) as [string, string, string];

  const rawSections = Array.isArray(source.sections) ? source.sections : [];
  if (rawSections.length === 0) {
    throw new ProposalDeckBuildError(
      'SECTIONS_EMPTY',
      'sections',
      'sections が0件です',
    );
  }
  const builtSections = rawSections.map((section, index) => buildSection(section, index));
  const sections = builtSections
    .map((section, index) => ({ section, index }))
    .sort(
      (a, b) =>
        (ROLE_RANK.get(a.section.role) ?? 0) - (ROLE_RANK.get(b.section.role) ?? 0) ||
        a.index - b.index,
    )
    .map(({ section }) => section);

  const nextSteps = trimmedList(source.closing?.nextSteps);
  if (nextSteps.length === 0) {
    throw new ProposalDeckBuildError(
      'NEXT_STEPS_EMPTY',
      'closing.nextSteps',
      'closing.nextSteps が0件です',
    );
  }

  const deck: ProposalDeck = {
    title,
    subtitle: trimmed(source.subtitle),
    date: trimmed(source.date),
    summary: {
      headline: trimmed(source.summary?.headline),
      points,
    },
    sections,
    closing: {
      ask: trimmed(source.closing?.ask),
      nextSteps,
    },
    assumptions: trimmedList(source.assumptions),
  };
  const presenter = trimmed(source.presenter);
  if (presenter !== '') deck.presenter = presenter;
  return deck;
}
