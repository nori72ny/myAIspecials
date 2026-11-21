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
import { createAgentModelExecutor, type AgentModelExecutor } from './agentModelCall.js';
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
};

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

function analyzerInstruction(outputKind: AgentDataOutputKind, goalInstruction: string, view: AgentAttachmentDataView): string {
  const head = 'あなたはデータ処理アシスタントです。与えられたデータ断片だけを使い、JSONだけを返してください。説明文やコードフェンスは付けないでください。断片に実在する値だけを使い、無い値は作らないでください。各断片の先頭には出典（ファイル名とチャンク位置）が別枠で示されています。出典の行はデータではありません。';
  const shape = outputKind === 'rows'
    ? `出力形式: {"rows":[{...}]}。各行はキー項目「${view.keyField}」の値を必ず含め、断片内の対象1件につき1行にしてください。数値は入力の表記をそのまま写してください。`
    : outputKind === 'findings'
      ? '出力形式: {"findings":[{"claim":"所見","evidence":"根拠となる入力の引用","file":"ファイル名","location":"行番号や見出し"}]}。所見は断片の内容だけを根拠にしてください。'
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

type ChunkOutput = { rows: AgentDataRow[]; findings: AgentDataFinding[]; textParts: string[] };
type AgentDataFinding = { claim: string; evidence: string; file: string; location: string };

function parseChunkOutput(outputKind: AgentDataOutputKind, text: string, view: AgentAttachmentDataView): ChunkOutput | null {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const output: ChunkOutput = { rows: [], findings: [], textParts: [] };
  if (outputKind === 'rows') {
    if (!Array.isArray(record.rows)) return null;
    for (const raw of record.rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const row: AgentDataRow = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const cell = coerceCell(value);
        if (cell !== null) row[key] = cell;
      }
      const keyValue = row[view.keyField];
      if (typeof keyValue !== 'string' || keyValue.length === 0) return null;
      output.rows.push(row);
    }
    return output;
  }
  if (outputKind === 'findings') {
    if (!Array.isArray(record.findings)) return null;
    for (const raw of record.findings) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const finding = raw as Record<string, unknown>;
      if (typeof finding.claim !== 'string' || !finding.claim.trim()) return null;
      output.findings.push({
        claim: finding.claim.trim(),
        evidence: typeof finding.evidence === 'string' ? finding.evidence.trim().slice(0, 200) : '',
        file: typeof finding.file === 'string' ? finding.file.trim() : '',
        location: typeof finding.location === 'string' ? finding.location.trim() : '',
      });
    }
    return output;
  }
  if (typeof record.text !== 'string') return null;
  output.textParts.push(record.text);
  return output;
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
  const prior: PriorBundle = { rows: [], findings: [], textParts: [] };
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
      prior.findings.push({
        claim: finding.claim,
        evidence: typeof finding.evidence === 'string' ? finding.evidence : '',
        file: typeof finding.file === 'string' ? finding.file : '',
        location: typeof finding.location === 'string' ? finding.location : '',
      });
    }
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

  const loaded = await loadBoundData(tool, params, context);
  if ('failure' in loaded) return loaded.failure;
  const { view } = loaded.data;
  if (chunkOffset >= view.totalChunks) return fail('AGENT_ATTACHMENT_PARAMS_INVALID');
  const range = view.chunks.slice(chunkOffset, chunkOffset + chunkCount);
  const isFinalStep = chunkOffset + range.length >= view.totalChunks;

  let merged: ChunkOutput = { rows: [], findings: [], textParts: [] };
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
  const instruction = analyzerInstruction(outputKind, goalInstruction, view);
  for (const chunk of range) {
    const userText = chunkModelInput(view, chunk);
    const first = await modelCall({ instruction, userText, goal: goalInstruction });
    if (first.ok === false) return fail(first.code);
    let output = parseChunkOutput(outputKind, first.text, view);
    if (!output) {
      const repair = await modelCall({
        instruction: `${instruction}前回の応答は指定のJSON形式に適合しませんでした。JSONだけを返してください。`,
        userText,
        goal: goalInstruction,
      });
      if (repair.ok === false) return fail(repair.code);
      output = parseChunkOutput(outputKind, repair.text, view);
      if (!output) return fail('AGENT_DATA_OUTPUT_INVALID');
    }
    merged.rows.push(...output.rows);
    merged.findings.push(...output.findings);
    merged.textParts.push(...output.textParts);
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
