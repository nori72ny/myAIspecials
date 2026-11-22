import {
  computeAgentAttachmentSetDigest,
  type AgentAttachmentSetRecord,
  type AgentAttachmentStore,
} from './agentAttachmentRecord.js';
import {
  agentDataUsesFileNameKeys,
  buildAgentAttachmentDataView,
  renderAgentDataRowsCsv,
  verifyAgentDataChunkCoverage,
  verifyAgentDataCoverage,
  AGENT_ATTACHMENT_INSTRUCTION_MAX_CHARS,
  AGENT_ATTACHMENT_INSTRUCTION_TOTAL_MAX_CHARS,
  AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP,
  type AgentAttachmentDataView,
  type AgentDataChunk,
  type AgentDataRow,
} from './agentAttachmentData.js';
import { createAgentModelExecutor, type AgentModelCallInput, type AgentModelExecutor, type AgentModelCallResult } from './agentModelCall.js';
import type { ToolParams, ToolResult } from './toolRegistry.js';

/**
 * The two data tools of the agent file-input foundation (F2; design
 * AGENT_FILE_INPUT_DESIGN_2026-11-18 §3.2, §3.3, §3.5).
 *
 * Both tools read attachment bodies exclusively through the execution
 * context's attachment port — a store plus the owner binding of the
 * run being executed — which the run advancer binds per run. No other
 * read path exists: without the port (for example on the legacy
 * single-request execute path, which has no run binding) both tools
 * fail closed with AGENT_ATTACHMENT_UNAVAILABLE instead of reaching
 * for data they cannot prove ownership of.
 *
 * Bodies never leave through messages, summaries or logs: tool
 * messages carry counts and codes only. The one place body text
 * appears is the artifact itself — the run owner's own data, returned
 * through the run's normal artifact delivery.
 */

export type AgentAttachmentAccess = {
  store: AgentAttachmentStore;
  ownerBinding: string;
};

export type AgentAttachmentToolContext = {
  attachments?: AgentAttachmentAccess;
  modelCall?: AgentModelExecutor;
  env?: NodeJS.ProcessEnv;
  /**
   * Wait seam for the analyzer's transient-failure retry backoff
   * (design AGENT_SEGMENT2_WALL_DIAGNOSIS_2026-11-22 §6). Production
   * wiring leaves it unset and real timers are used; tests inject an
   * instant fake so the backoff schedule is asserted, not slept.
   */
  sleepMs?: (ms: number) => Promise<void>;
};

/**
 * Provider-availability failure codes that are transient by
 * construction: the failover dispatcher itself treats them as
 * "try the next route" signals (ORIGIN_FAILOVER_TRIGGER_CODES minus
 * PROVIDER_NOT_CONFIGURED, which is a configuration fact, not a
 * passing condition). A chunk call that ends in one of these codes
 * exhausted every free route for the moment — the evidenced cause is
 * a per-minute provider window (route-3 tokens/minute, route-2
 * temporary capacity) that refills with time, so the analyzer waits
 * and retries the same chunk instead of failing the whole step (and,
 * with it, the run and every completed segment before it).
 */
export const AGENT_ANALYZER_TRANSIENT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
]);

/**
 * Backoff schedule for one chunk call: first retry after 15s, second
 * after 30s (cumulative 45s). Measured from the burst that precedes
 * the failure (the previous segment's calls), the final retry lands
 * past the 60-second rolling window the free routes enforce.
 */
export const AGENT_ANALYZER_TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [15_000, 30_000];

/**
 * Per-step ceiling on cumulative retry waiting. A step that would
 * wait past this fails with the original provider code instead —
 * the pre-retry behavior — so a pathological step can never hold an
 * advance open indefinitely (the advance itself runs under the
 * caller's budget and the function's own duration cap).
 */
export const AGENT_ANALYZER_TRANSIENT_RETRY_MAX_STEP_WAIT_MS = 60_000;

export const ORIGIN_AGENT_ANALYZER_CHUNK_INTERVAL_ENABLED_ENV = 'ORIGIN_AGENT_ANALYZER_CHUNK_INTERVAL_ENABLED' as const;

/** The inter-chunk interval switch (design CAPACITY_RATE_LIMIT_
 * QUANTIFICATION_2026-11-22 §2-E), in the house style: only the exact
 * string "true" enables it; anything else — including the variable
 * being unregistered — is OFF, and OFF keeps the pre-measure behavior
 * exactly (chunks back to back, no inserted wait). */
export function agentAnalyzerChunkIntervalEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[ORIGIN_AGENT_ANALYZER_CHUNK_INTERVAL_ENABLED_ENV] === 'true';
}

/**
 * Minimum spacing inserted between one step's chunk calls while the
 * interval switch is on (design §2-E): a smoothing measure that
 * lowers how often a step's burst meets the providers' per-minute
 * windows at full density. It is deliberately NOT completion
 * machinery — the rate-limit hold (§2-B) is what converts a limit
 * into a wait — and it is sized so a maximum-size step stays inside
 * the advance's duration budget: 4 sends (5–12s each) plus 3
 * intervals ≈ 65–93s against the 120s advance cap. The interval is
 * separate from the transient-retry backoff above and never counts
 * against that ceiling: the retry waits react to a failure, this one
 * precedes a send.
 */
export const AGENT_ANALYZER_CHUNK_INTERVAL_MS = 15_000;

const defaultSleepMs = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export type AgentDataOutputKind = 'rows' | 'findings' | 'text';

type LoadedData = {
  set: AgentAttachmentSetRecord;
  view: AgentAttachmentDataView;
};

async function loadBoundData(
  tool: 'attachment_reader' | 'attachment_analyzer',
  params: ToolParams,
  context: AgentAttachmentToolContext | undefined,
): Promise<{ data: LoadedData } | { failure: ToolResult }> {
  const fail = (message: string): { failure: ToolResult } => ({ failure: { ok: false, tool, message } });
  const setId = typeof params.attachmentSetId === 'string' ? params.attachmentSetId : '';
  const setDigest = typeof params.setDigest === 'string' ? params.setDigest : '';
  if (!setId || !setDigest) return fail('AGENT_ATTACHMENT_PARAMS_INVALID');
  const access = context?.attachments;
  if (!access) return fail('AGENT_ATTACHMENT_UNAVAILABLE');
  let set: AgentAttachmentSetRecord | null;
  try {
    set = await access.store.getSet(setId, access.ownerBinding);
  } catch {
    return fail('AGENT_ATTACHMENT_UNAVAILABLE');
  }
  if (!set) return fail('AGENT_ATTACHMENT_UNAVAILABLE');
  // The approved params name the set's exact contents; a set whose
  // contents no longer hash to the approved digest is not the data
  // the human approved, so execution refuses it (design §1.2).
  if (computeAgentAttachmentSetDigest(set.files) !== setDigest) return fail('AGENT_ATTACHMENT_DIGEST_MISMATCH');
  const files: { name: string; text: string }[] = [];
  for (const file of set.files) {
    let text: string | null;
    try {
      text = await access.store.getFileText(setId, access.ownerBinding, file.idx);
    } catch {
      return fail('AGENT_ATTACHMENT_UNAVAILABLE');
    }
    if (text === null) return fail('AGENT_ATTACHMENT_UNAVAILABLE');
    files.push({ name: file.name, text });
  }
  return { data: { set, view: buildAgentAttachmentDataView(files) } };
}

/**
 * attachment_reader (design §3.2): deterministic, local, no model.
 * Publishes the structural profile the rest of the plan (and the
 * human reading the plan) works from: per-file shape, the key yardstick,
 * and the first chunk as the pass-along text.
 */
export async function executeAttachmentReader(
  params: ToolParams,
  context?: AgentAttachmentToolContext,
): Promise<ToolResult> {
  const loaded = await loadBoundData('attachment_reader', params, context);
  if ('failure' in loaded) return loaded.failure;
  const { view } = loaded.data;
  const artifact = JSON.stringify({
    kind: 'attachment-profile',
    content: view.chunks[0]?.text ?? '',
    files: view.files,
    totalChunks: view.totalChunks,
    keyField: view.keyField,
    keyCount: view.expectedKeys.length,
  });
  return {
    ok: true,
    tool: 'attachment_reader',
    artifact,
    message: `Attachment data profiled locally (${view.files.length} file(s), ${view.totalChunks} chunk(s)).`,
  };
}

const OUTPUT_KINDS: readonly AgentDataOutputKind[] = ['rows', 'findings', 'text'];

