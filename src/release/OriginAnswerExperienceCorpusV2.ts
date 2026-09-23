import type {
  OriginAnswerExperienceLocaleV2,
  OriginAnswerExperienceModeV2,
  OriginAnswerExperienceSurfaceV2,
} from "./OriginAnswerExperienceGateV2.js";

export type OriginAnswerExperienceFamilyV2 =
  | "direct-factual"
  | "explanation-teaching"
  | "summarization-rewrite"
  | "decision-support"
  | "research-synthesis"
  | "coding-help"
  | "artifact-planning"
  | "data-analysis";

export interface OriginAnswerExperienceCaseV2 {
  readonly id: string;
  readonly family: OriginAnswerExperienceFamilyV2;
  readonly surface: OriginAnswerExperienceSurfaceV2;
  readonly locale: OriginAnswerExperienceLocaleV2;
  readonly mode: OriginAnswerExperienceModeV2;
  readonly prompt: string;
  readonly expectedLength: "short" | "medium" | "long";
  readonly renderViewports: readonly (390 | 768 | 1440)[];
}

function c(
  id: string,
  family: OriginAnswerExperienceFamilyV2,
  surface: OriginAnswerExperienceSurfaceV2,
  locale: OriginAnswerExperienceLocaleV2,
  mode: OriginAnswerExperienceModeV2,
  prompt: string,
  expectedLength: OriginAnswerExperienceCaseV2["expectedLength"],
): OriginAnswerExperienceCaseV2 {
  return Object.freeze({
    id,
    family,
    surface,
    locale,
    mode,
    prompt,
    expectedLength,
    renderViewports: Object.freeze([390, 768, 1440] as const),
  });
}

