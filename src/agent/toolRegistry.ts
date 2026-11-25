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
import type { AgentAttachmentStore } from './agentAttachmentRecord.js';
import type { AgentModelCallTiming, AgentModelExecutor } from './agentModelCall.js';
import {
  executeAttachmentAnalyzer,
  executeAttachmentReader,
  executeAttachmentReconciler,
  parseAgentDataRemediations,
  parseAgentDataResources,
  AGENT_FINDING_SEVERITIES,
} from './agentAttachmentTools.js';
import { computeBaselBia, assembleCapitalCalculationJson, type BaselBiaInputs } from './agentBaselBia.js';
import {
  renderExecutionLog,
  renderRowsCsvWithColumns,
  type ExecutionLogFileProfile,
} from './agentMultiFileSpec.js';

export type ToolName = 'code_interpreter' | 'document_generator' | 'web_search_grounding' | 'image_prompt_compiler' | 'repository_explorer' | 'file_reader' | 'file_writer' | 'verification_runner' | 'attachment_reader' | 'attachment_analyzer' | 'attachment_reconciler';
export type ToolParams = Record<string, unknown>;
export type ToolResult = {
  ok: boolean;
  tool: ToolName;
  artifact?: string;
  message: string;
  mutation?: FileMutationCheckpoint;
  /**
   * Diagnostic-only payload (K-17 target B, design AGENT_K17_FAILED_
   * STEP_ARTIFACT_DESIGN_2026-11-24 §5): a payload the tool computed
   * but could not deliver because it failed its own post-merge gates,
   * attached to a failure result (ok stays false; code and message
   * are unchanged). It rides a channel strictly separate from
   * `artifact`: it is never an input to a later step, never verified,
   * and never a deliverable. The executor carries it on the record's
   * own diagnostic channel and the run advancer may persist it as a
   * diagnostic row — never registered as a step artifact a consumer
   * can resolve. Meaningful only on failure results; a tool attaches
   * it only where a computed payload would otherwise be discarded.
   */
  diagnosticArtifact?: string;
  /**
   * Observability channel, separate from both artifacts above:
   * the model dispatches this call made, with their measured
   * durations (D7 countermeasure A, diagnosis
   * AGENT_D7_DIAGNOSIS_2026-11-25 §6). Only the model-calling
   * tools (attachment analyzer / reconciler) populate it, on
   * success and failure alike; it never affects the outcome, the
   * message or any gate, and its only reader is the run advancer,
   * which reduces it into the step's live detail (the record
   * layer re-validates every entry before keeping it). Entries
   * carry identifiers, a closed outcome, a code and a duration
   * only — no request or response body, no user text.
   */
  modelCallTimings?: readonly AgentModelCallTiming[];
};
export type ToolExecutionContext = {
  codeDelegation?: AgentCodeDelegationPort;
  /**
   * Attachment access for the data tools (file-input foundation F2):
   * the attachment store plus the owner binding of the run being
   * executed. Bound per run by the run advancer; absent everywhere
   * else, where the data tools fail closed (AGENT_ATTACHMENT_UNAVAILABLE).
   */
  attachments?: { store: AgentAttachmentStore; ownerBinding: string };
  /** Model executor override for the analyzer; production leaves this
   * unset and the failover-backed executor is built from `env`. */
  modelCall?: AgentModelExecutor;
  env?: NodeJS.ProcessEnv;
  /** Wait seam for the analyzer's transient-failure retry backoff;
   * production leaves this unset (real timers). See
   * AGENT_SEGMENT2_WALL_DIAGNOSIS_2026-11-22 §6. */
  sleepMs?: (ms: number) => Promise<void>;
};

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

/**
 * Structured-JSON documents (agent file-input foundation F5, first
 * shape; design AGENT_ARTIFACT_FORMAT_DESIGN_2026-11-21 §3.3). When
 * a goal specifies a JSON deliverable with required top-level keys,
 * the document step assembles the file deterministically from the
 * analyzer's bundle — never from the model's free text, and never
 * through the V12 generator, which has no JSON type.
 *
 * The key-to-section table is the generic vocabulary of a structured
 * analysis report (not task-specific): root_causes from the typed
 * findings, affected_resources from the named resources,
 * remediation_plan from the proposed remediations, a summary composed
 * from the findings, and incident_metadata with safe_to_rollback
 * defaulting to false (unjudged rollback is never claimed safe). A
 * required key outside the table is present with a null value, so
 * the format gate (keys present) still holds while the missing
 * content stays visible as a gap rather than invented text.
 */
