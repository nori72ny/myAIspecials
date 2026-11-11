import { createHash } from 'node:crypto';
import { listRepository, readRepositoryFile } from './safeRepositoryReader.js';
import { createRepositoryFileIfAbsent } from './safeRepositoryWriter.js';
import { validateDeltaEdit, applyDeltaEdit } from './safeDeltaEditor.js';
import { runVerification, type VerificationKind } from './verificationRunner.js';
import { isCapabilityAllowed, type AgentCapability } from './agentExecutionPolicy.js';
import { containsLikelySecret } from './safeFilePolicy.js';
import type { FileMutationCheckpoint } from './checkpointManager.js';
import { researchCurrentInformation } from '../legacy/originResearchSource.js';
import { createDefaultOriginResearchExecutor } from '../search/originSearchGrounding.js';
import { generateArtifactV12Async, type ArtifactType } from '../artifacts/artifactGeneratorV12.js';
import type { AgentCodeDelegationPort } from './agentCodingDelegationV14.js';

export type ToolName = 'code_interpreter' | 'document_generator' | 'web_search_grounding' | 'image_prompt_compiler' | 'repository_explorer' | 'file_reader' | 'file_writer' | 'verification_runner';
export type ToolParams = Record<string, unknown>;
export type ToolResult = { ok: boolean; tool: ToolName; artifact?: string; message: string; mutation?: FileMutationCheckpoint };
export type ToolExecutionContext = { codeDelegation?: AgentCodeDelegationPort };

