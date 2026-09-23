import type {
  OriginAnswerExperienceAxisV2,
  OriginAnswerExperienceScoreV2,
} from "./OriginAnswerExperienceV2.js";

export interface OriginAnswerExperienceRubricBandV2 {
  readonly score: OriginAnswerExperienceScoreV2;
  readonly label: string;
  readonly definition: string;
}

export interface OriginAnswerExperienceRubricAxisV2 {
  readonly axis: OriginAnswerExperienceAxisV2;
  readonly question: string;
  readonly bands: readonly OriginAnswerExperienceRubricBandV2[];
}

function bands(
  zero: string,
  one: string,
  two: string,
  three: string,
  four: string,
): readonly OriginAnswerExperienceRubricBandV2[] {
  return Object.freeze([
    Object.freeze({ score: 0 as const, label: "unacceptable", definition: zero }),
    Object.freeze({ score: 1 as const, label: "weak", definition: one }),
    Object.freeze({ score: 2 as const, label: "adequate", definition: two }),
    Object.freeze({ score: 3 as const, label: "strong", definition: three }),
    Object.freeze({ score: 4 as const, label: "excellent", definition: four }),
  ]);
}

export const ORIGIN_AQ_V2_RUBRIC: Readonly<Record<OriginAnswerExperienceAxisV2, OriginAnswerExperienceRubricAxisV2>> = Object.freeze({
  truth: Object.freeze({
    axis: "truth",
    question: "Are material factual, quantitative, technical and verification claims accurate and appropriately qualified?",
    bands: bands(
      "Contains a material falsehood, fabricated evidence or false verification claim.",
      "Multiple unsupported or materially misleading claims remain.",
      "Mostly correct but contains notable imprecision, weak qualification or an avoidable factual gap.",
      "Material claims are correct and limitations are clearly separated.",
      "Material claims are correct, well-qualified, internally consistent and evidence boundaries are explicit.",
    ),
  }),
  intentFit: Object.freeze({
    axis: "intentFit",
    question: "Does the answer solve the user's actual request rather than a nearby or generic task?",
    bands: bands(
      "Misses the requested task or answers a different question.",
      "Addresses only a small part of the intent or imposes an unsuitable interpretation.",
      "Answers the core task but misses important intent signals or constraints.",
      "Matches the stated and implied intent with only minor misses.",
      "Precisely matches the real intent, constraints and desired outcome without unnecessary detours.",
    ),
  }),
  completeness: Object.freeze({
    axis: "completeness",
    question: "Does the answer cover every material part of the request at the right depth?",
    bands: bands(
      "Major requested components are absent.",
      "Several important components are missing.",
      "Core request is covered but one or more material pieces are incomplete.",
      "All material requirements are covered with minor omissions only.",
      "All material requirements are covered, prioritized and closed with no meaningful gap.",
    ),
  }),
  structure: Object.freeze({
    axis: "structure",
    question: "Is the information ordered so the user can understand the answer with minimal backtracking?",
    bands: bands(
      "Disorganized or contradictory ordering makes the answer hard to follow.",
      "Weak hierarchy; important points are buried or repeated.",
      "Understandable structure but sequencing or hierarchy could be improved.",
      "Clear hierarchy and logical progression with limited redundancy.",
      "The answer reveals the right information in the right order; hierarchy, grouping and transitions are exceptionally clear.",
    ),
  }),
  clarity: Object.freeze({
    axis: "clarity",
    question: "Can a competent reader understand the answer correctly on the first read?",
    bands: bands(
      "Ambiguous, confusing or misleading wording prevents reliable understanding.",
      "Frequent jargon, vague references or overloaded sentences impede understanding.",
      "Generally understandable but requires rereading in places.",
      "Clear and direct with only minor friction.",
      "Immediately understandable, precise and natural; difficult ideas are made simple without losing accuracy.",
    ),
  }),
  informationDensity: Object.freeze({
    axis: "informationDensity",
    question: "Does every section earn its space while preserving enough context to act correctly?",
    bands: bands(
      "Severely bloated or so terse that essential context is missing.",
      "Large amounts of low-value repetition or major overcompression.",
      "Reasonable length but still noticeably verbose or thin.",
      "High signal-to-noise with small opportunities to tighten.",
      "Near-optimal density: concise where possible, detailed where necessary, with virtually no disposable content.",
    ),
  }),
  actionability: Object.freeze({
    axis: "actionability",
    question: "Can the user take the next correct action from the answer without reconstructing missing steps?",
    bands: bands(
      "No usable next action or materially unsafe guidance.",
      "Action is vague, incomplete or missing key prerequisites.",
      "Action is possible but requires interpretation or missing detail.",
      "Clear next steps with sensible ordering and conditions.",
      "The answer converts understanding into an immediately executable plan, including checks, stopping conditions and ownership where relevant.",
    ),
  }),
  visualReadability: Object.freeze({
    axis: "visualReadability",
    question: "Is the rendered answer easy to scan and read on both 390px mobile and 1440px desktop?",
    bands: bands(
      "Critical clipping, overflow, unreadable density or broken hierarchy.",
      "Serious scanning problems, long walls of text or poorly adapted tables/code.",
      "Readable but with noticeable density, spacing, hierarchy or mobile issues.",
      "Comfortable reading and scanning on both target viewports with minor issues.",
      "Excellent visual hierarchy, rhythm and adaptation across viewports; long answers remain navigable and calm.",
    ),
  }),
  taskFit: Object.freeze({
    axis: "taskFit",
    question: "Did the answer choose the right form for the task—direct answer, comparison, procedure, report, code, table or artifact?",
    bands: bands(
      "Format actively obstructs the task.",
      "Poor format choice creates unnecessary work for the user.",
      "Usable format but not the most effective one.",
      "Format is well matched to the task with minor opportunities.",
      "The response form is exactly suited to the task and minimizes user effort.",
    ),
  }),
  evidenceUsability: Object.freeze({
    axis: "evidenceUsability",
    question: "When evidence is required, can the user easily see what supports what and what remains unverified?",
    bands: bands(
      "Fabricated, misleading or unusable evidence.",
      "Evidence is materially incomplete, detached from claims or poorly qualified.",
      "Evidence exists but mapping, authority, freshness or limitations are not consistently clear.",
      "Relevant evidence is easy to inspect and most claims are well mapped.",
      "Evidence is authoritative where possible, directly mapped, fresh enough for the claim, and uncertainty is immediately legible.",
    ),
  }),
});

export function assertOriginAnswerExperienceRubricV2(): void {
  const expected: OriginAnswerExperienceAxisV2[] = [
    "truth",
    "intentFit",
    "completeness",
    "structure",
    "clarity",
    "informationDensity",
    "actionability",
    "visualReadability",
    "taskFit",
    "evidenceUsability",
  ];
  for (const axis of expected) {
    const item = ORIGIN_AQ_V2_RUBRIC[axis];
    if (!item || item.axis !== axis || item.bands.length !== 5) throw new Error("AQ_V2_RUBRIC_INVALID");
    const scores = item.bands.map(band => band.score);
    if (JSON.stringify(scores) !== JSON.stringify([0, 1, 2, 3, 4])) throw new Error("AQ_V2_RUBRIC_INVALID");
  }
}
