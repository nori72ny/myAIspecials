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
  creativeSpecRequired: boolean;
}

interface OriginAnswerQualityPolicyInput {
  intent: OriginRequestIntent;
  taskType: AITaskType;
  independentReviewRequired: boolean;
}

const RESEARCH_TASKS = new Set<AITaskType>(["research", "current-information"]);
const CREATIVE_ARTIFACT_OUTPUTS = new Set(["application", "website", "presentation", "dashboard"]);
const CREATIVE_ARTIFACT_CAPABILITIES = new Set([
  "application-development",
  "website-development",
  "presentation-creation",
  "design",
]);

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
  const creativeSpecRequired = input.intent.interactionMode === "deliverable"
    && (
      input.intent.requestedOutputs.some((output) => CREATIVE_ARTIFACT_OUTPUTS.has(output))
      || input.intent.requiredCapabilities.some((capability) => CREATIVE_ARTIFACT_CAPABILITIES.has(capability))
    );

  return { answerMode, verificationLevel, creativeSpecRequired };
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
  const creativeSpecInstruction = policy.creativeSpecRequired
    ? [
      "Creative / Vibe Spec preflight (internal only):",
      "- Before writing an HTML, SVG, slide, dashboard, or application code block, silently define: (1) purpose and target user, (2) visual hierarchy and layout, and (3) an OKLCH color palette with a clear typography hierarchy.",
      "- Use that lightweight spec to make concrete composition choices: primary task first, a responsive grid, meaningful empty and error states, accessible controls, and restrained micro-interactions. Do not output the spec or claim that a design review occurred.",
      "- Then return one complete, runnable deliverable in the requested fenced code format. Preserve requested functionality; do not substitute an image or an incomplete mockup for a working artifact.",
    ]
    : [];

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
    ...creativeSpecInstruction,
  ].join("\n");
}