type ToolDefinition = { name: ToolName; capability: AgentCapability; description: string; sideEffects: 'none' | 'write'; requiresApproval: true; execute: (params: ToolParams, context?: ToolExecutionContext) => Promise<ToolResult> };
const MAX_TEXT = 12000;
const MAX_CHECKPOINT_SNAPSHOT_BYTES = 256 * 1024;
const textParam = (params: ToolParams, key: string) => typeof params[key] === 'string' ? String(params[key]).slice(0, MAX_TEXT) : '';
const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
const repositoryRoot = () => process.cwd();
const readExisting = async (filePath: string): Promise<string | undefined> => {
  try { return await readRepositoryFile(repositoryRoot(), filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
};

const ARTIFACT_FORMATS: readonly ArtifactType[] = ['markdown', 'csv', 'pdf', 'docx', 'xlsx', 'pptx'];
const MAX_OUTLINE_SECTIONS = 12;

function stringListParam(params: ToolParams, key: string): string[] {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim().slice(0, 120)).slice(0, MAX_OUTLINE_SECTIONS);
}

/**
 * Composes the document body for the Artifact V12 delegation. Caller-provided
 * content wins; otherwise a structured draft is assembled from the title, the
 * request brief, and the planned outline. The output is a real document
 * scaffold (headings + brief + sections), never the raw request echoed back.
 */
function composeDocumentContent(params: ToolParams, title: string): string {
  const provided = typeof params.content === 'string' ? params.content.trim() : '';
  if (provided) return provided.slice(0, MAX_TEXT);
  const brief = textParam(params, 'brief').trim();
  const outline = stringListParam(params, 'outline');
  const lines = [`# ${title}`, ''];
  if (brief) lines.push('## 概要', brief, '');
  for (const section of outline) {
    if (section === '概要' && brief) continue;
    lines.push(`## ${section}`, `${section}について、確認できた事実と根拠に基づいて記載します。`, '');
  }
  if (!brief && outline.length === 0) lines.push('## 本文', '内容は依頼内容に基づいて構成されます。', '');
  return lines.join('\n').slice(0, MAX_TEXT);
}

/**
 * The agent research path: the same composed search-grounding pipeline
 * the chat / research surfaces use (classified routes over Wikipedia /
 * Tavily / GDELT with minimized queries and the provider free-quota
 * gates), with the no-search fallback pinned to `stable`. The planner
 * only emits web_search_grounding when a search has already been
 * decided, and agent goal strings are fact-shaped text the classifier
 * would otherwise leave unsearched — which used to drop them onto the
 * legacy scrape-only implementation (DuckDuckGo / Bing HTML through a
 * pinned non-browser fetch), a path that fails closed from the
 * production network. The legacy implementation remains the composer's
 * own not-applicable fallback, so the result shape is unchanged.
 */
const executeAgentResearch = createDefaultOriginResearchExecutor(
  { noSearchFallbackType: 'stable' },
  researchCurrentInformation,
);

const CODE_SIGNAL_PATTERN = /[{}();=<>]|\b(function|def|class|return|import|from|const|let|var|SELECT|INSERT|if|for|while)\b/;

/**
 * A provided-code payload must actually look like code. Natural-language
 * prose (for example the goal text itself) is rejected so a plan can never
 * pass a Japanese instruction sentence off as executable code again.
 */
export function looksLikeCode(value: string): boolean {
  const code = value.trim();
  if (code.length < 2 || code.length > MAX_TEXT) return false;
  if (!CODE_SIGNAL_PATTERN.test(code)) return false;
  if (/。$/.test(code) && !/[\n;{}]/.test(code)) return false;
  return true;
}

const registry: Record<ToolName, ToolDefinition> = {
  code_interpreter: {
    name: 'code_interpreter',
    capability: 'read_repository',
    description: 'Delegates code generation and repair to the V14 durable coding-job pipeline (dedicated worker, isolated verification). Fails closed when the V14 backend is not configured; never executes caller code in this process.',
    sideEffects: 'none',
    requiresApproval: true,
    execute: async (params, context) => {
      const legacyCode = typeof params.code === 'string' ? params.code : '';
      const mode = params.mode === 'provided-code' || legacyCode ? 'provided-code' : 'generate';
      const instruction = textParam(params, 'instruction').trim()
        || (mode === 'generate' ? '' : '与えられたコードを検証し、必要な修正を行ってください。');
      const language = textParam(params, 'language').trim() || undefined;
      const targetPath = textParam(params, 'targetPath').trim() || undefined;
      if (mode === 'provided-code' && !looksLikeCode(legacyCode)) {
        return { ok: false, tool: 'code_interpreter', message: 'AGENT_CODE_PARAMS_INVALID' };
      }
      if (mode === 'generate' && !instruction) {
        return { ok: false, tool: 'code_interpreter', message: 'AGENT_CODE_PARAMS_INVALID' };
      }
      if (!context?.codeDelegation) {
        return { ok: false, tool: 'code_interpreter', message: 'AGENT_CODE_BACKEND_NOT_CONFIGURED' };
      }
      const delegated = await context.codeDelegation.dispatch({
        mode,
        instruction,
        ...(mode === 'provided-code' ? { code: legacyCode } : {}),
        ...(language ? { language } : {}),
        ...(targetPath ? { targetPath } : {}),
      });
      if (delegated.state === 'unavailable') {
        return { ok: false, tool: 'code_interpreter', message: delegated.code };
      }
      const artifact = JSON.stringify({
        kind: 'coding-job',
        jobId: delegated.jobId,
        targetKey: delegated.targetKey,
        status: 'dispatched',
        completionCertified: false,
        note: 'Code generation/repair runs in the V14 worker pipeline with isolated verification. This agent run dispatched the job; it does not certify the code result.',
      });
      return { ok: true, tool: 'code_interpreter', artifact, message: `Coding job dispatched to the V14 pipeline (${delegated.jobId}).` };
    },
  },
  document_generator: {
    name: 'document_generator',
    capability: 'read_repository',
    description: 'Generates a real document (markdown/docx/pdf/csv/xlsx/pptx) locally through the Artifact V12 generator with structural verification.',
    sideEffects: 'none',
    requiresApproval: true,
    execute: async (params) => {
      const formatValue = textParam(params, 'format') || textParam(params, 'type');
      const format = (ARTIFACT_FORMATS.includes(formatValue as ArtifactType) ? formatValue : 'markdown') as ArtifactType;
      const hasInput = Boolean(
        textParam(params, 'title').trim()
        || (typeof params.content === 'string' && params.content.trim())
        || textParam(params, 'brief').trim()
        || stringListParam(params, 'outline').length > 0,
      );
      if (!hasInput) return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_PARAMS_INVALID' };
      const title = textParam(params, 'title').trim().slice(0, 120) || '文書';
      const content = composeDocumentContent(params, title);
      if (!content.trim()) return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_PARAMS_INVALID' };
      if (containsLikelySecret(content)) return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_CONTENT_BLOCKED' };
      const generated = await generateArtifactV12Async({ type: format, title, content });
      if (!generated.verified) {
        return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_VERIFICATION_FAILED' };
      }
      const artifact = JSON.stringify({
        kind: 'document',
        format: generated.type,
        filename: generated.filename,
        mimeType: generated.mimeType,
        bytes: generated.bytes.length,
        sha256: generated.sha256,
        verified: generated.verified,
        verification: generated.verification,
        ...(generated.type === 'markdown' ? { content } : {}),
      });
      return { ok: true, tool: 'document_generator', artifact, message: `Document generated and verified locally (${generated.filename}, ${generated.bytes.length} bytes).` };
    },
  },
  web_search_grounding: {
    name: 'web_search_grounding',
    capability: 'grounded_research',
    description: 'Zero-cost grounded research through the shared search-grounding pipeline (classified Wikipedia / Tavily / GDELT routes over minimized queries, stable-fact fallback); arbitrary network access remains disabled.',
    sideEffects: 'none',
    requiresApproval: true,
    execute: async (params) => {
      const query = textParam(params, 'query').trim();
      if (!query) return { ok: false, tool: 'web_search_grounding', message: 'A research query is required.' };
      const result = await executeAgentResearch(query);
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
    const result = await createRepositoryFileIfAbsent(repositoryRoot(), filePath, content);
    return { ok: true, tool: 'file_writer', artifact: result.path, message: `New repository file created atomically without replacement (${result.bytes} bytes).`, mutation: { path: result.path, beforeExists: false, afterSha256: sha256(content) } };
  } },
  verification_runner: { name: 'verification_runner', capability: 'run_tests', description: 'Runs only the repository allowlisted test, typecheck, lint, or build command with bounded output, timeout, no repository-controlled npm lifecycle execution, and a sanitized environment.', sideEffects: 'none', requiresApproval: true, execute: async (params) => { const kind = textParam(params, 'kind') as VerificationKind; if (kind !== 'test' && kind !== 'typecheck' && kind !== 'lint' && kind !== 'build') return { ok: false, tool: 'verification_runner', message: 'Verification kind must be test, typecheck, lint, or build.' }; const result = await runVerification(repositoryRoot(), kind); return { ok: result.ok, tool: 'verification_runner', artifact: JSON.stringify(result), message: result.ok ? `${kind} verification passed.` : `${kind} verification failed (exit=${result.exitCode}, timeout=${result.timedOut}).` }; } },
};

export const toolRegistry = Object.freeze(registry);

export async function executeToolWithPermission(toolName: ToolName, params: ToolParams, approval: { approved: boolean; costInUSD?: number; safetyPolicyPassed?: boolean } = { approved: false }, context?: ToolExecutionContext): Promise<ToolResult> {
  const tool = toolRegistry[toolName];
  if (!tool) throw new Error('TOOL_NOT_REGISTERED');
  if (!approval.approved) throw new Error('HUMAN_APPROVAL_REQUIRED');
  const securityPolicyPassed = approval.safetyPolicyPassed ?? false;
  if (!securityPolicyPassed) throw new Error('SAFETY_POLICY_BLOCKED');
  if (approval.costInUSD !== undefined && approval.costInUSD !== 0) throw new Error('ZERO_COST_BOUNDARY_BLOCKED');
  if (!isCapabilityAllowed({ capability: tool.capability, explicitIntent: approval.approved, securityPolicyPassed })) throw new Error('AGENT_CAPABILITY_DENIED');
  return tool.execute(params, context);
}
