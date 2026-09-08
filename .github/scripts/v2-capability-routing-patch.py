from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)

# 1) Capability router: safe explicit parsing + deterministic task-type bridge.
path = Path("src/lib/orchestration/OriginCapabilityRouter.ts")
s = path.read_text()
if not s.startswith("import type { AITaskType }"):
    s = 'import type { AITaskType } from "./MultiAIOrchestrator.js";\n\n' + s
marker = '''export interface OriginCapabilityDecision {
  capability: OriginCapability;
  reason: "explicit" | "keyword" | "default";
  confidence: "high" | "medium" | "low";
}
'''
addition = marker + '''
const ORIGIN_CAPABILITIES: readonly OriginCapability[] = ["answer", "research", "coding", "writing", "analysis"];

export function parseOriginCapability(value: unknown): OriginCapability | undefined {
  return typeof value === "string" && ORIGIN_CAPABILITIES.includes(value as OriginCapability)
    ? value as OriginCapability
    : undefined;
}

export function originCapabilityTaskType(capability: OriginCapability): AITaskType {
  switch (capability) {
    case "research": return "research";
    case "coding": return "implementation";
    case "writing": return "documentation";
    case "analysis": return "review";
    case "answer":
    default: return "review";
  }
}
'''
s = replace_once(s, marker, addition, "capability bridge")
path.write_text(s)

# 2) Chat body accepts an optional explicit capability token; it remains unknown until validated.
path = Path("src/legacy/originChatValidation.ts")
s = path.read_text()
s = replace_once(s, "  activeContext?: unknown;\n", "  activeContext?: unknown;\n  capability?: unknown;\n", "chat capability field")
path.write_text(s)

# 3) Non-streaming route: make V2 capability selection authoritative before provider planning.
path = Path("src/legacy/originChatRouter.ts")
s = path.read_text()
cap_import = 'import { createOriginCapabilityGuide, isOriginCapabilityQuestion } from "../lib/orchestration/OriginCapabilityGuide.js";\n'
s = replace_once(s, cap_import, cap_import + 'import { originCapabilityTaskType, parseOriginCapability, selectOriginCapability } from "../lib/orchestration/OriginCapabilityRouter.js";\n', "chat capability import")
old_plan = '    const planningResult = buildOriginExecutionPlan({ goal: lastUserMessage.trim(), requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(lastUserMessage), requiresFreshResearch: false, containsSecrets: false }, { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) }, originClientPolicy(body), { freeModelCatalog: options.freeModelCatalog, nowMs: catalogNow() });'
new_plan = '    const capabilityDecision = selectOriginCapability(lastUserMessage, parseOriginCapability(body.capability));\n    const planningResult = buildOriginExecutionPlan({ goal: lastUserMessage.trim(), taskType: originCapabilityTaskType(capabilityDecision.capability), requiresCodeChanges: capabilityDecision.capability === "coding", requiresFreshResearch: false, containsSecrets: false }, { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) }, originClientPolicy(body), { freeModelCatalog: options.freeModelCatalog, nowMs: catalogNow() });'
s = replace_once(s, old_plan, new_plan, "chat capability planning")
s = replace_once(s, 'modelId: planningResult.plan.modelId, taskType: planningResult.plan.taskType, actualCostUsd:', 'modelId: planningResult.plan.modelId, taskType: planningResult.plan.taskType, capability: capabilityDecision.capability, capabilityReason: capabilityDecision.reason, capabilityConfidence: capabilityDecision.confidence, actualCostUsd:', "chat routing evidence")
path.write_text(s)

# 4) Streaming route: same deterministic selection and observable capability evidence.
path = Path("src/legacy/originStreamingChatRouter.ts")
s = path.read_text()
cap_import = 'import { isOriginCapabilityQuestion } from "../lib/orchestration/OriginCapabilityGuide.js";\n'
s = replace_once(s, cap_import, cap_import + 'import { originCapabilityTaskType, parseOriginCapability, selectOriginCapability } from "../lib/orchestration/OriginCapabilityRouter.js";\n', "stream capability import")
old = '''    const planningResult = buildOriginExecutionPlan(
      {
        goal: lastUserMessage.trim(),
        requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(lastUserMessage),
        requiresFreshResearch: false,
        containsSecrets: false,
      },'''
new = '''    const capabilityDecision = selectOriginCapability(lastUserMessage, parseOriginCapability(body.capability));
    const planningResult = buildOriginExecutionPlan(
      {
        goal: lastUserMessage.trim(),
        taskType: originCapabilityTaskType(capabilityDecision.capability),
        requiresCodeChanges: capabilityDecision.capability === "coding",
        requiresFreshResearch: false,
        containsSecrets: false,
      },'''
s = replace_once(s, old, new, "stream capability planning")
s = replace_once(s, '            res.setHeader("X-Origin-Model-Id", planningResult.plan.modelId);\n', '            res.setHeader("X-Origin-Model-Id", planningResult.plan.modelId);\n            res.setHeader("X-Origin-Capability", capabilityDecision.capability);\n', "stream capability header")
s = replace_once(s, '        fallbackUsed: result.routingEvidence.fallbackUsed,\n', '        fallbackUsed: result.routingEvidence.fallbackUsed,\n        capability: capabilityDecision.capability,\n        capabilityReason: capabilityDecision.reason,\n        capabilityConfidence: capabilityDecision.confidence,\n', "stream capability complete event")
path.write_text(s)

# 5) Focused unit coverage for explicit parsing and task mapping.
path = Path("src/lib/orchestration/OriginCapabilityRouter.test.ts")
s = path.read_text()
s = replace_once(s, '  capabilityExecutionOrder,\n  selectOriginCapability,\n', '  capabilityExecutionOrder,\n  originCapabilityTaskType,\n  parseOriginCapability,\n  selectOriginCapability,\n', "capability test imports")
insert_before = '''  it("is deterministic and keeps every capability in the bounded order", () => {
'''
extra = '''  it("parses only allowlisted explicit capabilities", () => {
    expect(parseOriginCapability("coding")).toBe("coding");
    expect(parseOriginCapability("operations")).toBeUndefined();
    expect(parseOriginCapability({ capability: "coding" })).toBeUndefined();
  });

  it("maps V2 capabilities to the existing bounded execution task types", () => {
    expect(originCapabilityTaskType("answer")).toBe("review");
    expect(originCapabilityTaskType("research")).toBe("research");
    expect(originCapabilityTaskType("coding")).toBe("implementation");
    expect(originCapabilityTaskType("writing")).toBe("documentation");
    expect(originCapabilityTaskType("analysis")).toBe("review");
  });

'''
s = replace_once(s, insert_before, extra + insert_before, "capability tests")
path.write_text(s)
