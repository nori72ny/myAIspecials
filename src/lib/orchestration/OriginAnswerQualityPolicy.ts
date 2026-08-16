import type { AITaskType } from "./MultiAIOrchestrator.js";
import type { OriginRequestIntent } from "./OriginRequestIntent.js";

export type OriginAnswerMode = "direct" | "decision" | "deliverable" | "research";

export type OriginVerificationLevel =
  | "basic"
  | "evidence-required"
  | "independent-review-required";

export interface OriginAnswerQualityPolicy {
  answerMode: OriginAnswerMode;
  verificationLevel: OriginVerificationLevel;
}

interface OriginAnswerQualityPolicyInput {
  intent: OriginRequestIntent;
  taskType: AITaskType;
  independentReviewRequired: boolean;
}

const RESEARCH_TASKS = new Set<AITaskType>(["research", "current-information"]);

export function resolveOriginAnswerQualityPolicy(
  input: OriginAnswerQualityPolicyInput,
): OriginAnswerQualityPolicy {
  const researchRequired = RESEARCH_TASKS.has(input.taskType)
    || input.intent.requiredCapabilities.includes("research");
  const decisionRequested = input.intent.requestedOutputs.includes("comparison")
    || input.intent.suggestedOutputs.includes("comparison");

  const answerMode: OriginAnswerMode = input.intent.interactionMode === "deliverable"
    ? "deliverable"
    : researchRequired
      ? "research"
      : decisionRequested
        ? "decision"
        : "direct";

  const verificationLevel: OriginVerificationLevel = input.independentReviewRequired
    ? "independent-review-required"
    : researchRequired
      ? "evidence-required"
      : "basic";

  return { answerMode, verificationLevel };
}

export function originAnswerQualityInstruction(
  policy: OriginAnswerQualityPolicy,
): string {
  const modeInstruction: Record<OriginAnswerMode, string> = {
    direct: "Give the direct answer first. Add only the explanation needed to use it.",
    decision: "Present a decision object: recommendation first, up to three decisive reasons, meaningful trade-offs or risks, uncertainty, and the next action. Do not repeat the conclusion at the end.",
    deliverable: "Return the requested deliverable first. Do not surround it with generic analysis unless the user asked for analysis.",
    research: "Separate confirmed facts, user-provided material, inference, and unverified points. Bind each time-sensitive factual claim to a directly supporting source when one was actually checked.",
  };

  const verificationInstruction: Record<OriginVerificationLevel, string> = {
    basic: "Run an internal goal-fit, consistency, and completeness check. Do not describe this self-check as independent verification.",
    "evidence-required": "Evidence is required for factual research claims. If evidence was not retrieved and checked, label the claim or limitation as unverified instead of filling the gap.",
    "independent-review-required": "An independent review is required by policy. If the execution record does not prove it ran, state that it was not performed and avoid a high-confidence recommendation.",
  };

  return [
    "Answer quality policy:",
    `- Response mode: ${policy.answerMode}. ${modeInstruction[policy.answerMode]}`,
    `- Verification level: ${policy.verificationLevel}. ${verificationInstruction[policy.verificationLevel]}`,
    "- Silently evaluate correctness, relevance, completeness, freshness, evidence, calibration, actionability, and clarity before sending.",
    "- Calibrate depth to the question, not merely to its length. A short question can require a broad, concrete answer; do not mistake brevity for a request for minimal coverage.",
    "- For representative-example questions (such as famous local foods, products, places, people, or options), cover the major categories before adding advice. When the subject naturally supports it, give roughly 6-10 useful examples, identify the especially notable ones, and attach at least one distinguishing detail to each.",
    "- Prefer named varieties, locations, seasons, uses, or other domain-specific details over generic descriptions. Include rankings or quantities only when they are known and appropriately qualified.",
    "- Do not let generic selection tips, cautions, background, or a closing offer displace concrete information that directly answers the question. Omit those sections unless they materially improve the user's decision or safety.",
    "- Never display invented confidence percentages, fake precision, or claims such as perfect, guaranteed, or world-best without measurable evidence.",
    "- Prefer fewer, stronger sections. Every heading must help the user decide, understand, or act.",
    "- End with a complete sentence or complete deliverable. Never leave a teaser, unfinished offer, or fragment.",
  ].join("\n");
}