const AGENT_JSON_TOP_LEVEL_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_AGENT_JSON_TOP_LEVEL_KEYS = 12;
const MAX_AGENT_JSON_CHARS = 120_000;
const SAFE_AGENT_JSON_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;
const MAX_AGENT_JSON_FILENAME_CHARS = 120;

export function isSafeAgentJsonFilename(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_AGENT_JSON_FILENAME_CHARS
    && SAFE_AGENT_JSON_FILENAME_PATTERN.test(value);
}

function composeAgentJsonSummary(findings: readonly { claim: string }[]): string {
  if (findings.length === 0) return 'No root causes were identified from the attached data.';
  const listed = findings.map((finding) => finding.claim.trim()).filter(Boolean).slice(0, 10).join(' ');
  return `Identified ${findings.length} root cause${findings.length === 1 ? '' : 's'}: ${listed}`.slice(0, 2000);
}

export function assembleAgentJsonDocument(
  bundleText: string,
  topLevelKeys: readonly unknown[],
): { ok: true; content: string } | { ok: false; code: string } {
  if (
    topLevelKeys.length === 0
    || topLevelKeys.length > MAX_AGENT_JSON_TOP_LEVEL_KEYS
    || !topLevelKeys.every((key) => typeof key === 'string' && AGENT_JSON_TOP_LEVEL_KEY_PATTERN.test(key))
  ) {
    return { ok: false, code: 'AGENT_DOCUMENT_JSON_KEYS_UNRESOLVED' };
  }
  const keys = topLevelKeys as string[];
  let bundle: unknown;
  try {
    bundle = JSON.parse(bundleText) as unknown;
  } catch {
    return { ok: false, code: 'AGENT_DOCUMENT_JSON_INVALID' };
  }
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { ok: false, code: 'AGENT_DOCUMENT_JSON_INVALID' };
  }
  const record = bundle as Record<string, unknown>;
  if (record.kind !== 'data-analysis' || record.outputKind !== 'findings' || !Array.isArray(record.findings)) {
    return { ok: false, code: 'AGENT_DOCUMENT_JSON_INVALID' };
  }
  const findings = (record.findings as unknown[]).filter(
    (finding): finding is Record<string, unknown> =>
      Boolean(finding) && typeof finding === 'object' && !Array.isArray(finding)
      && typeof (finding as Record<string, unknown>).claim === 'string'
      && ((finding as Record<string, unknown>).claim as string).trim().length > 0,
  );
  if (keys.includes('root_causes') && findings.length === 0) {
    return { ok: false, code: 'AGENT_DOCUMENT_JSON_INVALID' };
  }
  const report: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === 'root_causes') {
      report[key] = findings.map((finding) => {
        const type = typeof finding.type === 'string' && finding.type.trim()
          ? finding.type.trim().slice(0, 80)
          : 'finding';
        const severity = typeof finding.severity === 'string' && AGENT_FINDING_SEVERITIES.includes(finding.severity)
          ? finding.severity
          : 'medium';
        const evidence = typeof finding.evidence === 'string' && finding.evidence.trim()
          ? [finding.evidence.trim()]
          : [];
        return { type, severity, description: (finding.claim as string).trim(), evidence };
      });
    } else if (key === 'affected_resources') {
      report[key] = parseAgentDataResources(record.resources);
    } else if (key === 'remediation_plan') {
      report[key] = parseAgentDataRemediations(record.remediations);
    } else if (key === 'summary') {
      report[key] = composeAgentJsonSummary(findings as { claim: string }[]);
    } else if (key === 'incident_metadata') {
      report[key] = { safe_to_rollback: false };
    } else {
      report[key] = null;
    }
  }
  const content = JSON.stringify(report, null, 2);
  if (content.length > MAX_AGENT_JSON_CHARS) return { ok: false, code: 'AGENT_DOCUMENT_JSON_TOO_LARGE' };
  return { ok: true, content };
}

/** The V12 extension for each document format, for the file-name
 * override check below. */
const DOCUMENT_FORMAT_EXTENSIONS: Record<string, string> = {
  markdown: 'md',
  csv: 'csv',
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  // Not V12 formats: the deterministic role assembly (対策6) names
  // its files through the same override check.
  json: 'json',
  txt: 'txt',
};

/**
 * A goal-specified file name for a V12 format: a safe basename whose
 * extension matches the generated format. Anything else is not a
 * name this step may use (a mismatched extension would mislabel the
 * bytes), so the caller fails closed instead of overriding.
 */
function agentOutputFilenameOverride(value: unknown, format: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 120) return null;
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return null;
  const ext = DOCUMENT_FORMAT_EXTENSIONS[format];
  if (!ext || !value.toLowerCase().endsWith(`.${ext}`)) return null;
  return value;
}

