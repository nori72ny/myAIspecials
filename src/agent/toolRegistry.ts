import { safeWriteRepositoryFile } from './safeRepositoryWriter.js';
import { runVerification, type VerificationKind } from './verificationRunner.js';

export type ToolName =
  | 'code_interpreter'
  | 'document_generator'
  | 'web_search_grounding'
  | 'image_prompt_compiler'
  | 'repository_explorer'
  | 'file_reader'
  | 'file_writer'
  | 'verification_runner';

export type ToolParams = Record<string, unknown>;

export type ToolResult = {
  ok: boolean;
  tool: ToolName;
  artifact?: string;
  message: string;
};

type ToolDefinition = {
  name: ToolName;
  description: string;
  sideEffects: 'none' | 'write';
  requiresApproval: true;
  execute: (params: ToolParams) => Promise<ToolResult>;
};

const MAX_TEXT = 12000;
const textParam = (params: ToolParams, key: string) => typeof params[key] === 'string' ? String(params[key]).slice(0, MAX_TEXT) : '';

const registry: Record<ToolName, ToolDefinition> = {
  code_interpreter: { name: 'code_interpreter', description: 'Deterministic local code analysis/formatting without external execution.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const code = textParam(params, 'code'); return { ok: true, tool: 'code_interpreter', artifact: code ? `// Sandboxed analysis\n${code}` : '// No code supplied.', message: 'Local code operation completed.' }; } },
  document_generator: { name: 'document_generator', description: 'Creates a text artifact locally; no external write occurs.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const content = textParam(params, 'content'); return { ok: true, tool: 'document_generator', artifact: content || '# Document\n\nNo content supplied.', message: 'Document artifact generated locally.' }; } },
  web_search_grounding: { name: 'web_search_grounding', description: 'Network access is intentionally disabled at the tool boundary.', sideEffects: 'none', requiresApproval: true, execute: async () => ({ ok: false, tool: 'web_search_grounding', message: 'Web grounding is unavailable in the zero-cost local execution kernel; no network request was made.' }) },
  image_prompt_compiler: { name: 'image_prompt_compiler', description: 'Compiles an image brief locally.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const input = textParam(params, 'prompt'); return { ok: true, tool: 'image_prompt_compiler', artifact: input ? `Subject: ${input}` : 'No image brief supplied.', message: 'Image prompt compiled locally.' }; } },
  repository_explorer: { name: 'repository_explorer', description: 'Repository exploration is intentionally delegated to the existing reader boundary.', sideEffects: 'none', requiresApproval: true, execute: async () => ({ ok: false, tool: 'repository_explorer', message: 'Repository explorer requires the repository reader adapter.' }) },
  file_reader: { name: 'file_reader', description: 'File reading requires the existing repository reader adapter.', sideEffects: 'none', requiresApproval: true, execute: async () => ({ ok: false, tool: 'file_reader', message: 'File reader requires the repository reader adapter.' }) },
  file_writer: { name: 'file_writer', description: 'Writes a repository file through the bounded safe writer.', sideEffects: 'write', requiresApproval: true, execute: async (params) => { const result = await safeWriteRepositoryFile(textParam(params, 'path'), textParam(params, 'content')); return { ok: true, tool: 'file_writer', artifact: result.path, message: `Wrote ${result.path} (${result.bytes} bytes).` }; } },
  verification_runner: { name: 'verification_runner', description: 'Runs only allowlisted local test, typecheck, or build verification.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const kind = textParam(params, 'kind') as VerificationKind; if (!['test', 'typecheck', 'build'].includes(kind)) return { ok: false, tool: 'verification_runner', message: 'Verification kind is not allowed.' }; const result = await runVerification(kind); return { ok: result.ok, tool: 'verification_runner', artifact: JSON.stringify(result), message: result.ok ? `${kind} verification passed.` : `${kind} verification failed.` }; } },
};

export const toolRegistry = Object.freeze(registry);

export async function executeToolWithPermission(toolName: ToolName, params: ToolParams, approval: { approved: boolean; costInUSD?: number; safetyPolicyPassed?: boolean } = { approved: false }): Promise<ToolResult> {
  const tool = toolRegistry[toolName];
  if (!tool) throw new Error('TOOL_NOT_REGISTERED');
  if (!approval.approved) throw new Error('HUMAN_APPROVAL_REQUIRED');
  if (approval.safetyPolicyPassed === false) throw new Error('SAFETY_POLICY_BLOCKED');
  if (approval.costInUSD !== undefined && approval.costInUSD !== 0) throw new Error('ZERO_COST_BOUNDARY_BLOCKED');
  if (tool.requiresApproval !== true) throw new Error('TOOL_POLICY_BLOCKED');
  return tool.execute(params);
}