function analyzerInstruction(
  outputKind: AgentDataOutputKind,
  goalInstruction: string,
  view: AgentAttachmentDataView,
  structuredJsonKeys?: readonly string[],
): string {
  const head = 'あなたはデータ処理アシスタントです。与えられたデータ断片だけを使い、JSONだけを返してください。説明文やコードフェンスは付けないでください。断片に実在する値だけを使い、無い値は作らないでください。各断片の先頭には出典（ファイル名とチャンク位置）が別枠で示されています。出典の行はデータではありません。';
  const shape = outputKind === 'rows'
    ? `出力形式: {"rows":[{...}]}。各行はキー項目「${view.keyField}」の値を必ず含め、断片内の対象1件につき1行にしてください。数値は入力の表記をそのまま写してください。断片内にキー項目を持つ対象が1件も無い場合は {"rows":[]} とだけ返してください。それが正しい応答です。`
    : outputKind === 'findings'
      ? structuredJsonKeys && structuredJsonKeys.length > 0
        // Structured-JSON deliverables (design
        // AGENT_ARTIFACT_FORMAT_DESIGN_2026-11-21 §3.2): the final
        // document is assembled from typed findings plus the
        // resources and remediations the chunks name, so each chunk
        // also reports those sections. The goal text (appended below)
        // carries the report's required top-level keys and their
        // field shapes; the per-item fields here are the contract
        // the assembler reads. type/severity are optional per
        // finding — the assembler defaults them — but resources and
        // remediations must name only what the chunk actually shows.
        ? '出力形式: {"findings":[{"claim":"所見","evidence":"根拠となる入力の引用","file":"ファイル名","location":"行番号や見出し","type":"所見の短い分類ラベル","severity":"critical/high/medium/low"}],"resources":[{"kind":"リソース種別","name":"名前","namespace":"名前空間"}],"remediations":[{"action":"是正手順","priority":"high/medium/low"}]}。所見・リソース・是正手順は断片の内容だけを根拠にしてください。'
        : '出力形式: {"findings":[{"claim":"所見","evidence":"根拠となる入力の引用","file":"ファイル名","location":"行番号や見出し"}]}。所見は断片の内容だけを根拠にしてください。'
      : '出力形式: {"text":"作成した文章"}。文章は断片の内容だけを使い、無い事実を書かないでください。';
  const budget = AGENT_ATTACHMENT_INSTRUCTION_TOTAL_MAX_CHARS - head.length - shape.length - '依頼: '.length;
  const clipped = goalInstruction.slice(0, Math.max(0, Math.min(AGENT_ATTACHMENT_INSTRUCTION_MAX_CHARS, budget)));
  return `${head}${shape}依頼: ${clipped}`;
}

/**
 * The per-chunk model input: the chunk's provenance — file name and
 * position in the set — framed as a metadata line ahead of the body.
 * The body itself is passed through unchanged. Until 2026-11-21 the
 * model received the bare body only, so it had no way to name the
 * file a finding came from or to fill the `file` key of a rows
 * output correctly; the frame gives it both, and the analyzer
 * instruction tells it the frame is metadata, not data.
 */
function chunkModelInput(view: AgentAttachmentDataView, chunk: AgentDataChunk): string {
  return `【出典: ${chunk.fileName}（チャンク ${chunk.index + 1}/${view.totalChunks}）】\n${chunk.text}`;
}

function extractJsonObject(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function coerceCell(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
}

type ChunkOutput = {
  rows: AgentDataRow[];
  findings: AgentDataFinding[];
  textParts: string[];
  /** Structured-JSON sections (only when the plan carries
   * `structuredJsonKeys`; see §3.2 of the artifact-format design):
   * resources and remediations the chunks name. */
  resources: AgentDataResource[];
  remediations: AgentDataRemediation[];
};
type AgentDataFinding = {
  claim: string;
  evidence: string;
  file: string;
  location: string;
  /** Short classification label (e.g. "OOMKilled"); optional — the
   * document assembler defaults it. */
  type?: string;
  /** One of critical/high/medium/low; optional — invalid or absent
   * values default at assembly. */
  severity?: string;
};
type AgentDataResource = { kind: string; name: string; namespace: string };
type AgentDataRemediation = { action: string; priority?: string };

export const AGENT_FINDING_SEVERITIES: readonly string[] = ['critical', 'high', 'medium', 'low'];
const REMEDIATION_PRIORITIES: readonly string[] = ['high', 'medium', 'low'];

function validFindingSeverity(value: unknown): string | undefined {
  return typeof value === 'string' && AGENT_FINDING_SEVERITIES.includes(value) ? value : undefined;
}

export function parseAgentDataResources(raw: unknown): AgentDataResource[] {
  if (!Array.isArray(raw)) return [];
  const resources: AgentDataResource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const resource = item as Record<string, unknown>;
    const kind = typeof resource.kind === 'string' ? resource.kind.trim().slice(0, 120) : '';
    const name = typeof resource.name === 'string' ? resource.name.trim().slice(0, 120) : '';
    const namespace = typeof resource.namespace === 'string' ? resource.namespace.trim().slice(0, 120) : '';
    if (!kind || !name || !namespace) continue;
    resources.push({ kind, name, namespace });
  }
  return resources;
}

