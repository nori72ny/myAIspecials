import type { OriginRequestIntent } from "./OriginRequestIntent";

export type OriginWorkStepKind =
  | "understand-goal"
  | "gather-information"
  | "design-output"
  | "create-output"
  | "verify-output"
  | "deliver-result";

export type OriginWorkStepAvailability =
  | "available"
  | "partial"
  | "unavailable";

export interface OriginAgentWorkStep {
  id: string;
  kind: OriginWorkStepKind;
  requiredCapability: string;
  availability: OriginWorkStepAvailability;
  reason: string;
}

export interface OriginAgentWorkPlan {
  mode: OriginRequestIntent["interactionMode"];
  steps: readonly OriginAgentWorkStep[];
  canCompleteInCurrentRelease: boolean;
  incompleteCapabilities: readonly string[];
}

const INLINE_TEXT_OUTPUTS = new Set([
  "comparison",
  "proposal",
  "talk-script",
  "social-post",
  "research-result",
]);

const ARTIFACT_CAPABILITY: Readonly<Record<string, string>> = {
  presentation: "presentation-artifact-runtime",
  document: "document-artifact-runtime",
  image: "image-generation-service",
  application: "application-workspace-runtime",
  website: "website-workspace-runtime",
  spreadsheet: "spreadsheet-artifact-runtime",
  chart: "chart-rendering-runtime",
};

function createOutputStep(output: string, index: number): OriginAgentWorkStep {
  if (INLINE_TEXT_OUTPUTS.has(output)) {
    return {
      id: `create-${index + 1}`,
      kind: "create-output",
      requiredCapability: "text-generation",
      availability: "available",
      reason: `${output}の内容は現在のテキスト回答内で作成できます。`,
    };
  }

  const capability = ARTIFACT_CAPABILITY[output] ?? `output-service:${output}`;
  return {
    id: `create-${index + 1}`,
    kind: "create-output",
    requiredCapability: capability,
    availability: "partial",
    reason: `${output}の内容設計はできますが、実ファイルまたは実行可能成果物の生成経路は未接続です。`,
  };
}

export function buildOriginAgentWorkPlan(intent: OriginRequestIntent): OriginAgentWorkPlan {
  const steps: OriginAgentWorkStep[] = [{
    id: "understand-goal",
    kind: "understand-goal",
    requiredCapability: "goal-understanding",
    availability: "available",
    reason: "依頼の表現だけでなく、達成したい目的を整理します。",
  }];

  if (intent.requiredCapabilities.includes("research")) {
    steps.push({
      id: "gather-information",
      kind: "gather-information",
      requiredCapability: "live-research",
      availability: "unavailable",
      reason: "最新情報を取得・検証する検索経路は現在のリリースに接続されていません。",
    });
  }

  if (intent.requestedOutputs.length > 0 || intent.suggestedOutputs.length > 0) {
    steps.push({
      id: "design-output",
      kind: "design-output",
      requiredCapability: "output-design",
      availability: "available",
      reason: "目的と利用場面に合わせて成果物の構成を設計します。",
    });
  }

  for (const [index, output] of intent.requestedOutputs.entries()) {
    steps.push(createOutputStep(output, index));
  }

  steps.push({
    id: "verify-output",
    kind: "verify-output",
    requiredCapability: "quality-review",
    availability: intent.requiredCapabilities.includes("research") ? "partial" : "available",
    reason: intent.requiredCapabilities.includes("research")
      ? "指示適合と内部整合性は確認できますが、外部事実の確認は検索経路の接続状況に従います。"
      : "回答または成果物の指示適合と内部整合性を確認します。",
  });

  if (intent.interactionMode !== "conversation") {
    steps.push({
      id: "deliver-result",
      kind: "deliver-result",
      requiredCapability: "result-presentation",
      availability: intent.requestedOutputs.every((output) => INLINE_TEXT_OUTPUTS.has(output))
        ? "available"
        : "partial",
      reason: "利用可能な内容は回答内で提示し、未生成のファイルや成果物を完成済みとは表示しません。",
    });
  }

  const incompleteCapabilities = steps
    .filter((step) => step.availability !== "available")
    .map((step) => step.requiredCapability);

  return {
    mode: intent.interactionMode,
    steps,
    canCompleteInCurrentRelease: incompleteCapabilities.length === 0,
    incompleteCapabilities: [...new Set(incompleteCapabilities)],
  };
}

export function originAgentWorkPlanInstruction(plan: OriginAgentWorkPlan): string {
  const steps = plan.steps.map((step, index) =>
    `${index + 1}. ${step.kind} | ${step.requiredCapability} | ${step.availability} | ${step.reason}`);

  return [
    "Application work plan (planning guidance; not proof that any step ran):",
    ...steps,
    `- Complete in the current release: ${plan.canCompleteInCurrentRelease ? "yes" : "no"}`,
    "- Perform only the available text work in this response.",
    "- For partial or unavailable steps, provide useful preparation when possible and clearly state what was not executed.",
    "- Never present an uncreated file, uncalled service, unverified search, or unexecuted review as completed.",
  ].join("\n");
}
