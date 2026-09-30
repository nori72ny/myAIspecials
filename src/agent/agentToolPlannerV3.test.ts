import { describe, expect, it } from 'vitest';
import { selectAgentToolV3 } from './agentToolPlannerV3.js';

describe('Agent V3 deterministic tool planner', () => {
  it.each([
    ['最新のAI規制を調べて出典付きでまとめて', 'web_search_grounding'],
    ['このリポジトリの構成を確認して', 'repository_explorer'],
    ['このファイルを読んで内容を確認して', 'file_reader'],
    ['新しい設定ファイルを作成して', 'file_writer'],
    ['テストと型チェックを実行して', 'verification_runner'],
    ['YouTubeサムネ用の画像プロンプトを作って', 'image_prompt_compiler'],
    ['営業提案書を作成して', 'document_generator'],
    ['このTypeScriptコードのバグを分析して', 'code_interpreter'],
  ])('selects a bounded tool for %s', (goal, toolName) => {
    expect(selectAgentToolV3(goal)).toMatchObject({ ok: true, toolName });
  });

  it('fails closed for a multi-tool request that needs a supervisor graph', () => {
    expect(selectAgentToolV3('最新市場を調べて、その結果から提案書を作って')).toEqual({
      ok: false,
      code: 'AGENT_MULTI_TOOL_PLAN_REQUIRED',
    });
  });

  it('fails closed instead of inventing a tool for an ambiguous goal', () => {
    expect(selectAgentToolV3('いい感じに進めて')).toEqual({
      ok: false,
      code: 'AGENT_TOOL_SELECTION_AMBIGUOUS',
    });
  });
});
