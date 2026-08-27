import type { AITaskType } from "./MultiAIOrchestrator.js";
import type { OriginRequestIntent } from "./OriginRequestIntent.js";

export type OriginAnswerMode = "direct" | "decision" | "deliverable" | "research";
export type OriginVerificationLevel = "basic" | "evidence-required" | "independent-review-required";

export interface OriginAnswerQualityPolicy {
  answerMode: OriginAnswerMode;
  verificationLevel: OriginVerificationLevel;
  creativeSpecRequired: boolean;
  executiveReasoningRequired: boolean;
}

interface OriginAnswerQualityPolicyInput {
  intent: OriginRequestIntent;
  taskType: AITaskType;
  independentReviewRequired: boolean;
}

const RESEARCH_TASKS = new Set<AITaskType>(["research", "current-information"]);
const EXECUTIVE_TASKS = new Set<AITaskType>(["research", "current-information", "architecture", "operations", "security"]);
const CREATIVE_ARTIFACT_OUTPUTS = new Set(["application", "website", "presentation", "dashboard"]);
const CREATIVE_ARTIFACT_CAPABILITIES = new Set(["application-development", "website-development", "presentation-creation", "design"]);

export function resolveOriginAnswerQualityPolicy(input: OriginAnswerQualityPolicyInput): OriginAnswerQualityPolicy {
  const researchRequired = RESEARCH_TASKS.has(input.taskType) || input.intent.requiredCapabilities.includes("research");
  const decisionRequested = input.intent.requestedOutputs.includes("comparison") || input.intent.suggestedOutputs.includes("comparison");
  const executiveReasoningRequired = EXECUTIVE_TASKS.has(input.taskType) || decisionRequested;
  const answerMode: OriginAnswerMode = input.intent.interactionMode === "deliverable" ? "deliverable" : researchRequired ? "research" : decisionRequested ? "decision" : "direct";
  const verificationLevel: OriginVerificationLevel = input.independentReviewRequired ? "independent-review-required" : researchRequired ? "evidence-required" : "basic";
  const creativeSpecRequired = input.intent.interactionMode === "deliverable" && (input.intent.requestedOutputs.some((output) => CREATIVE_ARTIFACT_OUTPUTS.has(output)) || input.intent.requiredCapabilities.some((capability) => CREATIVE_ARTIFACT_CAPABILITIES.has(capability)));
  return { answerMode, verificationLevel, creativeSpecRequired, executiveReasoningRequired };
}

export function originAnswerQualityInstruction(policy: OriginAnswerQualityPolicy): string {
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
  const executiveInstruction = policy.executiveReasoningRequired ? [
    "Executive Reasoning Protocol v5.0:",
    "- Direct Executive Framing: put the conclusion or recommended course in the first sentence; immediately prioritize the most important risks/concerns and next action.",
    "- Intent Extraction: identify the user's underlying objective from the request and surface it explicitly as 【意図の汲み取り】 when answering a consequential decision or planning request. Do not invent motives that are unsupported by the request.",
    "- Mandatory executive response order for consequential decisions: 【意図の汲み取り】 → 【結論】 → 【今すぐやるべきこと】 → 【将来的に見据えること】 → 【この判断に至った理由】. These headings are mandatory when the task is a consequential decision or plan, not merely when executive reasoning is available.",
    "- 【結論】 must be the first substantive sentence of the response. Do not place greetings or generic preambles before it.",
    "- 【意図の汲み取り】 should translate the literal request into the decision objective in one concise sentence; if the user's objective is ambiguous, state the uncertainty rather than fabricating it.",
    "- Counter-Hypothesis: for every consequential recommendation, consider at least one credible opposing hypothesis and state the conditions under which it could be true. Do not present a strawman objection.",
    "- Decision-Changing Conditions: state the smallest set of measurable conditions, KPI thresholds, evidence, or events that would justify changing, pausing, or reversing the recommendation. Never invent thresholds; if none are known, label them as proposed decision gates.",
    "- Epistemic Confidence: use only High / Medium / Low. Give the principal reason. Never output confidence percentages or fake precision.",
    "- Claim-level calibration: where material, distinguish each major claim as verified fact, user-provided fact, inference, recommendation, or unknown and attach High / Medium / Low confidence when useful.",
    "- Information Needed: identify only the minimum additional facts or searches that would materially improve the decision. Do not ask questions merely for completeness.",
    "- Risk prioritization: rank risks by decision impact, likelihood, reversibility, and detectability when those dimensions can be assessed without invented numbers.",
    "- Separate what is true, what is likely, and what should be done. Never silently turn an assumption into a fact.",
    "- For consequential decisions, include Recommendation, Top Risks, Counter-Hypothesis, Decision-Changing Conditions, and Information Needed when each is materially useful.",
  ] : [];
  const creativeSpecInstruction = policy.creativeSpecRequired ? [
    "Creative / Vibe Spec preflight (internal only):",
    "- Before writing an HTML, SVG, slide, dashboard, or application code block, silently define: (1) purpose and target user, (2) visual hierarchy and layout, and (3) an OKLCH color palette with a clear typography hierarchy.",
    "- Use that lightweight spec to make concrete composition choices: primary task first, a responsive grid, meaningful empty and error states, accessible controls, and restrained micro-interactions. Do not output the spec or claim that a design review occurred.",
    "- Then return one complete, runnable deliverable in the requested fenced code format. Preserve requested functionality; do not substitute an image or an incomplete mockup for a working artifact.",
  ] : [];
  return [
    "Answer quality policy:",
    `- Response mode: ${policy.answerMode}. ${modeInstruction[policy.answerMode]}`,
    `- Verification level: ${policy.verificationLevel}. ${verificationInstruction[policy.verificationLevel]}`,
    `- Executive reasoning: ${policy.executiveReasoningRequired ? "required for consequential decisions" : "apply only when decision stakes warrant it"}.`,
    "- Silently evaluate correctness, relevance, completeness, freshness, evidence, calibration, actionability, and clarity before sending.",
    "- Calibrate depth to the question, not merely to its length. A short question can require a broad, concrete answer; do not mistake brevity for a request for minimal coverage.",
    "- For representative-example questions, cover the major categories before adding advice. When the subject naturally supports it, give roughly 6-10 useful examples, identify especially notable ones, and attach at least one distinguishing detail to each.",
    "- Prefer named varieties, locations, seasons, uses, or other domain-specific details over generic descriptions. Include rankings or quantities only when they are known and appropriately qualified.",
    "- Do not let generic selection tips, cautions, background, or a closing offer displace concrete information that directly answers the question. Omit those sections unless they materially improve the user's decision or safety.",
    "- Never display invented confidence percentages, fake precision, or claims such as perfect, guaranteed, or world-best without measurable evidence.",
    "- Prefer fewer, stronger sections. Every heading must help the user decide, understand, or act.",
    "- End with a complete sentence or complete deliverable. Never leave a teaser, unfinished offer, or fragment.",
    ...executiveInstruction,
    ...creativeSpecInstruction,
  ].join("\n");
}
