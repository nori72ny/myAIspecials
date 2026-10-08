import { describe, expect, it } from 'vitest';
import { planAgentToolSequenceV31 } from './agentMultiToolPlannerV31.js';

describe('Agent v3.1 bounded multi-tool planner', () => {
  it.each([
    ['最新市場を調べて、その結果から提案書を作って', ['web_search_grounding', 'document_generator']],
    ['最新の仕様を調べて、このTypeScriptコードのバグを修正して', ['web_search_grounding', 'code_interpreter']],
    ['このリポジトリを確認してバグを修正して', ['repository_explorer', 'code_interpreter']],
    ['このファイルを読んで編集して', ['file_reader', 'file_writer']],
    ['このファイルを編集してテストして', ['file_writer', 'verification_runner']],
    ['このファイルを読んで編集してテストして', ['file_reader', 'file_writer', 'verification_runner']],
    ['最新トレンドを調べて画像プロンプトを作って', ['web_search_grounding', 'image_prompt_compiler']],
  ])('creates a bounded dependency graph for %s', (goal, expected) => {
    const plan = planAgentToolSequenceV31(goal);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.steps.map((step) => step.toolName)).toEqual(expected);
    expect(plan.steps).toHaveLength(expected.length);
    expect(plan.steps[0]?.dependsOn).toEqual([]);
    for (let i = 1; i < plan.steps.length; i += 1) {
      expect(plan.steps[i]?.dependsOn).toEqual([`step-${i}`]);
      expect(plan.steps[i]?.approvalBoundary).toBe('exact-operation');
    }
  });

  it('does not add redundant repo/test tools around a full Coding V1.4 task', () => {
    const plan = planAgentToolSequenceV31('リポジトリを確認してTypeScriptのバグを修正しテストして');
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(plan.steps.map((step) => step.toolName)).toEqual(['code_interpreter']);
  });

  it('fails closed for an unsupported side-effect combination', () => {
    expect(planAgentToolSequenceV31('提案書と画像を同時に作って')).toEqual({
      ok: false,
      code: 'AGENT_MULTI_TOOL_PLAN_UNSUPPORTED',
    });
  });

  it('does not invent a graph for a single-tool or ambiguous request', () => {
    expect(planAgentToolSequenceV31('営業提案書を作って')).toEqual({
      ok: false,
      code: 'AGENT_TOOL_SELECTION_AMBIGUOUS',
    });
    expect(planAgentToolSequenceV31('いい感じに進めて')).toEqual({
      ok: false,
      code: 'AGENT_TOOL_SELECTION_AMBIGUOUS',
    });
  });
});