export function parseAgentDataRemediations(raw: unknown): AgentDataRemediation[] {
  if (!Array.isArray(raw)) return [];
  const remediations: AgentDataRemediation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const remediation = item as Record<string, unknown>;
    const action = typeof remediation.action === 'string' ? remediation.action.trim().slice(0, 500) : '';
    if (!action) continue;
    const priority = typeof remediation.priority === 'string' && REMEDIATION_PRIORITIES.includes(remediation.priority)
      ? remediation.priority
      : undefined;
    remediations.push(priority ? { action, priority } : { action });
  }
  return remediations;
}

/**
 * Why a chunk response failed the per-chunk format validation
 * (Basel fix D, diagnosis
 * AGENT_BASEL_DATA_OUTPUT_INVALID_DIAGNOSIS_2026-11-23 §2). The
 * validation stays all-or-nothing — one bad row invalidates the
 * chunk — but the failure now names which condition rejected the
 * response, so the single repair retry can say what to fix and the
 * step record can carry the kind (never the body) for diagnosis.
 * The final coverage verification is unchanged and remains the
 * fail-closed judge of content.
 */
export type AgentDataParseFailureReason =
  | 'json-not-extractable'
  | 'rows-not-array'
  | 'row-not-object'
  | 'row-key-missing'
  | 'findings-not-array'
  | 'finding-not-object'
  | 'finding-claim-missing'
  | 'text-not-string';

/** The closed set of parse-failure reason tokens, for consumers
 * that validate a recorded reason (the step live detail). */
export const AGENT_DATA_PARSE_FAILURE_REASONS: readonly AgentDataParseFailureReason[] = [
  'json-not-extractable',
  'rows-not-array',
  'row-not-object',
  'row-key-missing',
  'findings-not-array',
  'finding-not-object',
  'finding-claim-missing',
  'text-not-string',
];

export type AgentDataParseResult =
  | { ok: true; output: ChunkOutput }
  | { ok: false; reason: AgentDataParseFailureReason };

export function parseChunkOutputDetailed(
  outputKind: AgentDataOutputKind,
  text: string,
  view: AgentAttachmentDataView,
): AgentDataParseResult {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'json-not-extractable' };
  }
  const record = parsed as Record<string, unknown>;
  const output: ChunkOutput = { rows: [], findings: [], textParts: [], resources: [], remediations: [] };
  if (outputKind === 'rows') {
    if (!Array.isArray(record.rows)) return { ok: false, reason: 'rows-not-array' };
    for (const raw of record.rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'row-not-object' };
      const row: AgentDataRow = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const cell = coerceCell(value);
        if (cell !== null) row[key] = cell;
      }
      const keyValue = row[view.keyField];
      if (typeof keyValue !== 'string' || keyValue.length === 0) return { ok: false, reason: 'row-key-missing' };
      output.rows.push(row);
    }
    return { ok: true, output };
  }
  if (outputKind === 'findings') {
    if (!Array.isArray(record.findings)) return { ok: false, reason: 'findings-not-array' };
    for (const raw of record.findings) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'finding-not-object' };
      const finding = raw as Record<string, unknown>;
      if (typeof finding.claim !== 'string' || !finding.claim.trim()) return { ok: false, reason: 'finding-claim-missing' };
      const type = typeof finding.type === 'string' && finding.type.trim()
        ? finding.type.trim().slice(0, 80)
        : undefined;
      const severity = validFindingSeverity(finding.severity);
      output.findings.push({
        claim: finding.claim.trim(),
        evidence: typeof finding.evidence === 'string' ? finding.evidence.trim().slice(0, 200) : '',
        file: typeof finding.file === 'string' ? finding.file.trim() : '',
        location: typeof finding.location === 'string' ? finding.location.trim() : '',
        ...(type ? { type } : {}),
        ...(severity ? { severity } : {}),
      });
    }
    // Optional structured sections: invalid items are dropped, never
    // allowed to fail the chunk — coverage is judged on findings.
    output.resources = parseAgentDataResources(record.resources);
    output.remediations = parseAgentDataRemediations(record.remediations);
    return { ok: true, output };
  }
  if (typeof record.text !== 'string') return { ok: false, reason: 'text-not-string' };
  output.textParts.push(record.text);
  return { ok: true, output };
}

