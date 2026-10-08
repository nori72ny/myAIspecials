import type { ToolName } from './toolRegistry.js';
import { scoreAgentToolsV3 } from './agentToolPlannerV3.js';

export const AGENT_MULTI_TOOL_PLAN_VERSION_V31 = 'origin.agent-multi-tool-plan.v3.1' as const;
const MAX_STEPS = 3;

export type AgentMultiToolStepV31 = {
  id: string;
  toolName: ToolName;
  reasonCode: string;
  dependsOn: readonly string[];
  approvalBoundary: 'exact-operation';
};

export type AgentMultiToolPlanV31 =
  | {
      ok: true;
      version: typeof AGENT_MULTI_TOOL_PLAN_VERSION_V31;
      steps: readonly AgentMultiToolStepV31[];
      bounded: true;
    }
  | {
      ok: false;
      code: 'AGENT_TOOL_SELECTION_AMBIGUOUS' | 'AGENT_MULTI_TOOL_PLAN_UNSUPPORTED';
    };

const PRIORITY: readonly ToolName[] = [
  'web_search_grounding',
  'repository_explorer',
  'file_reader',
  'code_interpreter',
  'file_writer',
  'document_generator',
  'image_prompt_compiler',
  'verification_runner',
];

function order(tools: readonly ToolName[]): ToolName[] {
  return PRIORITY.filter((tool) => tools.includes(tool));
}

function normalizeMatchedTools(goal: string): Array<{ toolName: ToolName; reasonCode: string }> {
  const scored = scoreAgentToolsV3(goal);
  const strong = scored.filter((row) => row.score >= 3);
  const byTool = new Map<ToolName, { toolName: ToolName; reasonCode: string }>();
  for (const row of strong) byTool.set(row.toolName, { toolName: row.toolName, reasonCode: row.reasonCode });

  // A trusted Coding V1.4 session already performs repository discovery and final
  // test/typecheck/lint/build verification. Do not manufacture redundant side
  // effects around it merely because the request also says "inspect" or "test".
  if (scored.some((row) => row.toolName === 'code_interpreter')) {
    const coding = scored.find((row) => row.toolName === 'code_interpreter');
    if (coding) byTool.set('code_interpreter', { toolName: 'code_interpreter', reasonCode: coding.reasonCode });
    byTool.delete('repository_explorer');
    byTool.delete('verification_runner');
  }

  return order([...byTool.keys()]).map((toolName) => byTool.get(toolName)!);
}

function supportedSequence(tools: readonly ToolName[]): boolean {
  const key = tools.join('>');
  return new Set([
    'web_search_grounding>document_generator',
    'web_search_grounding>code_interpreter',
    'repository_explorer>code_interpreter',
    'file_reader>file_writer',
    'file_writer>verification_runner',
    'file_reader>file_writer>verification_runner',
    'web_search_grounding>image_prompt_compiler',
  ]).has(key);
}

/**
 * Deterministic planning only. This function grants no execution authority.
 * Every eventual side-effecting step must still receive its own exact-operation
 * approval and verification before a supervisor may advance the graph.
 */
export function planAgentToolSequenceV31(goal: string): AgentMultiToolPlanV31 {
  const normalized = goal.trim();
  if (!normalized) return { ok: false, code: 'AGENT_TOOL_SELECTION_AMBIGUOUS' };

  const rawScored = scoreAgentToolsV3(normalized);
  const matched = normalizeMatchedTools(normalized);
  const collapsedIntoCoding = matched.length === 1
    && matched[0]?.toolName === 'code_interpreter'
    && rawScored.some((row) => row.toolName !== 'code_interpreter' && row.score >= 3);
  if (matched.length < 2 && !collapsedIntoCoding) return { ok: false, code: 'AGENT_TOOL_SELECTION_AMBIGUOUS' };
  if (matched.length > MAX_STEPS) return { ok: false, code: 'AGENT_MULTI_TOOL_PLAN_UNSUPPORTED' };

  const tools = matched.map((row) => row.toolName);
  if (!collapsedIntoCoding && !supportedSequence(tools)) return { ok: false, code: 'AGENT_MULTI_TOOL_PLAN_UNSUPPORTED' };

  return {
    ok: true,
    version: AGENT_MULTI_TOOL_PLAN_VERSION_V31,
    bounded: true,
    steps: matched.map((row, index) => ({
      id: `step-${index + 1}`,
      toolName: row.toolName,
      reasonCode: row.reasonCode,
      dependsOn: index === 0 ? [] : [`step-${index}`],
      approvalBoundary: 'exact-operation' as const,
    })),
  };
}