async function executeAgentJsonDocument(params: ToolParams): Promise<ToolResult> {
  const filename = params.outputFilename;
  if (!isSafeAgentJsonFilename(filename)) {
    return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_PARAMS_INVALID' };
  }
  const keys = params.jsonTopLevelKeys;
  if (!Array.isArray(keys)) {
    return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_JSON_KEYS_UNRESOLVED' };
  }
  const bundleText = typeof params.content === 'string' ? params.content : '';
  if (!bundleText.trim()) {
    return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_JSON_INVALID' };
  }
  const assembled = assembleAgentJsonDocument(bundleText, keys);
  if (assembled.ok === false) {
    return { ok: false, tool: 'document_generator', message: assembled.code };
  }
  if (containsLikelySecret(assembled.content)) {
    return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_CONTENT_BLOCKED' };
  }
  // bytes/sha256 are computed from the exact content string carried
  // in the envelope, so the declared values always reproduce the
  // delivered content (the K8s deliverable's 225-byte envelope
  // mismatch cannot recur through this path).
  const bytes = Buffer.from(assembled.content, 'utf8');
  const artifact = JSON.stringify({
    kind: 'document',
    format: 'json',
    filename,
    mimeType: 'application/json; charset=utf-8',
    bytes: bytes.length,
    sha256: sha256(assembled.content),
    verified: true,
    verification: ['non-empty', 'utf8-text', 'json-valid', 'json-keys'],
    content: assembled.content,
  });
  return { ok: true, tool: 'document_generator', artifact, message: `Document generated and verified locally (${filename}, ${bytes.length} bytes).` };
}

/* ------------------------------------------------------------------ */
/* Multi-file role assembly (failure diagnosis 2026-11-24, 対策6)      */
/* ------------------------------------------------------------------ */

const AGENT_OUTPUT_ROLES: readonly string[] = ['rows-csv', 'capital-json', 'execution-log'];
const ROLE_FORMATS: Record<string, { format: string; mimeType: string }> = {
  'rows-csv': { format: 'csv', mimeType: 'text/csv; charset=utf-8' },
  'capital-json': { format: 'json', mimeType: 'application/json; charset=utf-8' },
  'execution-log': { format: 'txt', mimeType: 'text/plain; charset=utf-8' },
};

function parseAnalyzerBundle(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The bundle's BIA inputs, shape-checked: the capital assembly
 * trusts nothing the bundle merely claims — a malformed block is
 * absent inputs, and absent inputs fail the step closed. */
function biaInputsFromBundle(bundle: Record<string, unknown>): BaselBiaInputs | null {
  const raw = bundle.biaInputs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.alphaText !== 'string') return null;
  const years = record.grossIncomeByYear;
  if (!years || typeof years !== 'object' || Array.isArray(years)) return null;
  const grossIncomeByYear: Record<string, number> = {};
  for (const [year, value] of Object.entries(years as Record<string, unknown>)) {
    if (!/^\d{4}$/.test(year) || typeof value !== 'number' || !Number.isFinite(value)) return null;
    grossIncomeByYear[year] = value;
  }
  if (Object.keys(grossIncomeByYear).length === 0) return null;
  return { alphaText: record.alphaText, grossIncomeByYear };
}

function stringArrayParam(params: ToolParams, key: string): string[] {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function logFilesParam(params: ToolParams): ExecutionLogFileProfile[] {
  const value = params.logFiles;
  if (!Array.isArray(value)) return [];
  const files: ExecutionLogFileProfile[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.kind !== 'string') continue;
    files.push({
      name: record.name,
      kind: record.kind,
      ...(typeof record.rowCount === 'number' ? { rowCount: record.rowCount } : {}),
      charCount: typeof record.charCount === 'number' ? record.charCount : 0,
    });
  }
  return files;
}

/**
 * Assembles one file of a multi-file deliverable from the final
 * analyzer bundle, deterministically, by the step's role:
 * rows-csv renders the bundle's rows in the schema's column order;
 * capital-json computes the BIA from the bundle's parsed inputs
 * (never from model arithmetic — missing inputs fail closed);
 * execution-log generates the run log from the plan-time file
 * profile and the bundle's recorded trace. The envelope follows
 * the JSON path's discipline: bytes/sha256 are measured from the
 * exact content string the envelope carries.
 */
