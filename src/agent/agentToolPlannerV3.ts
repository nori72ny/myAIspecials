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
    /(?:\b(create|write|add|edit|modify|update|patch)\b.{0,32}\b(file|source)\b)|(?:(?:ファイル|ソース).{0,24}(?:作成|作って|作り|追加|編集|修正|更新))|(?:(?:作成|作って|作り|追加|編集|修正|更新).{0,24}(?:ファイル|ソース))|(?:(?:売上|一覧|表|CSV|ファイル|ドキュメント).{0,24}(?:作成|作って|作り))/i,
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
    /\b(document|report|proposal|memo|brief|draft|write[- ]?up)\b|文書|ドキュメント|レポート|報告書|提案書|企画書|メモ|文章|資料/,
  );
  add(
    'code_interpreter',
    2,
    'code-analysis',
    /\b(code|script|function|bug|debug|algorithm|typescript|javascript|python)\b|コード|スクリプト|関数|バグ|デバッグ|アルゴリズム|実装/,
  );
  // Code *generation* is a strong signal on its own: without it, a request
  // like 「CSVを読み込んで平均を計算するPythonコードを作成してください」 is
  // captured by the file-writer's generic "…を作成" pattern and never reaches
  // the coding backend. コードレビュー / コードネーム are not generation.
  add(
    'code_interpreter',
    4,
    'code-generation',
    /(?:(?:コード(?!レビュー|ネーム)|スクリプト|プログラム|関数).{0,30}(?:作成|作って|作り|書いて|書く|生成|実装|開発))|(?:(?:作成|作って|書いて|生成|実装).{0,30}(?:コード(?!レビュー|ネーム)|スクリプト|プログラム))|(?:\b(?:write|create|generate|implement)\b.{0,32}\b(?:code|script|function|program)\b)/,
  );
  // Reading a file named explicitly in the goal (「notes.txtの内容を確認して」)
  // is a file-reader request even when the words ファイル/ソース never appear.
  add(
    'file_reader',
    5,
    'read-named-file',
    /[a-z0-9_@-]+\.[a-z0-9_-]{1,12}.{0,24}(?:確認|読|見せ|開|内容)/,
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

  if (strong.length > 1) return { ok: false, code: 'AGENT_MULTI_TOOL_PLAN_REQUIRED' };
  if (strong.length === 1) return { ok: true, toolName: strong[0].toolName, reasonCode: strong[0].reasonCode };

  const fallback = scored.sort((a, b) => b.score - a.score)[0];
  if (fallback) return { ok: true, toolName: fallback.toolName, reasonCode: fallback.reasonCode };

  return { ok: false, code: 'AGENT_TOOL_SELECTION_AMBIGUOUS' };
}

export type AgentToolStepV3 = { toolName: ToolName; reasonCode: string };

export type AgentMultiToolPlanV3 =
  | { ok: true; steps: AgentToolStepV3[] }
  | { ok: false; code: 'AGENT_TOOL_SELECTION_AMBIGUOUS'; candidates: ToolName[] };

const MAX_PLAN_STEPS = 4;

// Sequential execution order: gather context first, produce artifacts next,
// persist to files after generation, and verify last. This mirrors the
// dependency direction of the agent task graph (each step may consume the
// previous step's artifact).
const CANONICAL_STEP_ORDER: readonly ToolName[] = [
  'repository_explorer',
  'file_reader',
  'web_search_grounding',
  'code_interpreter',
  'document_generator',
  'image_prompt_compiler',
  'file_writer',
  'verification_runner',
];

const DOCUMENT_INTENT_PATTERN = /ドキュメント|文書|レポート|報告書|提案書|企画書|議事録|メモ|資料|\b(document|report|proposal|memo|brief)\b/i;
const EXPLICIT_FILE_INTENT_PATTERN = /ファイル|CSV|売上|一覧表|\b(csv|file)\b/i;

/**
 * Plans one or more tools for a goal. Unlike the legacy single-tool selector,
 * a goal that genuinely needs several tools yields an ordered step list
 * instead of AGENT_MULTI_TOOL_PLAN_REQUIRED. Known intent overlaps are
 * resolved deterministically: a "document" request that also matches the
 * file-writer creation pattern (e.g. 「ドキュメントを作成」) is a single
 * document-generation intent, not two steps, unless the goal also names an
 * explicit file/table artifact or an explicit path.
 */
export function planAgentToolsV3(goal: string): AgentMultiToolPlanV3 {
  const scored = scoreGoal(goal);
  let strong = scored.filter(row => row.score >= 3);

  const hasDocument = strong.some(row => row.toolName === 'document_generator');
  const hasWriter = strong.some(row => row.toolName === 'file_writer');
  if (hasDocument && hasWriter) {
    const normalized = goal.normalize('NFKC');
    const hasExplicitPath = /`[^`\r\n]{1,240}`/.test(normalized)
      || /(?:^|\s)((?:\.{0,2}\/)?[A-Za-z0-9_@./-]+\.[A-Za-z0-9_-]{1,12})(?![A-Za-z0-9_.-])/.test(normalized);
    if (!hasExplicitPath && DOCUMENT_INTENT_PATTERN.test(normalized) && !EXPLICIT_FILE_INTENT_PATTERN.test(normalized)) {
      strong = strong.filter(row => row.toolName !== 'file_writer');
    }
  }

  // A code-generation step owns its file output inside the coding workspace:
  // the V3 file writer cannot consume a dispatched coding job's result, so a
  // writer step chained after code generation could only persist goal prose.
  // When both are strong (e.g. 「Pythonコードを作成してください」 also matches
  // the writer's generic creation pattern), the writer step is dropped.
  const hasCodeGeneration = strong.some(row => row.toolName === 'code_interpreter');
  if (hasCodeGeneration && hasWriter) {
    strong = strong.filter(row => row.toolName !== 'file_writer');
  }

  if (strong.length >= 1) {
    const ordered = [...strong].sort(
      (a, b) => CANONICAL_STEP_ORDER.indexOf(a.toolName) - CANONICAL_STEP_ORDER.indexOf(b.toolName),
    );
    return { ok: true, steps: ordered.slice(0, MAX_PLAN_STEPS).map(row => ({ toolName: row.toolName, reasonCode: row.reasonCode })) };
  }

  const fallback = [...scored].sort((a, b) => b.score - a.score)[0];
  if (fallback) return { ok: true, steps: [{ toolName: fallback.toolName, reasonCode: fallback.reasonCode }] };

  return {
    ok: false,
    code: 'AGENT_TOOL_SELECTION_AMBIGUOUS',
    candidates: scored.length > 0 ? scored.map(row => row.toolName) : [...CANONICAL_STEP_ORDER],
  };
}