/**
 * The repair-retry guidance for one parse-failure reason (Basel
 * fix D). The pre-fix repair instruction only said "return JSON",
 * so a response rejected for a missing key field was resubmitted in
 * the same shape and rejected again — the Basel reference chunks,
 * whose fragments hold no key-bearing target at all, could never
 * pass. Each reason now names the concrete defect; the key-missing
 * guidance also states the legitimate empty answer, which the rows
 * instruction itself now carries as well.
 */
export function parseFailureRepairGuidance(
  reason: AgentDataParseFailureReason,
  outputKind: AgentDataOutputKind,
  view: AgentAttachmentDataView,
): string {
  const base = '前回の応答は指定のJSON形式に適合しませんでした。';
  switch (reason) {
    case 'json-not-extractable':
      return `${base}応答からJSONオブジェクトを取り出せませんでした。説明文やコードフェンスを付けず、JSONオブジェクトだけを返してください。`;
    case 'rows-not-array':
      return `${base}rowsが配列になっていませんでした。{"rows":[{...}]}の形で、rowsを配列として返してください。`;
    case 'row-not-object':
      return `${base}rowsの要素がオブジェクトになっていませんでした。各行を{...}のオブジェクトとして返してください。`;
    case 'row-key-missing':
      return `${base}キー項目「${view.keyField}」の空でない文字列値を持たない行がありました。全ての行にキー項目「${view.keyField}」を含めてください。断片内にキー項目を持つ対象が1件も無い場合は {"rows":[]} が正しい応答です。`;
    case 'findings-not-array':
      return `${base}findingsが配列になっていませんでした。{"findings":[{...}]}の形で、findingsを配列として返してください。`;
    case 'finding-not-object':
      return `${base}findingsの要素がオブジェクトになっていませんでした。各所見を{...}のオブジェクトとして返してください。`;
    case 'finding-claim-missing':
      return `${base}claimが空か欠けている所見がありました。全ての所見にclaim（所見の文）を含めてください。`;
    case 'text-not-string':
      return `${base}textが文字列になっていませんでした。{"text":"作成した文章"}の形で返してください。`;
    default:
      return `${base}JSONだけを返してください。`;
  }
}

type PriorBundle = ChunkOutput & {
  /** The predecessor chain's recorded processed-chunk count (its
   * artifact coverage block). The final step of a file-name-key rows
   * run verifies its chain against this count, so a bundle whose
   * coverage block is missing or inconsistent fails that gate
   * closed instead of being trusted. */
  processedChunks?: number;
};

function parsePriorBundle(content: string, outputKind: AgentDataOutputKind, view: AgentAttachmentDataView): PriorBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const bundle = parsed as Record<string, unknown>;
  if (bundle.kind !== 'data-analysis' || bundle.outputKind !== outputKind) return null;
  const prior: PriorBundle = { rows: [], findings: [], textParts: [], resources: [], remediations: [] };
  if (outputKind === 'rows') {
    if (!Array.isArray(bundle.rows)) return null;
    for (const raw of bundle.rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const row: AgentDataRow = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const cell = coerceCell(value);
        if (cell !== null) row[key] = cell;
      }
      if (typeof row[view.keyField] !== 'string' || row[view.keyField].length === 0) return null;
      prior.rows.push(row);
    }
  } else if (outputKind === 'findings') {
    if (!Array.isArray(bundle.findings)) return null;
    for (const raw of bundle.findings) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const finding = raw as Record<string, unknown>;
      if (typeof finding.claim !== 'string') return null;
      const type = typeof finding.type === 'string' && finding.type.trim() ? finding.type.trim() : undefined;
      const severity = validFindingSeverity(finding.severity);
      prior.findings.push({
        claim: finding.claim,
        evidence: typeof finding.evidence === 'string' ? finding.evidence : '',
        file: typeof finding.file === 'string' ? finding.file : '',
        location: typeof finding.location === 'string' ? finding.location : '',
        ...(type ? { type } : {}),
        ...(severity ? { severity } : {}),
      });
    }
    // Structured sections survive the chain the same way findings do;
    // a continuation that dropped them would lose the earlier
    // chunks' resources and remediations from the final bundle.
    prior.resources = parseAgentDataResources(bundle.resources);
    prior.remediations = parseAgentDataRemediations(bundle.remediations);
  } else {
    if (typeof bundle.content !== 'string') return null;
    if (bundle.content.length > 0) prior.textParts.push(bundle.content);
  }
  const coverage = bundle.coverage;
  if (coverage && typeof coverage === 'object' && !Array.isArray(coverage)) {
    const processed = (coverage as Record<string, unknown>).processedChunks;
    if (typeof processed === 'number' && Number.isInteger(processed) && processed >= 0) {
      prior.processedChunks = processed;
    }
  }
  return prior;
}

