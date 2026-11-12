/**
 * ProposalDeck V1 — 提案資料の構造化モデルとデザイントークン。
 *
 * 設計の正本: ~/workspace/origin-fix/PROPOSAL_PIPELINE_DESIGN_2026-11-12.md §1〜§2
 * - 業務提案の骨格は固定: 表紙 → エグゼクティブサマリー → 課題 → 解決策 → 価値 → 計画 → 費用・効果 → 次ステップ
 * - 各セクションの見出しは「ラベル」ではなく結論の文（message）にする
 * - 色は既存生成器（artifactGeneratorV12）の家の色に揃える:
 *   ink #17324D（DOCX タイトル色）/ accent #0F6CBD（見出し・表ヘッダー色）/ slate #334155（本文系）
 *
 * このモジュールは型と定数のみを持ち、副作用はない。
 */

export type ProposalDeckSectionRole =
  | 'challenge'
  | 'solution'
  | 'value'
  | 'plan'
  | 'cost'
  | 'other';

/** セクションの固定順（課題 → 解決策 → 価値 → 計画 → 費用・効果 → その他）。 */
export const PROPOSAL_SECTION_ROLE_ORDER: readonly ProposalDeckSectionRole[] = [
  'challenge',
  'solution',
  'value',
  'plan',
  'cost',
  'other',
];

export type ProposalDeckVisualKind = 'table' | 'bar' | 'steps';

export interface ProposalDeckVisual {
  kind: ProposalDeckVisualKind;
  title?: string;
  /** PROPOSAL_COLOR_TOKEN_NAMES のいずれか。実色ではなくトークン名で指定する。 */
  colorToken?: string;
}

export interface ProposalDeckBullet {
  /** リード文（太字で示す要点）。 */
  lead: string;
  /** リードの補足説明。 */
  detail: string;
}

export interface ProposalDeckSection {
  role: ProposalDeckSectionRole;
  /** ラベルではなく結論の文（例:「導入で月40時間を削減できます」）。 */
  message: string;
  bullets: ProposalDeckBullet[];
  visual?: ProposalDeckVisual;
}

export interface ProposalDeckSummary {
  headline: string;
  /** 必ず3点。 */
  points: [string, string, string];
}

export interface ProposalDeckClosing {
  /** 相手への依頼（決めてほしいこと・頼みたいこと）。 */
  ask: string;
  nextSteps: string[];
}

export interface ProposalDeck {
  title: string;
  subtitle: string;
  presenter?: string;
  date: string;
  summary: ProposalDeckSummary;
  sections: ProposalDeckSection[];
  closing: ProposalDeckClosing;
  /** 与えられなかった事実・前提条件の明示。プレースホルダーを本文に残す代わりにここへ集める。 */
  assumptions: string[];
}

/** 提案テーマの色。既存生成器の家の色と一致させる（最大4色）。 */
export const PROPOSAL_COLOR_TOKENS = {
  paper: '#FFFFFF',
  ink: '#17324D',
  accent: '#0F6CBD',
  slate: '#334155',
} as const;

export type ProposalColorTokenName = keyof typeof PROPOSAL_COLOR_TOKENS;

/** 色トークン名の集合。visual.colorToken の検証に使う。 */
export const PROPOSAL_COLOR_TOKEN_NAMES: ReadonlySet<ProposalColorTokenName> =
  new Set(Object.keys(PROPOSAL_COLOR_TOKENS) as ProposalColorTokenName[]);

/**
 * 図表のカテゴリ色（テーマ4色とは別枠、最大8色）。
 * - 用途は図形・グラフの塗り専用。本文テキストには使わない。
 * - 全色とも白地（paper #FFFFFF）に対してコントラスト比 3:1 以上（WCAG 2.1 非テキスト基準）。
 *   実測はいずれも約 5.0:1 以上で、白の太字ラベルを載せても判読できる濃さに揃えている。
 * - ディープネイビー基調と喧嘩しない、彩度を抑えた深めの色相で互いに識別可能に選定。
 */
export const PROPOSAL_CATEGORY_COLOR_TOKENS = {
  teal: '#0F766E',
  indigo: '#4338CA',
  violet: '#6D28D9',
  rose: '#BE123C',
  orange: '#C2410C',
  amber: '#B45309',
  green: '#15803D',
  cyan: '#0E7490',
} as const;

export type ProposalCategoryColorTokenName = keyof typeof PROPOSAL_CATEGORY_COLOR_TOKENS;

/** カテゴリ色の名前一覧（定義順 = レンダラーが系列へ割り当てる順）。 */
export const PROPOSAL_CATEGORY_COLOR_TOKEN_NAMES: readonly ProposalCategoryColorTokenName[] =
  Object.keys(PROPOSAL_CATEGORY_COLOR_TOKENS) as ProposalCategoryColorTokenName[];

/**
 * デザイントークン（スライド 16:9 基準）。
 * 自己チェック（proposalDeckSelfCheckV1）と将来のレンダラー（PR-2/PR-3）が共通で参照する。
 */
export const PROPOSAL_DESIGN_TOKENS = {
  colors: PROPOSAL_COLOR_TOKENS,
  typography: {
    titlePt: 40,
    headlinePt: 28,
    bodyPt: { min: 14, max: 18 },
    notePtMin: 12,
    lineHeight: { min: 1.2, max: 1.3 },
  },
  /** 総スライド数 = 表紙1 + 要約1 + sections + 締め1 の許容範囲。 */
  slideCount: { min: 6, max: 12 },
  bullets: {
    maxPerSection: 4,
    /** lead + detail の合計文字数（コードポイント単位）の上限。 */
    maxChars: 60,
  },
} as const;
