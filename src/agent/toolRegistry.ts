import { generateAgentDocumentV3 } from './documentGenerationV3.js';
import { createHash } from 'node:crypto';
import { listRepository, readRepositoryFile } from './safeRepositoryReader.js';
import { createRepositoryFileIfAbsent } from './safeRepositoryWriter.js';
import { validateDeltaEdit, applyDeltaEdit } from './safeDeltaEditor.js';
import { runVerification, type VerificationKind } from './verificationRunner.js';
import { isCapabilityAllowed, type AgentCapability } from './agentExecutionPolicy.js';
import { containsLikelySecret } from './safeFilePolicy.js';
import type { FileMutationCheckpoint } from './checkpointManager.js';
import { researchCurrentInformation } from '../legacy/originResearchSource.js';

export type ToolName = 'code_interpreter' | 'document_generator' | 'web_search_grounding' | 'image_prompt_compiler' | 'repository_explorer' | 'file_reader' | 'file_writer' | 'verification_runner';
export type ToolParams = Record<string, unknown>;
export type ToolResult = { ok: boolean; tool: ToolName; artifact?: string; message: string; mutation?: FileMutationCheckpoint };

type ToolDefinition = { name: ToolName; capability: AgentCapability; description: string; sideEffects: 'none' | 'write'; requiresApproval: true; execute: (params: ToolParams, env?: NodeJS.ProcessEnv) => Promise<ToolResult> };
const MAX_TEXT = 12000;
const MAX_CHECKPOINT_SNAPSHOT_BYTES = 256 * 1024;
const textParam = (params: ToolParams, key: string) => {
  const value = typeof params[key] === 'string' ? String(params[key]) : '';
  if (value.length > MAX_TEXT) throw new Error('AGENT_TOOL_INPUT_TOO_LARGE');
  return value;
};
const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
const repositoryRoot = () => process.cwd();
const readExisting = async (filePath: string): Promise<string | undefined> => {
  try { return await readRepositoryFile(repositoryRoot(), filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
};

const registry: Record<ToolName, ToolDefinition> = {
  // Code execution still requires the isolated Coding V1.4 worker.
  // Markdown drafting is opt-in and does not certify task-level factual quality.
  code_interpreter: { name: 'code_interpreter', capability: 'read_repository', description: 'Code generation and repair are unavailable in this legacy Agent V3 adapter.', sideEffects: 'none', requiresApproval: true, execute: async () => ({ ok: false, tool: 'code_interpreter', message: 'AGENT_CODE_GENERATION_UNAVAILABLE' }) },
  document_generator: { name: 'document_generator', capability: 'draft_document', description: 'Drafts Markdown with the approved zero-cost provider when explicitly enabled; factual quality remains unverified.', sideEffects: 'none', requiresApproval: true, execute: (params, env) => generateAgentDocumentV3(params, { env }) },
  web_search_grounding: {
    name: 'web_search_grounding',
    capability: 'grounded_research',
    description: 'Zero-cost grounded research through allowlisted public search surfaces; arbitrary network access remains disabled.',
    sideEffects: 'none',
    requiresApproval: true,
    execute: async (params) => {
      const query = textParam(params, 'query').trim();
      if (!query) return { ok: false, tool: 'web_search_grounding', message: 'A research query is required.' };
      const result = await researchCurrentInformation(query);
      if (!result.ok || result.sources.length < 1) {
        return { ok: false, tool: 'web_search_grounding', message: `Grounded research failed closed (${result.failure?.code ?? 'NO_RESULTS'}).` };
      }
      const artifact = JSON.stringify({
        provider: result.searchProvider ?? null,
        sources: result.sources.slice(0, 8).map(source => ({
          title: source.title,
          url: source.url,
          excerpt: source.excerpt,
          domain: source.domain ?? null,
          evidenceLevel: source.evidenceLevel,
          sourceAuthority: source.sourceAuthority ?? null,
          freshness: source.freshness,
        })),
      });
      return { ok: true, tool: 'web_search_grounding', artifact, message: `Grounded research completed with ${result.sources.length} source(s).` };
    },
  },
  image_prompt_compiler: { name: 'image_prompt_compiler', capability: 'read_repository', description: 'Compiles an image brief into a provider-neutral prompt locally.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const input = textParam(params, 'prompt'); return { ok: true, tool: 'image_prompt_compiler', artifact: input ? `Subject: ${input}\n\nCapture: natural light, coherent composition, physically plausible materials.\nQuality: fine detail, clean edges, accurate anatomy.` : 'No image brief supplied.', message: 'Image prompt compiled locally.' }; } },
  repository_explorer: { name: 'repository_explorer', capability: 'read_repository', description: 'Read-only bounded repository tree exploration with protected-path filtering.', sideEffects: 'none', requiresApproval: true, execute: async () => { const entries = await listRepository(repositoryRoot()); return { ok: true, tool: 'repository_explorer', artifact: JSON.stringify(entries), message: `Repository exploration completed (${entries.length} entries).` }; } },
  file_reader: { name: 'file_reader', capability: 'read_repository', description: 'Read-only bounded file access with traversal, secret-path, and size protections.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const filePath = textParam(params, 'path'); if (!filePath) return { ok: false, tool: 'file_reader', message: 'A file path is required.' }; const content = await readRepositoryFile(repositoryRoot(), filePath); if (content.length > 120_000) return { ok: false, tool: 'file_reader', message: 'AGENT_FILE_READ_TOO_LARGE' }; return { ok: true, tool: 'file_reader', artifact: content, message: 'Repository file read completed.' }; } },
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
    const result = await createRepositoryFileIfAbsent(repositoryRoot(), filePath, content);
    return { ok: true, tool: 'file_writer', artifact: result.path, message: `New repository file created atomically without replacement (${result.bytes} bytes).`, mutation: { path: result.path, beforeExists: false, afterSha256: sha256(content) } };
  } },
  verification_runner: { name: 'verification_runner', capability: 'run_tests', description: 'Runs only the repository allowlisted test, typecheck, lint, or build command with bounded output, timeout, no repository-controlled npm lifecycle execution, and a sanitized environment.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const kind = textParam(params, 'kind') as VerificationKind; if (kind !== 'test' && kind !== 'typecheck' && kind !== 'lint' && kind !== 'build') return { ok: false, tool: 'verification_runner', message: 'Verification kind must be test, typecheck, lint, or build.' }; const result = await runVerification(repositoryRoot(), kind); return { ok: result.ok, tool: 'verification_runner', artifact: JSON.stringify(result), message: result.ok ? `${kind} verification passed.` : `${kind} verification failed (exit=${result.exitCode}, timeout=${result.timedOut}).` }; } },
};

export const toolRegistry = Object.freeze(registry);

export async function executeToolWithPermission(toolName: ToolName, params: ToolParams, approval: { approved: boolean; costInUSD?: number; safetyPolicyPassed?: boolean } = { approved: false }, env?: NodeJS.ProcessEnv): Promise<ToolResult> {
  const tool = toolRegistry[toolName];
  if (!tool) throw new Error('TOOL_NOT_REGISTERED');
  if (!approval.approved) throw new Error('HUMAN_APPROVAL_REQUIRED');
  const securityPolicyPassed = approval.safetyPolicyPassed ?? false;
  if (!securityPolicyPassed) throw new Error('SAFETY_POLICY_BLOCKED');
  if (approval.costInUSD !== undefined && approval.costInUSD !== 0) throw new Error('ZERO_COST_BOUNDARY_BLOCKED');
  if (!isCapabilityAllowed({ capability: tool.capability, explicitIntent: approval.approved, securityPolicyPassed })) throw new Error('AGENT_CAPABILITY_DENIED');
  // Only the V3 authenticated caller supplies drafting configuration.
  // Older orchestration paths must not gain inference from ambient environment flags.
  return tool.execute(params, env ?? (toolName === 'document_generator' ? {} : process.env));
}
