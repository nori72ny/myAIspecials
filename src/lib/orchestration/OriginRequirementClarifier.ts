import type { OriginRequestIntent } from "./OriginRequestIntent.js";

export type OriginRequirementDimension =
  | "objective"
  | "audience"
  | "usage-context"
  | "success-criteria"
  | "source-material"
  | "structure-depth"
  | "tone-design"
  | "deadline-budget"
  | "data-fields"
  | "calculation-aggregation"
  | "storage-sharing"
  | "import-export"
  | "user-workflows"
  | "platform-device"
  | "permissions-integrations"
  | "brand-assets"
  | "scope-criteria"
  | "freshness-sources"
  | "target-runtime"
  | "expected-behavior"
  | "verification";

const COMMON_CUSTOM_DIMENSIONS: readonly OriginRequirementDimension[] = [
  "objective",
  "audience",
  "usage-context",
  "success-criteria",
];

const OUTPUT_DIMENSIONS: Readonly<Record<string, readonly OriginRequirementDimension[]>> = {
  spreadsheet: ["data-fields", "calculation-aggregation", "storage-sharing", "import-export"],
  application: ["user-workflows", "platform-device", "storage-sharing", "permissions-integrations", "tone-design"],
  website: ["audience", "usage-context", "user-workflows", "platform-device", "tone-design", "brand-assets"],
  dashboard: ["audience", "data-fields", "calculation-aggregation", "user-workflows", "platform-device"],
  presentation: ["audience", "source-material", "structure-depth", "tone-design", "deadline-budget"],
  proposal: ["audience", "usage-context", "source-material", "structure-depth", "tone-design"],
  document: ["audience", "source-material", "structure-depth", "tone-design"],
  "talk-script": ["audience", "usage-context", "tone-design"],
  image: ["audience", "usage-context", "tone-design", "brand-assets", "platform-device"],
  "social-post": ["audience", "usage-context", "tone-design", "brand-assets"],
  "research-result": ["scope-criteria", "freshness-sources", "source-material", "success-criteria"],
  comparison: ["scope-criteria", "success-criteria", "source-material"],
  chart: ["data-fields", "calculation-aggregation", "usage-context"],
};

const CAPABILITY_DIMENSIONS: Readonly<Record<string, readonly OriginRequirementDimension[]>> = {
  "application-development": ["target-runtime", "expected-behavior", "verification"],
  "website-development": ["platform-device", "expected-behavior", "verification"],
  "data-analysis": ["data-fields", "scope-criteria", "success-criteria", "verification"],
  research: ["scope-criteria", "freshness-sources", "success-criteria"],
  design: ["audience", "usage-context", "tone-design", "brand-assets"],
  writing: ["audience", "usage-context", "tone-design", "structure-depth"],
  security: ["target-runtime", "permissions-integrations", "verification"],
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function requirementDimensionsForIntent(intent: OriginRequestIntent): OriginRequirementDimension[] {
  if (
    intent.interactionMode === "conversation"
    && intent.requiredCapabilities.length === 0
    && intent.requestedOutputs.length === 0
  ) return [];

  const dimensions: OriginRequirementDimension[] = [...COMMON_CUSTOM_DIMENSIONS];

  for (const output of [...intent.requestedOutputs, ...intent.suggestedOutputs]) {
    dimensions.push(...(OUTPUT_DIMENSIONS[output] ?? []));
  }
  for (const capability of intent.requiredCapabilities) {
    dimensions.push(...(CAPABILITY_DIMENSIONS[capability] ?? []));
  }

  if (intent.interactionMode === "agent-workflow") {
    dimensions.push("deadline-budget", "permissions-integrations", "verification");
  }

  return unique(dimensions);
}

export function originRequirementClarificationInstruction(intent: OriginRequestIntent): string {
  const dimensions = requirementDimensionsForIntent(intent);
  if (dimensions.length === 0) {
    return [
      "Requirement clarification mode:",
      "- This request does not currently require a formal requirement-discovery loop.",
      "- Answer directly unless a genuinely material ambiguity emerges.",
    ].join("\n");
  }

  return [
    "Requirement clarification mode (adaptive; planning guidance only):",
    `- High-impact dimensions to consider for this request: ${dimensions.join(", ")}`,
    "- These dimensions are prompts for judgment, not a mandatory questionnaire. Ask only about unknowns that would materially change the result.",
    "- Inspect the full provided conversation before asking. Treat prior user answers, supplied files/data, and explicit constraints as already-known requirements.",
    "- Ask one to three focused questions per turn, ordered by impact. Prefer concrete choices or examples when that reduces user effort.",
    "- Never ask the same requirement twice after the user has answered it. Carry accepted requirements forward into later turns and into the final deliverable.",
    "- If the user says to leave a detail to ORIGIN, choose a sensible low-risk default and do not ask again unless a new conflict appears.",
    "- Continue the clarification loop only while material uncertainty remains; once the request is sufficiently specified, stop questioning and execute.",
    "- After a draft is delivered, treat user feedback as requirement updates and preserve accepted parts unless the user asks to replace them.",
  ].join("\n");
}
