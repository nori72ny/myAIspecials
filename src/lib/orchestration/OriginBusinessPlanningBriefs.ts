import type { OriginBusinessPlanningKind } from "./OriginBusinessPlanning.js";

// Fixed briefs for the chat-side planning/marketing capability.
//
// Purpose (BUSINESS_CAPABILITY_PROGRAM_2026-11-13.md §5/§6, adapted to chat
// answers by the 2026-11-16 fast-track instruction): a fixed, practical
// request set whose answers can be scored on the applicable axes so that
// "sharp" is measured, not asserted. The briefs use only fictional sample
// data (no real or personal data), matching the canon's audit rule.
//
// Scoring procedure (carried out by the 統括 on the production path; the
// unit tests in OriginBusinessPlanning.test.ts pin detection, figure
// parsing, and the deterministic backcast for these same briefs):
//  1. Send each brief verbatim as a chat message on the production path.
//  2. Score the answer on the brief's applicableAxes. Pass = every
//     applicable axis >= 9.0 (canon §5), judged independently by two
//     scorers; a gap of 2+ points is re-judged with reasons.
//  3. Hard checks regardless of axis scores (any failure = not complete):
//     - every mustInclude part of the playbook is present;
//     - fabricatedNumbers: no market/factual figure stated as fact without
//       a source; no rate or price presented as real when it was assumed;
//     - assumptionLabelling: every assumed figure carries 「仮置き（仮定）」
//       at the point of use;
//     - arithmetic: the backcast figures equal the deterministic
//       computation for the brief's supplied figures (difference zero);
//     - gapHonesty: if the plan cannot reach the goal, it says so instead
//       of inflating a rate.
//  4. Record per-brief scores and failures; a brief that fails is improved
//     by strengthening the playbook/checks, never by relaxing the bar.

export interface OriginBusinessPlanningBrief {
  id: string;
  title: string;
  prompt: string;
  expectedKind: OriginBusinessPlanningKind;
  /** Canon axis numbers (§5.1 axes 1-14, §5.2 candidate axes 15-18). */
  applicableAxes: readonly number[];
  /** Playbook parts (Japanese headings/fragments) the answer must contain. */
  mustInclude: readonly string[];
  /** True when the brief supplies figures that pin a deterministic backcast. */
  hasDeterministicBackcast: boolean;
}

export const ORIGIN_BUSINESS_PLANNING_BRIEFS: readonly OriginBusinessPlanningBrief[] = [
  {
    id: "BP-1",
    title: "ウェビナーキャンペーン計画（数値目標あり）",
    prompt: "来月から3ヶ月で、BtoB向けウェビナーキャンペーンの計画を立てて。目標は受注10件、平均単価80万円です。",
    expectedKind: "campaign-plan",
    applicableAxes: [1, 10, 12, 16, 17, 18],
    mustInclude: ["目的とゴール", "対象", "提供価値", "施策とチャネル", "数値の逆算", "KPIと計測方法", "リスクと代替案", "次の一手", "仮置き"],
    hasDeterministicBackcast: true,
  },
  {
    id: "BP-2",
    title: "新規事業の企画書の骨子",
    prompt: "社内向けに、新規事業（中小企業向けの請求書自動化SaaS）の企画書の骨子を作って。決裁者は経営会議です。",
    expectedKind: "proposal-outline",
    applicableAxes: [1, 3, 10, 15, 17],
    mustInclude: ["目的とゴール", "対象", "提供価値", "リスクと代替案", "次の一手"],
    hasDeterministicBackcast: false,
  },
  {
    id: "BP-3",
    title: "市場・競合分析とポジショニング",
    prompt: "学習塾向け予約システム市場への参入を検討しています。市場と競合を分析して、ポジショニングの案をください。",
    expectedKind: "market-competition",
    applicableAxes: [1, 10, 12, 18],
    mustInclude: ["目的とゴール", "対象", "提供価値", "市場・競合の見立て", "リスクと代替案", "次の一手"],
    hasDeterministicBackcast: false,
  },
  {
    id: "BP-4",
    title: "サブスクのファネル設計",
    prompt: "月額制サブスクリプションサービスのファネルを設計して。無料トライアルから有料転換までの段階定義とKPIを決めたい。",
    expectedKind: "funnel-design",
    applicableAxes: [1, 10, 12, 16, 18],
    mustInclude: ["目的とゴール", "対象", "施策とチャネル", "KPIと計測方法", "リスクと代替案", "次の一手", "仮置き"],
    hasDeterministicBackcast: false,
  },
  {
    id: "BP-5",
    title: "カフェチェーンの販促案（予算制約あり）",
    prompt: "地方の小規模カフェチェーン（5店舗）の平日昼の集客を増やす販促案を考えて。予算は月10万円まで。",
    expectedKind: "promotion-ideas",
    applicableAxes: [1, 10, 16, 17, 18],
    mustInclude: ["目的とゴール", "対象", "提供価値", "施策とチャネル", "KPIと計測方法", "リスクと代替案", "次の一手"],
    hasDeterministicBackcast: false,
  },
  {
    id: "BP-6",
    title: "新製品ローンチのマーケティング仕様書",
    prompt: "新製品ローンチのマーケティング仕様書を作って。目的、ターゲット、ファネル、KPI、計測方法まで含めてください。",
    expectedKind: "marketing-spec",
    applicableAxes: [1, 10, 12, 16, 17, 18],
    mustInclude: ["目的とゴール", "対象", "提供価値", "施策とチャネル", "数値の逆算", "KPIと計測方法", "リスクと代替案", "次の一手", "仮置き"],
    hasDeterministicBackcast: false,
  },
  {
    id: "BP-7",
    title: "売上目標からの逆算と達成計画（数値が閉じる）",
    prompt: "今年度の売上目標は6,000万円、平均単価は50万円、成約率は20%です。必要な商談数とリード数を逆算して、達成計画を立てて。",
    expectedKind: "campaign-plan",
    applicableAxes: [1, 10, 11, 12, 16, 17, 18],
    mustInclude: ["目的とゴール", "対象", "施策とチャネル", "数値の逆算", "KPIと計測方法", "リスクと代替案", "次の一手", "仮置き"],
    hasDeterministicBackcast: true,
  },
];