export const ORIGIN_ANSWER_EXPERIENCE_CASES_V2 = Object.freeze([
  c("ae-direct-ja-1", "direct-factual", "chat", "ja", "direct", "次の情報だけを使って、要点を2文以内で答えてください。『月額9,800円、最低利用6か月、解約30日前通知』。最低利用期間と解約条件は？", "short"),
  c("ae-direct-en-2", "direct-factual", "chat", "en", "direct", "Answer in two sentences or fewer: the plan costs $49/month and includes 5 seats. What is the monthly price and included seat count?", "short"),
  c("ae-direct-ja-3", "direct-factual", "chat", "ja", "direct", "257÷1,923を計算し、小数1位の百分率だけでなく計算式も短く示してください。", "short"),

  c("ae-explain-ja-1", "explanation-teaching", "chat", "ja", "direct", "APIとSDKの違いを、非エンジニアにも分かるように例を1つ使って説明してください。長すぎる説明は避けてください。", "medium"),
  c("ae-explain-en-2", "explanation-teaching", "chat", "en", "direct", "Explain eventual consistency to a product manager using one concrete example, one trade-off, and no unnecessary jargon.", "medium"),
  c("ae-explain-ja-3", "explanation-teaching", "research", "ja", "research", "一次情報と二次情報の違いを、調査レポートでどう使い分けるかという観点から説明してください。", "medium"),

  c("ae-summary-ja-1", "summarization-rewrite", "chat", "ja", "direct", "次を、重要情報を落とさず100字以内に要約してください。『新サービスは10月開始予定。対象は既存会員。料金は来週確定。初月無料。解約は30日前通知。』", "short"),
  c("ae-summary-en-2", "summarization-rewrite", "chat", "en", "direct", "Rewrite this as a concise manager update: 'The migration is 80% complete. Two blockers remain: SSO testing and data backfill. No customer impact so far. Target is Friday.'", "short"),
  c("ae-summary-ja-3", "summarization-rewrite", "artifact", "ja", "deliverable", "長い会議メモを役員向け1ページにまとめる場合の、最も読みやすい見出し構成と情報順序を作ってください。", "medium"),

  c("ae-decision-ja-1", "decision-support", "chat", "ja", "decision", "新機能を一斉公開するか段階公開するか迷っています。判断基準、推奨、撤退条件を簡潔に整理してください。", "medium"),
  c("ae-decision-en-2", "decision-support", "chat", "en", "decision", "With one engineer for two weeks, choose between onboarding improvements and CSV export. State assumptions, decision criteria, recommendation, and a reversible next step.", "medium"),
  c("ae-decision-ja-3", "decision-support", "research", "ja", "research", "複数サービスを比較して1つ選ぶ調査回答で、結論・比較表・根拠・不確実性をどの順に提示すると意思決定しやすいか示してください。", "medium"),

  c("ae-research-ja-1", "research-synthesis", "research", "ja", "research", "公式情報AとBが矛盾している状況を想定し、最新性・一次性・適用範囲をどう整理して結論を書くべきか、短い例付きで示してください。", "long"),
  c("ae-research-en-2", "research-synthesis", "research", "en", "research", "Describe the ideal structure for a sourced comparison of three cloud services: conclusion, comparison, evidence, conflicts, limitations, and next action.", "long"),
  c("ae-research-ja-3", "research-synthesis", "research", "ja", "research", "長い調査結果をスマホでも読みやすくするため、本文・表・出典・未確認事項をどう分けるべきか提案してください。", "medium"),

  c("ae-code-ja-1", "coding-help", "coding", "ja", "deliverable", "TypeScriptの型エラーを直す回答で、原因、最小修正、再検証、未実行事項をどう短く提示すべきか、例を示してください。", "medium"),
  c("ae-code-en-2", "coding-help", "coding", "en", "deliverable", "Provide a compact bug-fix answer for a failing unit test. Include root cause, minimal diff strategy, exact rerun checks, and do not claim tests ran.", "medium"),
  c("ae-code-ja-3", "coding-help", "coding", "ja", "deliverable", "複数ファイル変更のコード回答で、変更点一覧が長くなりすぎず、重要な差分と検証結果が一目で分かる構成を作ってください。", "medium"),

  c("ae-artifact-ja-1", "artifact-planning", "artifact", "ja", "deliverable", "5枚の提案スライドを、課題→根拠→提案→実行→意思決定の順で設計し、各スライドの1メッセージを示してください。", "medium"),
  c("ae-artifact-en-2", "artifact-planning", "artifact", "en", "deliverable", "Design a one-page project status report that makes scope, progress, risks, decisions, and next steps scannable in under one minute.", "medium"),
  c("ae-artifact-ja-3", "artifact-planning", "artifact", "ja", "deliverable", "予算比較の表計算成果物を作る前提で、利用者が迷わないシート構成、主要列、入力セルと計算セルの区別を説明してください。", "medium"),

  c("ae-data-ja-1", "data-analysis", "artifact", "ja", "decision", "4人の営業担当のKPIを見るとき、結論、異常値、原因仮説、次アクションをどの順に示すと最も分かりやすいか、簡潔な例を作ってください。", "medium"),
  c("ae-data-en-2", "data-analysis", "artifact", "en", "decision", "A dashboard shows conversion down 12% while traffic is flat. Explain how to present the finding, uncertainty, diagnostic cuts, and next action without overstating causality.", "medium"),
  c("ae-data-ja-3", "data-analysis", "artifact", "ja", "decision", "Actual 120、Budget 100のとき、VarianceとVariance%を示し、数字だけでなく意思決定に必要な一言も付けてください。", "short"),
] as const satisfies readonly OriginAnswerExperienceCaseV2[];

export function validateOriginAnswerExperienceCorpusV2(): boolean {
  const cases = ORIGIN_ANSWER_EXPERIENCE_CASES_V2;
  if (cases.length !== 24) return false;
  if (new Set(cases.map((item) => item.id)).size !== cases.length) return false;

  const families = new Set(cases.map((item) => item.family));
  if (families.size !== 8) return false;

  const surfaces: OriginAnswerExperienceSurfaceV2[] = ["chat", "research", "coding", "artifact"];
  if (!surfaces.every((surface) => cases.filter((item) => item.surface === surface).length >= 3)) {
    return false;
  }

  if (cases.filter((item) => item.locale === "en").length < 4) return false;
  if (!cases.every((item) =>
    item.renderViewports.length === 3
    && item.renderViewports[0] === 390
    && item.renderViewports[1] === 768
    && item.renderViewports[2] === 1440
  )) return false;

  return true;
}