async function executeAgentRoleDocument(params: ToolParams): Promise<ToolResult> {
  const fail = (message: string): ToolResult => ({ ok: false, tool: 'document_generator', message });
  const role = typeof params.outputRole === 'string' ? params.outputRole : '';
  if (!AGENT_OUTPUT_ROLES.includes(role)) return fail('AGENT_DOCUMENT_PARAMS_INVALID');
  const formatInfo = ROLE_FORMATS[role];
  const filename = agentOutputFilenameOverride(params.outputFilename, formatInfo.format);
  if (filename === null) return fail('AGENT_DOCUMENT_PARAMS_INVALID');
  const bundleText = typeof params.content === 'string' ? params.content : '';
  if (!bundleText.trim()) return fail('AGENT_DOCUMENT_JSON_INVALID');
  const bundle = parseAnalyzerBundle(bundleText);
  if (!bundle) return fail('AGENT_DOCUMENT_JSON_INVALID');

  let content: string;
  if (role === 'rows-csv') {
    const rawRows = Array.isArray(bundle.rows) ? bundle.rows : null;
    if (!rawRows) return fail('AGENT_DOCUMENT_JSON_INVALID');
    const rows: Record<string, string>[] = [];
    for (const raw of rawRows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('AGENT_DOCUMENT_JSON_INVALID');
      const row: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string') row[key] = value;
        else if (typeof value === 'number' && Number.isFinite(value)) row[key] = String(value);
        else if (typeof value === 'boolean') row[key] = String(value);
      }
      rows.push(row);
    }
    let columns = stringArrayParam(params, 'outputColumns');
    if (columns.length === 0) {
      const seen: string[] = [];
      for (const row of rows) {
        for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
      }
      columns = seen;
    }
    if (columns.length === 0) return fail('AGENT_DOCUMENT_JSON_INVALID');
    content = renderRowsCsvWithColumns(rows, columns);
  } else if (role === 'capital-json') {
    const biaInputs = biaInputsFromBundle(bundle);
    if (!biaInputs) return fail('AGENT_DOCUMENT_JSON_INVALID');
    content = assembleCapitalCalculationJson(computeBaselBia(biaInputs));
  } else {
    const biaInputs = biaInputsFromBundle(bundle);
    const coverageRaw = bundle.coverage && typeof bundle.coverage === 'object' && !Array.isArray(bundle.coverage)
      ? (bundle.coverage as Record<string, unknown>)
      : null;
    const aggregatesRaw = bundle.aggregates && typeof bundle.aggregates === 'object' && !Array.isArray(bundle.aggregates)
      ? (bundle.aggregates as Record<string, { sum: number; count: number }>)
      : undefined;
    content = renderExecutionLog({
      files: logFilesParam(params),
      outputs: stringArrayParam(params, 'outputFileNames'),
      ...(stringArrayParam(params, 'logRequiredColumns').length > 0
        ? { requiredColumns: stringArrayParam(params, 'logRequiredColumns') }
        : {}),
      ...(coverageRaw && typeof coverageRaw.totalChunks === 'number' && typeof coverageRaw.processedChunks === 'number'
        ? {
            coverage: {
              totalChunks: coverageRaw.totalChunks,
              processedChunks: coverageRaw.processedChunks,
              ...(typeof coverageRaw.keyCount === 'number' ? { keyCount: coverageRaw.keyCount } : {}),
              ...(typeof coverageRaw.discardedRows === 'number' ? { discardedRows: coverageRaw.discardedRows } : {}),
            },
          }
        : {}),
      ...(aggregatesRaw ? { aggregates: aggregatesRaw } : {}),
      ...(biaInputs ? { bia: computeBaselBia(biaInputs) } : {}),
    });
  }
  if (!content.trim()) return fail('AGENT_DOCUMENT_JSON_INVALID');
  if (containsLikelySecret(content)) return fail('AGENT_DOCUMENT_CONTENT_BLOCKED');
  const bytes = Buffer.from(content, 'utf8');
  const artifact = JSON.stringify({
    kind: 'document',
    format: formatInfo.format,
    filename,
    mimeType: formatInfo.mimeType,
    bytes: bytes.length,
    sha256: sha256(content),
    verified: true,
    verification: ['non-empty', 'utf8-text', 'deterministic-assembly'],
    content,
  });
  return { ok: true, tool: 'document_generator', artifact, message: `Document generated and verified locally (${filename}, ${bytes.length} bytes).` };
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
      // Data-grounded documents (file-input foundation F2, design
      // §3.5.2): when a plan grounds this step in attachment data, the
      // template fallback in composeDocumentContent is disabled — a
      // document assembled from title/brief/outline boilerplate would
      // present invented prose as if it were the data's content. The
      // resolved data content is the only acceptable body; without it
      // the step fails closed here (the advancer's input resolution
      // normally fails even earlier with AGENT_STEP_INPUT_UNAVAILABLE).
      if (params.dataGrounded === true && !(typeof params.content === 'string' && params.content.trim())) {
        return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_PARAMS_INVALID' };
      }
      // Multi-file role deliverables (対策6) assemble from the
      // analyzer bundle deterministically, one file per step; the
      // role param is planner-issued only.
      if (typeof params.outputRole === 'string') return executeAgentRoleDocument(params);
      // Structured-JSON deliverables assemble from the analyzer bundle
      // instead of going through the V12 generator (which has no JSON
      // type); the raw bundle reaches this step via contentFromStep
      // (advancer raw resolution for structured document steps).
      if (formatValue === 'json') return executeAgentJsonDocument(params);
      const title = textParam(params, 'title').trim().slice(0, 120) || '文書';
      const content = composeDocumentContent(params, title);
      if (!content.trim()) return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_PARAMS_INVALID' };
      if (containsLikelySecret(content)) return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_CONTENT_BLOCKED' };
      const generated = await generateArtifactV12Async({ type: format, title, content });
      if (!generated.verified) {
        return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_VERIFICATION_FAILED' };
      }
      // A goal-specified file name replaces the title-derived V12
      // name when its extension matches the generated format; a
      // mismatched or unsafe name fails closed instead of mislabeling
      // the bytes.
      let filename = generated.filename;
      if (params.outputFilename !== undefined) {
        const override = agentOutputFilenameOverride(params.outputFilename, generated.type);
        if (override === null) {
          return { ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_PARAMS_INVALID' };
        }
        filename = override;
      }
      // Envelope rule (the JSON path's discipline, applied to every
      // format): the declared bytes/sha256 describe the entity this
      // envelope carries. Text formats carry it inline as `content` —
      // for markdown the pre-wrap body string the display consumes,
      // for csv the generated file text itself — so the declarations
      // are measured from that string, never from the wrapped file
      // bytes (the markdown file wraps the body in a title heading;
      // measuring the file was the K8s deliverable's 225-byte
      // mismatch). Binary formats carry the generated file bytes as
      // `contentBase64` (artifact retrieval R-2), so their
      // declarations describe exactly what the base64 decodes to.
      // The generator's own verification above stays a verification of
      // the generated file and is reported unchanged.
      const carriedText = generated.type === 'markdown'
        ? content
        : generated.type === 'csv'
          ? generated.bytes.toString('utf8')
          : undefined;
      const declaredBytes = carriedText !== undefined ? Buffer.from(carriedText, 'utf8') : generated.bytes;
      const artifact = JSON.stringify({
        kind: 'document',
        format: generated.type,
        filename,
        mimeType: generated.mimeType,
        bytes: declaredBytes.length,
        sha256: carriedText !== undefined ? sha256(carriedText) : generated.sha256,
        verified: generated.verified,
        verification: generated.verification,
        ...(carriedText !== undefined ? { content: carriedText } : { contentBase64: generated.bytes.toString('base64') }),
      });
      return { ok: true, tool: 'document_generator', artifact, message: `Document generated and verified locally (${filename}, ${declaredBytes.length} bytes).` };
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
  attachment_reader: {
    name: 'attachment_reader',
    capability: 'read_input_data',
    description: 'Profiles the files of an approved attachment set deterministically (structure, key column, chunk map) without calling a model. Reads bodies only through the execution context\'s owner-bound attachment port; fails closed without it.',
    sideEffects: 'none',
    requiresApproval: true,
    execute: async (params, context) => executeAttachmentReader(params, context),
  },
  attachment_analyzer: {
    name: 'attachment_analyzer',
    capability: 'read_input_data',
    description: 'Reads an approved attachment set in bounded chunks and processes each chunk through the shared free-provider failover (classification / extraction / consistency findings / text), merging chained steps and verifying key coverage deterministically before anything flows downstream.',
    sideEffects: 'none',
    requiresApproval: true,
    execute: async (params, context) => executeAttachmentAnalyzer(params, context),
  },
  attachment_reconciler: {
    name: 'attachment_reconciler',
    capability: 'read_input_data',
    description: 'Vets an inconsistency-audit run\'s merged findings in one model call over deterministic material (the findings, the value-mismatch candidates and the structure map — never raw document text): applies the pairing discipline (one attribute, same entity and agreement scope, two differing values with two verbatim citations), drops misreadings, picks up cross-document mismatches, and fails closed when candidates exist but no vetted finding survives. Issued only for audit goals while the reconciliation switch is on; shadow mode records the vetted list without changing the deliverable.',
    sideEffects: 'none',
    requiresApproval: true,
    execute: async (params, context) => executeAttachmentReconciler(params, context),
  },
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
