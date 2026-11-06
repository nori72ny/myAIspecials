import { describe, expect, it } from 'vitest';
import { planAgentToolsV3, selectAgentToolV3 } from './agentToolPlannerV3.js';

describe('Agent V3 deterministic tool planner', () => {
  it.each([
    ['最新のAI規制を調べて出典付きでまとめて', 'web_search_grounding'],
    ['このリポジトリの構成を確認して', 'repository_explorer'],
    ['このファイルを読んで内容を確認して', 'file_reader'],
    ['新しい設定ファイルを作成して', 'file_writer'],
    ['簡単な売上表を作って', 'file_writer'],
    ['簡単なCSV一覧を作って', 'file_writer'],
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

describe('planAgentToolsV3 multi-step planning', () => {
  const stepsOf = (goal: string) => {
    const plan = planAgentToolsV3(goal);
    return plan.ok ? plan.steps.map(step => step.toolName) : plan;
  };

  it('plans research then document generation for a compound goal (benchmark A4 shape)', () => {
    expect(stepsOf('最新のAIニュースを調べて、要約ドキュメントを作成してください')).toEqual([
      'web_search_grounding',
      'document_generator',
    ]);
  });

  it('does not reject a single-intent document goal as multi-tool (benchmark A2 shape)', () => {
    expect(stepsOf('週次報告書のドキュメントを作成してください')).toEqual(['document_generator']);
  });

  it('keeps a document plus explicit file path as generate-then-write', () => {
    expect(stepsOf('提案書のドキュメントを作成して、`docs/proposal.md` ファイルに保存してください')).toEqual([
      'document_generator',
      'file_writer',
    ]);
  });

  it('orders gathering before production and verification last', () => {
    expect(stepsOf('リポジトリの構成を確認して、テストも実行してください')).toEqual([
      'repository_explorer',
      'verification_runner',
    ]);
  });

  it('falls back to the single best weak match for a code goal (benchmark A3 shape)', () => {
    expect(stepsOf('PythonでCSVを集計するコードを実行してください')).toEqual(['code_interpreter']);
  });

  it('routes a natural code-generation phrasing to the coding backend, not the file writer', () => {
    expect(stepsOf('CSVを読み込んで平均を計算するPythonコードを作成してください')).toEqual(['code_interpreter']);
  });

  it('does not treat a code review request as code generation', () => {
    expect(stepsOf('このコードをレビューして')).toEqual(['code_interpreter']);
  });

  it('plans a named-file read before document generation', () => {
    expect(stepsOf('notes.txtの内容を確認して、その概要をドキュメントにまとめてください')).toEqual([
      'file_reader',
      'document_generator',
    ]);
  });

  it('plans a single named-file read instead of reporting ambiguity', () => {
    expect(stepsOf('package.json の中身を確認して')).toEqual(['file_reader']);
  });

  it('reports ambiguity with candidates instead of a bare rejection (benchmark A5 shape)', () => {
    const plan = planAgentToolsV3('何か面白いことをして');
    expect(plan.ok).toBe(false);
    if ('code' in plan) {
      expect(plan.code).toBe('AGENT_TOOL_SELECTION_AMBIGUOUS');
      expect(Array.isArray(plan.candidates)).toBe(true);
      expect(plan.candidates.length).toBeGreaterThan(0);
    }
  });
});
