import { createHash } from 'node:crypto';
import { listRepository, readRepositoryFile } from './safeRepositoryReader.js';
import { writeRepositoryFile } from './safeRepositoryWriter.js';
import { validateDeltaEdit, applyDeltaEdit } from './safeDeltaEditor.js';
import { runVerification, type VerificationKind } from './verificationRunner.js';
import { isCapabilityAllowed, type AgentCapability } from './agentExecutionPolicy.js';
import { containsLikelySecret } from './safeFilePolicy.js';
import type { FileMutationCheckpoint } from './checkpointManager.js';

export type ToolName = 'code_interpreter' | 'document_generator' | 'web_search_grounding' | 'image_prompt_compiler' | 'repository_explorer' | 'file_reader' | 'file_writer' | 'verification_runner';
export type ToolParams = Record<string, unknown>;
export type ToolResult = { ok: boolean; tool: ToolName; artifact?: string; message: string; mutation?: FileMutationCheckpoint };

type ToolDefinition = { name: ToolName; capability: AgentCapability; description: string; sideEffects: 'none' | 'write'; requiresApproval: true; execute: (params: ToolParams) => Promise<ToolResult> };
const MAX_TEXT = 12000;
const MAX_CHECKPOINT_SNAPSHOT_BYTES = 256 * 1024;
const textParam = (params: ToolParams, key: string) => typeof params[key] === 'string' ? String(params[key]).slice(0, MAX_TEXT) : '';
const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
const repositoryRoot = () => process.cwd();
const readExisting = async (filePath: string): Promise<string | undefined> => {
  try { return await readRepositoryFile(repositoryRoot(), filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
};

const registry: Record<ToolName, ToolDefinition> = {
  code_interpreter: { name: 'code_interpreter', capability: 'read_repository', description: 'Deterministic local code analysis/formatting without external execution.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const code = textParam(params, 'code'); return { ok: true, tool: 'code_interpreter', artifact: code ? `// Sandboxed analysis\n${code}` : '// No code supplied.', message: 'Local code operation completed.' }; } },
  document_generator: { name: 'document_generator', capability: 'read_repository', description: 'Creates a text artifact in memory; no repository or external write occurs.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const content = textParam(params, 'content'); return { ok: true, tool: 'document_generator', artifact: content || '# Document\n\nNo content supplied.', message: 'Document artifact generated locally.' }; } },
  web_search_grounding: { name: 'web_search_grounding', capability: 'network', description: 'Network capability intentionally disabled in the zero-cost local execution kernel.', sideEffects: 'none', requiresApproval: true, execute: async () => ({ ok: false, tool: 'web_search_grounding', message: 'Network capability is disabled; no request was made.' }) },
  image_prompt_compiler: { name: 'image_prompt_compiler', capability: 'read_repository', description: 'Compiles an image brief into a provider-neutral prompt locally.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const input = textParam(params, 'prompt'); return { ok: true, tool: 'image_prompt_compiler', artifact: input ? `Subject: ${input}\n\nCapture: natural light, coherent composition, physically plausible materials.\nQuality: fine detail, clean edges, accurate anatomy.` : 'No image brief supplied.', message: 'Image prompt compiled locally.' }; } },
  repository_explorer: { name: 'repository_explorer', capability: 'read_repository', description: 'Read-only bounded repository tree exploration with protected-path filtering.', sideEffects: 'none', requiresApproval: true, execute: async () => { const entries = await listRepository(repositoryRoot()); return { ok: true, tool: 'repository_explorer', artifact: JSON.stringify(entries), message: `Repository exploration completed (${entries.length} entries).` }; } },
  file_reader: { name: 'file_reader', capability: 'read_repository', description: 'Read-only bounded file access with traversal, secret-path, and size protections.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const filePath = textParam(params, 'path'); if (!filePath) return { ok: false, tool: 'file_reader', message: 'A file path is required.' }; const content = await readRepositoryFile(repositoryRoot(), filePath); return { ok: true, tool: 'file_reader', artifact: content.slice(0, MAX_TEXT), message: 'Repository file read completed.' }; } },
  file_writer: { name: 'file_writer', capability: 'write_repository', description: 'Writes repository files through bounded atomic replacement. Existing files require exact-one-match search/replacement editing; whole-file writes are restricted to genuinely new files.', sideEffects: 'write', requiresApproval: true, execute: async (params) => {
    const filePath = textParam(params, 'path');
    if (!filePath) return { ok: false, tool: 'file_writer', message: 'A file path is required.' };
    const search = typeof params.search === 'string' ? params.search : undefined;
    const replacement = typeof params.replacement === 'string' ? params.replacement : undefined;
    const isDelta = search !== undefined || replacement !== undefined;
    if (isDelta) {
      if (search === undefined || replacement === undefined) return { ok: false, tool: 'file_writer', message: 'Delta edits require both search and replacement.' };
      const edit = await validateDeltaEdit(repositoryRoot(), { path: filePath, search, replacement });
      if (Buffer.byteLength(edit.previous, 'utf8') > MAX_CHECKPOINT_SNAPSHOT_BYTES) throw new Error('CHECKPOINT_SNAPSHOT_TOO_LARGE');
      if (containsLikelySecret(edit.previous)) throw new Error('CHECKPOINT_SECRET_SNAPSHOT_BLOCKED');
      await applyDeltaEdit(repositoryRoot(), edit);
      return { ok: true, tool: 'file_writer', artifact: edit.path, message: 'Repository delta applied atomically (exactly one match).', mutation: { path: edit.path, beforeExists: true, beforeContent: edit.previous, afterSha256: sha256(edit.next) } };
    }
    const content = typeof params.content === 'string' ? params.content : '';
    const beforeContent = await readExisting(filePath);
    if (beforeContent !== undefined) return { ok: false, tool: 'file_writer', message: 'Existing files must be edited with exact-one-match search/replacement; whole-file replacement is blocked.' };
    const result = await writeRepositoryFile(repositoryRoot(), filePath, content);
    return { ok: true, tool: 'file_writer', artifact: result.path, message: `New repository file written atomically (${result.bytes} bytes).`, mutation: { path: result.path, beforeExists: false, afterSha256: sha256(content) } };
  } },
  verification_runner: { name: 'verification_runner', capability: 'run_tests', description: 'Runs only the repository allowlisted test, typecheck, lint, or build command with bounded output, timeout, no repository-controlled npm lifecycle execution, and a sanitized environment.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const kind = textParam(params, 'kind') as VerificationKind; if (kind !== 'test' && kind !== 'typecheck' && kind !== 'lint' && kind !== 'build') return { ok: false, tool: 'verification_runner', message: 'Verification kind must be test, typecheck, lint, or build.' }; const result = await runVerification(repositoryRoot(), kind); return { ok: result.ok, tool: 'verification_runner', artifact: JSON.stringify(result), message: result.ok ? `${kind} verification passed.` : `${kind} verification failed (exit=${result.exitCode}, timeout=${result.timedOut}).` }; } },
};

export const toolRegistry = Object.freeze(registry);

export async function executeToolWithPermission(toolName: ToolName, params: ToolParams, approval: { approved: boolean; costInUSD?: number; safetyPolicyPassed?: boolean } = { approved: false }): Promise<ToolResult> {
  const tool = toolRegistry[toolName];
  if (!tool) throw new Error('TOOL_NOT_REGISTERED');
  if (!approval.approved) throw new Error('HUMAN_APPROVAL_REQUIRED');
  const securityPolicyPassed = approval.safetyPolicyPassed ?? false;
  if (!securityPolicyPassed) throw new Error('SAFETY_POLICY_BLOCKED');
  if (approval.costInUSD !== undefined && approval.costInUSD !== 0) throw new Error('ZERO_COST_BOUNDARY_BLOCKED');
  if (!isCapabilityAllowed({ capability: tool.capability, explicitIntent: approval.approved, securityPolicyPassed })) throw new Error('AGENT_CAPABILITY_DENIED');
  return tool.execute(params);
}