function renderFindings(findings: readonly AgentDataFinding[]): string {
  return findings.map((finding) => {
    const source = [finding.file, finding.location].filter(Boolean).join(' ');
    const evidence = finding.evidence ? `「${finding.evidence}」` : '';
    return source || evidence ? `- ${finding.claim}（根拠: ${[source, evidence].filter(Boolean).join(' ')}）` : `- ${finding.claim}`;
  }).join('\n');
}

/**
 * attachment_analyzer (design §3.3): the reading comprehension step.
 * Splits the set's texts deterministically (the same chunk list the
 * reader published), calls the model once per chunk in this step's
 * range through the shared failover adapter, merges with the previous
 * analyzer step's bundle when chained, and — on the step that
 * completes the range — verifies coverage deterministically before
 * anything is allowed downstream (§3.5.1). A chunk is never skipped
 * silently: a provider failure fails the step with the provider's own
 * code, and a schema-invalid response gets exactly one repair retry
 * before the step fails with AGENT_DATA_OUTPUT_INVALID (§4.2).
 */
export async function executeAttachmentAnalyzer(
  params: ToolParams,
  context?: AgentAttachmentToolContext,
): Promise<ToolResult> {
  const tool = 'attachment_analyzer' as const;
  const fail = (message: string): ToolResult => ({ ok: false, tool, message });
  const outputKind = typeof params.outputKind === 'string' && (OUTPUT_KINDS as readonly string[]).includes(params.outputKind)
    ? (params.outputKind as AgentDataOutputKind)
    : null;
  if (!outputKind) return fail('AGENT_ATTACHMENT_PARAMS_INVALID');
  const chunkOffset = typeof params.chunkOffset === 'number' && Number.isInteger(params.chunkOffset) && params.chunkOffset >= 0
    ? params.chunkOffset
    : null;
  const chunkCount = typeof params.chunkCount === 'number' && Number.isInteger(params.chunkCount) && params.chunkCount >= 1
    ? Math.min(params.chunkCount, AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP)
    : null;
  if (chunkOffset === null || chunkCount === null) return fail('AGENT_ATTACHMENT_PARAMS_INVALID');
  const goalInstruction = typeof params.instruction === 'string' ? params.instruction : '';
  // Structured-JSON deliverables (design AGENT_ARTIFACT_FORMAT_DESIGN_2026-11-21
  // §3.2): the plan names the report's required top-level keys, and the
  // analyzer's per-chunk shape grows typed findings plus resources and
  // remediations to fill them. A malformed value is treated as absent
  // (plain findings shape) — the document step still assembles from
  // whatever sections the bundle carries, and fails closed if the
  // required keys cannot be filled.
  const structuredJsonKeys = Array.isArray(params.structuredJsonKeys)
    ? (params.structuredJsonKeys as unknown[])
      .filter((key): key is string => typeof key === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      .slice(0, 12)
    : [];

  const loaded = await loadBoundData(tool, params, context);
  if ('failure' in loaded) return loaded.failure;
  const { view } = loaded.data;
  if (chunkOffset >= view.totalChunks) return fail('AGENT_ATTACHMENT_PARAMS_INVALID');
  const range = view.chunks.slice(chunkOffset, chunkOffset + chunkCount);
  const isFinalStep = chunkOffset + range.length >= view.totalChunks;

  let merged: ChunkOutput = { rows: [], findings: [], textParts: [], resources: [], remediations: [] };
  // The predecessor chain's recorded processed-chunk count: 0 for a
  // first step, the prior bundle's coverage count for a continuation,
  // and null when a continuation's bundle carries no count — the
  // file-name-key coverage gate treats null as unverifiable and
  // fails closed.
  let priorProcessedChunks: number | null = chunkOffset === 0 ? 0 : null;
  if (typeof params.content === 'string' && params.content.trim().length > 0) {
    const prior = parsePriorBundle(params.content, outputKind, view);
    if (!prior) return fail('AGENT_DATA_OUTPUT_INVALID');
    merged = prior;
    if (typeof prior.processedChunks === 'number') priorProcessedChunks = prior.processedChunks;
  } else if (chunkOffset > 0) {
    // A continuation step without its predecessor's bundle would
    // silently drop the earlier chunks' work; refuse instead.
    return fail('AGENT_STEP_INPUT_UNAVAILABLE');
  }

  const modelCall = context?.modelCall ?? createAgentModelExecutor(context?.env ?? process.env);
  const sleepMs = context?.sleepMs ?? defaultSleepMs;
  // Transient-retry wrapper (design AGENT_SEGMENT2_WALL_DIAGNOSIS_2026-11-22
  // §6): only provider-availability codes retry, only within this
  // step's cumulative wait ceiling; every other failure — and a
  // transient failure that exhausts its retries — returns exactly
  // the result the pre-retry code returned, so the step fails with
  // the provider's own code as before. The step's declared quota
  // charge is unaffected: retries are inside the step, and the
  // ledger counts the step once.
  let transientWaitMs = 0;
  const callModelWithTransientRetry = async (input: AgentModelCallInput): Promise<AgentModelCallResult> => {
    let result = await modelCall(input);
    for (const delayMs of AGENT_ANALYZER_TRANSIENT_RETRY_DELAYS_MS) {
      if (result.ok !== false || !AGENT_ANALYZER_TRANSIENT_FAILURE_CODES.has(result.code)) break;
      if (transientWaitMs + delayMs > AGENT_ANALYZER_TRANSIENT_RETRY_MAX_STEP_WAIT_MS) break;
      await sleepMs(delayMs);
      transientWaitMs += delayMs;
      result = await modelCall(input);
    }
    return result;
  };
  const instruction = analyzerInstruction(
    outputKind,
    goalInstruction,
    view,
    structuredJsonKeys.length > 0 ? structuredJsonKeys : undefined,
  );
  // Inter-chunk interval (design §2-E): while its switch is on, the
  // sends of one step are spaced by AGENT_ANALYZER_CHUNK_INTERVAL_MS
  // (between chunks only — never before the step's first chunk, and
  // never between a chunk's first call and its repair call, which are
  // one chunk's business). Read from the same env the model executor
  // is built from, so a test's injected env governs both.
  const chunkIntervalOn = agentAnalyzerChunkIntervalEnabled(context?.env ?? process.env);
  let isFirstChunkOfStep = true;
  for (const chunk of range) {
    if (!isFirstChunkOfStep && chunkIntervalOn) await sleepMs(AGENT_ANALYZER_CHUNK_INTERVAL_MS);
    isFirstChunkOfStep = false;
    const userText = chunkModelInput(view, chunk);
    // The chunk's global index rides every call for this chunk —
    // first attempt and repair alike — so the alternating allocation
    // (design §2-C) assigns the chunk deterministically, including
    // across a resume that replays the step.
    const first = await callModelWithTransientRetry({ instruction, userText, goal: goalInstruction, chunkIndex: chunk.index });
    if (first.ok === false) return fail(first.code);
    const firstParsed = parseChunkOutputDetailed(outputKind, first.text, view);
    let output: ChunkOutput | null = firstParsed.ok ? firstParsed.output : null;
    if (firstParsed.ok === false) {
      // Exactly one repair retry (§4.2), now told which validation
      // condition rejected the first response (Basel fix D): the
      // generic "return JSON" wording made a model resubmit the same
      // shape — for a fragment with no key-bearing target, the same
      // failing rows — because nothing named the actual defect.
      const repair = await callModelWithTransientRetry({
        instruction: `${instruction}${parseFailureRepairGuidance(firstParsed.reason, outputKind, view)}`,
        userText,
        goal: goalInstruction,
        chunkIndex: chunk.index,
      });
      if (repair.ok === false) return fail(repair.code);
      const repairParsed = parseChunkOutputDetailed(outputKind, repair.text, view);
      if (repairParsed.ok === false) {
        // Observability (Basel fix, diagnosis §4): the terminal code
        // stays AGENT_DATA_OUTPUT_INVALID — the advancer's code
        // extraction reads the leading token, exactly as it does for
        // the coverage failure below — and the message additionally
        // names the chunk's global index and the parse-failure
        // reason, never the response body, so the step record can
        // say which chunk failed and why.
        return fail(`AGENT_DATA_OUTPUT_INVALID (chunk ${chunk.index}, parse: ${repairParsed.reason})`);
      }
      output = repairParsed.output;
    }
    if (!output) return fail('AGENT_DATA_OUTPUT_INVALID');
    merged.rows.push(...output.rows);
    merged.findings.push(...output.findings);
    merged.textParts.push(...output.textParts);
    // Structured sections merge with dedupe (a resource named in
    // several chunks is one resource; the same remediation proposed
    // twice is one action). Order is first-seen order.
    for (const resource of output.resources) {
      const key = `${resource.kind}|${resource.name}|${resource.namespace}`;
      if (!merged.resources.some((existing) => `${existing.kind}|${existing.name}|${existing.namespace}` === key)) {
        merged.resources.push(resource);
      }
    }
    for (const remediation of output.remediations) {
      if (!merged.remediations.some((existing) => existing.action === remediation.action)) {
        merged.remediations.push(remediation);
      }
    }
  }

  if (isFinalStep && outputKind === 'rows') {
    if (agentDataUsesFileNameKeys(view)) {
      // Prose branch of the coverage gate (design §3.5.1): with no
      // table key, the yardstick is the deterministic processed
      // chunk range — the predecessor chain's recorded count plus
      // this step's range must equal the set's total, and the merged
      // rows must not be empty. The old file-name key multiset asked
      // independent per-chunk calls to emit each file name exactly
      // once, which a multi-chunk file makes unsatisfiable.
      const processedChunks = priorProcessedChunks === null ? -1 : priorProcessedChunks + range.length;
      const chunkCoverage = verifyAgentDataChunkCoverage(view, processedChunks, merged.rows.length);
      if (chunkCoverage.ok === false) {
        return fail(`AGENT_DATA_COVERAGE_INSUFFICIENT (対象${chunkCoverage.expectedChunks}チャンク中${Math.max(0, chunkCoverage.processedChunks)}チャンクを処理、行${chunkCoverage.rowCount}件)`);
      }
    } else {
      const coverage = verifyAgentDataCoverage(view, merged.rows);
      if (coverage.ok === false) {
        return fail(`AGENT_DATA_COVERAGE_INSUFFICIENT (対象${coverage.expected}件中${coverage.covered}件を処理、未処理${coverage.missing.length}件、重複${coverage.duplicated.length}件、対象外${coverage.unexpected.length}件、数値不一致${coverage.numericMismatch.length}件)`);
      }
    }
  }

  const content = outputKind === 'rows'
    ? renderAgentDataRowsCsv(view, merged.rows)
    : outputKind === 'findings'
      ? renderFindings(merged.findings)
      : merged.textParts.join('\n\n');
  const artifact = JSON.stringify({
    kind: 'data-analysis',
    content,
    outputKind,
    ...(outputKind === 'rows' ? { rows: merged.rows } : {}),
    ...(outputKind === 'findings' ? { findings: merged.findings } : {}),
    // Structured sections ride the bundle only when the plan asked
    // for them; other runs keep the previous bundle shape.
    ...(outputKind === 'findings' && structuredJsonKeys.length > 0
      ? { resources: merged.resources, remediations: merged.remediations }
      : {}),
    ...(outputKind === 'rows' && Object.keys(view.aggregates).length > 0 ? { aggregates: view.aggregates } : {}),
    coverage: {
      totalChunks: view.totalChunks,
      processedChunks: chunkOffset + range.length,
      ...(outputKind === 'rows' && !agentDataUsesFileNameKeys(view) ? { keyCount: view.expectedKeys.length } : {}),
    },
    chunkRange: { offset: chunkOffset, count: range.length },
  });
  return {
    ok: true,
    tool,
    artifact,
    message: `Attachment data analyzed (${chunkOffset + range.length}/${view.totalChunks} chunk(s)).`,
  };
}
