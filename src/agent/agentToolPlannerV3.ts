import type { ToolName } from './toolRegistry.js';

export type AgentToolPlanDecisionV3 =
  | { ok: true; toolName: ToolName; reasonCode: string }
  | { ok: false; code: 'AGENT_TOOL_SELECTION_AMBIGUOUS' | 'AGENT_MULTI_TOOL_PLAN_REQUIRED' };

type ScoredTool = { toolName: ToolName; score: number; reasonCode: string };

const includes = (value: string, pattern: RegExp): boolean => pattern.test(value);

function scoreGoal(goal: string): ScoredTool[] {
  const value = goal.normalize('NFKC').toLowerCase();
  const rows: ScoredTool[] = [];

  const add = (toolName: ToolName, score: number, reasonCode: string, pattern: RegExp) => {
    if (includes(value, pattern)) rows.push({ toolName, score, reasonCode });
  };

  add(
    'web_search_grounding',
    4,
    'current-research',
    /\b(search|research|look\s*up|latest|current|news|fact[- ]?check|web)\b|調べ|検索|最新|ニュース|出典|ファクトチェック|ウェブ/,
  );
  add(
    'repository_explorer',
    4,
    'repository-overview',
    /\b(repository|repo|codebase|project\s+structure|file\s+tree)\b|リポジトリ|コードベース|ディレクトリ構成|ファイル一覧|プロジェクト構成/,
  );
  add(
    'file_reader',
    5,
    'read-specific-file',
    /(?:\b(read|open|inspect|show)\b.{0,32}\b(file|source)\b)|(?:(?:ファイル|ソース).{0,24}(?:読|開|確認|表示))|(?:(?:読|開|確認|表示).{0,24}(?:ファイル|ソース))/,
  );
  add(
    'file_writer',
    5,
    'write-specific-file',
    /(?:\b(create|write|add|edit|modify|update|patch)\b.{0,32}\b(file|source)\b)|(?:(?:ファイル|ソース).{0,24}(?:作成|追加|編集|修正|更新))|(?:(?:作成|追加|編集|修正|更新).{0,24}(?:ファイル|ソース))/,
  );
  add(
    'verification_runner',
    5,
    'verification-command',
    /\b(test|lint|typecheck|type-check|build|verify|verification)\b|テスト|型チェック|ビルド|検証/,
  );
  add(
    'image_prompt_compiler',
    4,
    'visual-request',
    /\b(image|visual|banner|poster|thumbnail|illustration|photo)\b|画像|バナー|ポスター|サムネ|イラスト|写真|ビジュアル/,
  );
  add(
    'document_generator',
    3,
    'document-request',
    /\b(document|report|proposal|memo|brief|draft|write[- ]?up)\b|文書|レポート|報告書|提案書|企画書|メモ|文章|資料/,
  );
  add(
    'code_interpreter',
    2,
    'code-analysis',
    /\b(code|script|function|bug|debug|algorithm|typescript|javascript|python)\b|コード|スクリプト|関数|バグ|デバッグ|アルゴリズム|実装/,
  );

  const bestByTool = new Map<ToolName, ScoredTool>();
  for (const row of rows) {
    const current = bestByTool.get(row.toolName);
    if (!current || row.score > current.score) bestByTool.set(row.toolName, row);
  }
  return [...bestByTool.values()];
}

export function selectAgentToolV3(goal: string): AgentToolPlanDecisionV3 {
  const scored = scoreGoal(goal);
  const strong = scored.filter(row => row.score >= 3);

  // Coding V1.4 performs its own repository discovery, edits and final checks.
  // A genuine *code change* must not be stolen by a high-scoring "test" or
  // "repository" keyword and silently downgraded to a read-only tool.
  const normalized = goal.normalize('NFKC').toLowerCase();
  const codeAction = /\b(fix|repair|implement|refactor|debug|patch|modify|update|change)\b|修正|直し|直す|修復|実装|リファクタ|改修|バグを直|コードを変更/;
  const codeSubject = /\b(code|bug|typescript|javascript|python|function|repository|repo|source|module)\b|コード|バグ|プログラム|関数|リポジトリ|ソース|モジュール/;
  if (codeAction.test(normalized) && codeSubject.test(normalized)
    && scored.some(row => row.toolName === 'code_interpreter')) {
    const outsideCoding = strong.filter(row =>
      !['repository_explorer', 'file_reader', 'file_writer', 'verification_runner'].includes(row.toolName));
    if (outsideCoding.length > 0) return { ok: false, code: 'AGENT_MULTI_TOOL_PLAN_REQUIRED' };
    return { ok: true, toolName: 'code_interpreter', reasonCode: 'bounded-coding-v14' };
  }

  if (strong.length > 1) return { ok: false, code: 'AGENT_MULTI_TOOL_PLAN_REQUIRED' };
  if (strong.length === 1) return { ok: true, toolName: strong[0].toolName, reasonCode: strong[0].reasonCode };

  const fallback = scored.sort((a, b) => b.score - a.score)[0];
  if (fallback) return { ok: true, toolName: fallback.toolName, reasonCode: fallback.reasonCode };

  return { ok: false, code: 'AGENT_TOOL_SELECTION_AMBIGUOUS' };
}
