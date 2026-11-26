import {
  computeAgentAttachmentSetDigest,
  type AgentAttachmentSetRecord,
  type AgentAttachmentStore,
} from './agentAttachmentRecord.js';
import {
  agentDataUsesFileNameKeys,
  applyAgentDataNumericCopy,
  buildAgentAttachmentDataView,
  clipAgentAttachmentInstruction,
  findMissingAgentDataRequiredColumns,
  renderAgentDataRowsCsv,
  verifyAgentDataChunkCoverage,
  verifyAgentDataCoverage,
  verifyAgentDataLocalCoverage,
  AGENT_ATTACHMENT_INSTRUCTION_MAX_CHARS,
  AGENT_ATTACHMENT_INSTRUCTION_TOTAL_MAX_CHARS,
  AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP,
  type AgentAttachmentDataView,
  type AgentDataChunk,
  type AgentDataCoverageResult,
  type AgentDataRow,
} from './agentAttachmentData.js';
import { createAgentModelExecutor, MAX_AGENT_MODEL_CALL_TIMINGS_PER_STEP, type AgentModelCallInput, type AgentModelCallTiming, type AgentModelExecutor, type AgentModelCallResult } from './agentModelCall.js';
import { buildAgentReferenceContext } from './agentAttachmentReference.js';
import { parseBaselBiaInputs } from './agentBaselBia.js';
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

export const ORIGIN_AGENT_FINDINGS_RECONCILIATION_ENABLED_ENV = 'ORIGIN_AGENT_FINDINGS_RECONCILIATION_ENABLED' as const;

export type AgentFindingsReconciliationMode = 'off' | 'shadow' | 'enforce';

/** The findings-reconciliation switch (design
 * AGENT_MA_MISREADING_COUNTERMEASURE_2026-11-23 §2 layer 2), in the
 * staged-rollout house style (I-5 premise guard, answer
 * verification): only the exact strings "shadow" and "enforce"
 * select those modes; anything else — including the variable being
 * unregistered — is OFF. OFF is the pre-measure behavior exactly:
 * the planner issues no reconciler step and the analyzers carry no
 * audit sections, so plans and bundles stay byte-identical. Shadow
 * runs the reconciliation and records its vetted list and counts in
 * the bundle while the deliverable remains the unreconciled one;
 * enforce makes the vetted list the deliverable. */
export function agentFindingsReconciliationMode(env: NodeJS.ProcessEnv): AgentFindingsReconciliationMode {
  const value = env[ORIGIN_AGENT_FINDINGS_RECONCILIATION_ENABLED_ENV];
  return value === 'shadow' || value === 'enforce' ? value : 'off';
}

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
  /** The set's file texts, in set order — the same bodies the view
   * was built from. Carried for the deterministic consumers that
   * need whole files rather than chunks: the reference-context
   * builder (対策5) and the BIA parameter read (対策6). */
  files: readonly { name: string; text: string }[];
};

async function loadBoundData(
  tool: 'attachment_reader' | 'attachment_analyzer' | 'attachment_reconciler',
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
  return { data: { set, view: buildAgentAttachmentDataView(files), files } };
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

/**
 * The controlled attribute vocabulary of the audit value table
 * (failure diagnosis 2026-11-24, 対策3). The deterministic
 * candidate computation groups the table by (entity, attribute),
 * and the attribute is a label each independent chunk call writes
 * on its own: with free wording, the same attribute named two ways
 * never groups, and the cross-document comparison the audit exists
 * for silently produces zero candidates — the production M&A run
 * recorded candidateCount 0 even for the one pair the analyzer HAD
 * caught as a finding. The audit contract therefore names the
 * vocabulary and requires the label be chosen from it.
 */
export const AGENT_AUDIT_ATTRIBUTE_VOCABULARY: readonly string[] = [
  '金額',
  '株数',
  '比率・持分',
  '資金源泉',
  '日付',
  '主体名',
];

/**
 * Deterministic attribute canonicalization (function inspection
 * 2026-11-25, D2). 対策3 named the vocabulary in the audit
 * contract, but the deterministic side grouped the value table by
 * the label each chunk happened to write, so the same attribute
 * named two ways — 対価 vs 金額, 持分 vs 持株比率, 資金源泉 vs
 * funding source — never grouped, and the cross-document
 * candidates the audit exists for silently stayed unraised for
 * two of the three verified M&A pairs whenever a chunk strayed
 * from the vocabulary wording. The grouping key is now the
 * canonical vocabulary label: a written label folds (NFKC, case,
 * separators) and maps through the closed alias table below; a
 * label that maps to nothing does not pair at all — the pairing
 * contract is that a finding's pair stands in the table under
 * one controlled label, and a label outside the vocabulary is
 * not one. The alias table is deliberately closed: a synonym is
 * added here, never guessed at runtime.
 */
const AGENT_AUDIT_ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  '対価': '金額', '对价': '金額', '購入価格': '金額', '売買代金': '金額', '代金': '金額',
  '価格': '金額', '取引金額': '金額', '対価金額': '金額', '譲渡価格': '金額',
  'consideration': '金額', 'price': '金額', 'amount': '金額',
  'purchase price': '金額', 'transaction amount': '金額',
  '数量': '株数', '個数': '株数', '株式数': '株数',
  'quantity': '株数', 'count': '株数', 'number of shares': '株数', 'share count': '株数',
  '持分': '比率・持分', '持株比率': '比率・持分', '持股比例': '比率・持分',
  '出資比率': '比率・持分', '株式割合': '比率・持分', '持ち分': '比率・持分',
  '割合': '比率・持分', '比率': '比率・持分', '持分割合': '比率・持分', '出資割合': '比率・持分',
  'stake': '比率・持分', 'shareholding': '比率・持分', 'shareholding ratio': '比率・持分',
  'equity share': '比率・持分', 'ratio': '比率・持分',
  '资金来源': '資金源泉', '資金調達': '資金源泉', '資金調達方法': '資金源泉', '調達方法': '資金源泉',
  'funding source': '資金源泉', 'source of funds': '資金源泉', 'funding': '資金源泉',
  '期日': '日付', '年月日': '日付', 'date': '日付',
  '名称': '主体名', '会社名': '主体名', '名前': '主体名', '当事者名': '主体名',
  'entity name': '主体名', 'name': '主体名',
};

function foldAgentDataAttributeLabel(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase().replace(/[\s・/]/g, '');
}

const AGENT_AUDIT_ATTRIBUTE_BY_FOLDED_LABEL: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const label of AGENT_AUDIT_ATTRIBUTE_VOCABULARY) {
    map.set(foldAgentDataAttributeLabel(label), label);
  }
  for (const [alias, canonical] of Object.entries(AGENT_AUDIT_ATTRIBUTE_ALIASES)) {
    map.set(foldAgentDataAttributeLabel(alias), canonical);
  }
  return map;
})();

/** The canonical controlled-vocabulary label of a written
 * attribute label, or undefined when the label is outside the
 * vocabulary and its aliases — such a label never pairs. */
export function canonicalAgentDataAttribute(raw: string): string | undefined {
  if (!raw) return undefined;
  return AGENT_AUDIT_ATTRIBUTE_BY_FOLDED_LABEL.get(foldAgentDataAttributeLabel(raw));
}

/**
 * The closed set of value scopes (C2, diagnosis 2026-11-26):
 * a holding's range — before or after the transaction. Only
 * these two strings are ever a scope; anything else is not one
 * (fail closed: an unknown qualifier states no scope).
 */
export const AGENT_DATA_VALUE_SCOPES: readonly string[] = ['交易前', '交易后'];

/**
 * The scope a written attribute label states, from its trailing
 * qualifier — `持股比例（交易前）` states 交易前, `持股数量
 * （变动后）` states 交易后. A label without a known qualifier
 * states no scope. The qualifier is read, never invented: a
 * label whose qualifier is outside the closed set has none.
 */
export function agentDataValueScopeFromQualifier(raw: string): string | undefined {
  const text = raw.normalize('NFKC').trim();
  const match = /[（(]([^（）()]+)[）)]\s*$/.exec(text);
  if (!match) return undefined;
  const qualifier = match[1].trim();
  if (/交易前|变动前/.test(qualifier)) return '交易前';
  if (/交易后|变动后/.test(qualifier)) return '交易后';
  return undefined;
}

/**
 * The canonical attribute of a written label together with the
 * scope its trailing qualifier states: the qualifier is stripped
 * before the vocabulary lookup, so `持股比例（交易前）` is the
 * 比率・持分 attribute in the 交易前 scope instead of a label
 * outside the vocabulary that could never pair.
 */
function canonicalAgentDataAttributeAndScope(raw: string): {
  canonicalAttribute: string | undefined;
  scope: string | undefined;
} {
  const scope = agentDataValueScopeFromQualifier(raw);
  const base = scope !== undefined
    ? raw.normalize('NFKC').trim().replace(/[（(][^（）()]+[）)]\s*$/, '').trim()
    : raw;
  return { canonicalAttribute: canonicalAgentDataAttribute(base), scope };
}

/**
 * The effective scope of one table value: the scope recorded at
 * extraction, else the scope its attribute label's qualifier
 * states, else none. A recorded scope outside the closed set is
 * not one — the qualifier is the only fallback, never a guess.
 */
export function agentDataValueEffectiveScope(entry: AgentDataValue): string | undefined {
  if (entry.scope && AGENT_DATA_VALUE_SCOPES.includes(entry.scope)) return entry.scope;
  return agentDataValueScopeFromQualifier(entry.attribute);
}

function analyzerInstruction(
  outputKind: AgentDataOutputKind,
  goalInstruction: string,
  view: AgentAttachmentDataView,
  structuredJsonKeys?: readonly string[],
  auditMode = false,
  hasReferenceContext = false,
): string {
  const head = 'あなたはデータ処理アシスタントです。与えられたデータ断片だけを使い、JSONだけを返してください。説明文やコードフェンスは付けないでください。断片に実在する値だけを使い、無い値は作らないでください。各断片の先頭には出典（ファイル名とチャンク位置）が別枠で示されています。出典の行はデータではありません。';
  // The rows contract names its target table when the set has one
  // (Basel segment-2 fix, 案1): until now nothing told the model
  // that the schema/sample and reference files in the chunk list
  // are not extraction targets, so a literal reading of the
  // instruction made the schema's sample rows — which carry the key
  // field — a correct answer for their chunk. The provenance frame
  // already names each chunk's file; this sentence lets the model
  // use it. The deterministic side of the contract (non-primary
  // rows are discarded, never merged) is in
  // executeAttachmentAnalyzer below.
  const rowsTarget = view.primaryFileName
    ? `対象はファイル「${view.primaryFileName}」の行だけです。他のファイルは参照用ですので、その行を出力しないでください。`
    : '';
  // Required output columns (failure diagnosis 2026-11-24, 対策4):
  // when the set carries an output schema, its columns are named
  // here as mandatory per-row output — the contract half of the
  // measure whose gate half is the final-step check in
  // executeAttachmentAnalyzer. Until now nothing named the derived
  // columns the task required, so the model was never asked for
  // them in any form it could answer.
  const rowsRequiredColumns = view.requiredOutputColumns && view.requiredOutputColumns.length > 0
    ? `各行には次の列を必ず含め、空にしないでください: ${view.requiredOutputColumns.join(', ')}。`
    : '';
  // Reference context (failure diagnosis 2026-11-24, 対策5): the
  // primary-table chunks of a rows run carry the set's definition
  // tables as a reference block after the fragment (see
  // chunkModelInput). The contract names it for what it is —
  // definitions to classify BY, never rows to output — so the
  // co-location cannot be misread as more extraction targets.
  const rowsReferenceNote = hasReferenceContext
    ? '断片の後には分類の定義（参照ブロック）が付きます。参照は分類の根拠として使い、その行を出力しないでください。'
    : '';
  const baseShape = outputKind === 'rows'
    ? `出力形式: {"rows":[{...}]}。各行はキー項目「${view.keyField}」の値を必ず含め、断片内の対象1件につき1行にしてください。${rowsTarget}${rowsRequiredColumns}${rowsReferenceNote}数値は入力の表記をそのまま写してください。断片内にキー項目を持つ対象が1件も無い場合は {"rows":[]} とだけ返してください。それが正しい応答です。`
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
  // Audit mode (misreading countermeasure design §2, layers 1 and
  // 3): the finding shape grows the explanation and the pair's
  // second citation, and the chunk also reports the layer-1 value
  // table and structure map on the SAME call — no extra model call.
  // The wording is kept short on purpose: head + shape + this
  // addition must leave room for the goal inside
  // AGENT_ATTACHMENT_INSTRUCTION_TOTAL_MAX_CHARS (with the plain
  // findings shape the goal still gets its full
  // AGENT_ATTACHMENT_INSTRUCTION_MAX_CHARS clip).
  // The three closing rules name the read-stage dropouts the
  // agent specialist measured on failed run-f0d306fe (function
  // inspection 2026-11-25): a stake held inside an entity, a
  // checkbox-selected disclosure, and an entity written as a
  // role word were present in the sources yet never reached the
  // value table, so the deterministic pairing never saw them.
  const auditShape = auditMode && outputKind === 'findings'
    ? `監査: 各所見にexplanation（なぜ矛盾か）と対の2番目の引用evidenceB・fileB・locationBも付けること。加えて比較可能な値と文書構造を {"values":[{"entity":"主体","attribute":"属性","value":"原文の値","normalizedValue":"正規化値","file":"ファイル名","location":"場所"}],"structure":{"agreements":[{"name":"合意名","parties":[{"name":"当事者","role":"役割"}]}],"definitions":[{"short":"略称","full":"正式名","file":"ファイル名","location":"場所"}]}} の形で返すこと。値テーブルの属性は統制語彙（${AGENT_AUDIT_ATTRIBUTE_VOCABULARY.join('／')}）から選ぶこと。所見として挙げた食い違いのペアは、同じ主体・同じ属性ラベルで値テーブルにも必ず入れること。合伙份额・出資比率など主体の中での持分は、持分を持つ主体の名称をentityにして報告すること。チェックボックスで選択された開示（資金源泉の「√自有资金」など）も値として報告すること。entityは役割語（情報披露義務人など）でなく当事者の名称で書くこと。`
    : '';
  const shape = baseShape + auditShape;
  const budget = AGENT_ATTACHMENT_INSTRUCTION_TOTAL_MAX_CHARS - head.length - shape.length - '依頼: '.length;
  // The runtime clip preserves the deliverable specification the
  // same way the plan-time clip does (対策2): a plain slice here
  // would re-drop the outputs section the planner preserved
  // whenever the fixed template leaves less than the plan cap.
  const clipped = clipAgentAttachmentInstruction(
    goalInstruction,
    Math.max(0, Math.min(AGENT_ATTACHMENT_INSTRUCTION_MAX_CHARS, budget)),
  );
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
function chunkModelInput(view: AgentAttachmentDataView, chunk: AgentDataChunk, referenceContext = ''): string {
  const framed = `【出典: ${chunk.fileName}（チャンク ${chunk.index + 1}/${view.totalChunks}）】\n${chunk.text}`;
  // Reference co-location (対策5): only the primary table's chunks
  // gain the definition tables — they are the calls that classify.
  // Reference-file chunks keep their bare framed form (their rows
  // are discarded under the primary-table contract anyway), and a
  // set without reference tables passes '' and stays byte-identical.
  if (referenceContext && chunk.fileName === view.primaryFileName) {
    return `${framed}\n${referenceContext}`;
  }
  return framed;
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
  /** Layer-1 audit sections (design
   * AGENT_MA_MISREADING_COUNTERMEASURE_2026-11-23 §2 C-1/C-2): the
   * comparable values and the document structure the chunks report.
   * Only populated in audit mode, and the bundle only carries them
   * in audit mode, so non-audit bundles keep their previous shape
   * byte for byte. */
  values: AgentDataValue[];
  structure: AgentDataStructure;
};
type AgentDataFinding = {
  claim: string;
  evidence: string;
  file: string;
  location: string;
  /** Why the pair of citations is inconsistent (layer 3 of the
   * misreading countermeasure design). Optional in the schema —
   * required only in audit mode, where its absence is a parse
   * failure — because outside audit mode a finding is exactly the
   * pre-extension shape. */
  explanation?: string;
  /** The second citation of the finding's pair (layer 3): the other
   * document (or the other passage) whose value disagrees with
   * `evidence`. Optional outside the reconciliation output, whose
   * pairing discipline requires both citations. */
  evidenceB?: string;
  fileB?: string;
  locationB?: string;
  /** Short classification label (e.g. "OOMKilled"); optional — the
   * document assembler defaults it. */
  type?: string;
  /** One of critical/high/medium/low; optional — invalid or absent
   * values default at assembly. */
  severity?: string;
  /** How this finding entered the list when no model wrote it:
   * 'deterministic-candidate' marks a finding the deterministic
   * candidate pickup (gate diagnosis 2026-11-26, 案B) synthesized
   * from a layer-1 value-mismatch candidate after the pair gate,
   * so the record can always tell machine-assembled findings
   * from model-written ones. Absent for model-derived findings. */
  origin?: 'deterministic-candidate';
};
type AgentDataResource = { kind: string; name: string; namespace: string };
type AgentDataRemediation = { action: string; priority?: string };

/**
 * One comparable value a chunk reports (layer 1, C-1): a quantity,
 * date, ratio or classification stated for one entity's one
 * attribute, with the citation it came from. Extraction rides the
 * existing per-chunk call; the deterministic side normalizes and
 * cross-checks these, never the model.
 */
export type AgentDataValue = {
  entity: string;
  attribute: string;
  value: string;
  /** The model's own normalization, when it could write one. The
   * deterministic grouping prefers its own normalization of `value`
   * and only falls back to this — a model-written key is never the
   * primary anchor. */
  normalizedValue?: string;
  file: string;
  location: string;
  /** The value's scope when the extraction states one (C2): one
   * of AGENT_DATA_VALUE_SCOPES — a holding before or after the
   * transaction. Absent when the source states none; the
   * candidate computation then reads the attribute label's
   * qualifier, if it states one. */
  scope?: string;
};

/** One abbreviation definition a chunk reports (layer 1, C-2). */
export type AgentDataStructureDefinition = { short: string; full: string; file: string; location: string };
export type AgentDataStructureAgreement = { name: string; parties: { name: string; role: string }[] };
/**
 * The document structure map (layer 1, C-2): which agreements exist
 * and who their parties are, and which short names the documents
 * themselves define. Merged deterministically across chunks. It is
 * reconciliation material and observability only — never a gate —
 * because its extraction is model work and can be wrong.
 */
export type AgentDataStructure = {
  agreements: AgentDataStructureAgreement[];
  definitions: AgentDataStructureDefinition[];
};

/**
 * One deterministic value-mismatch candidate (layer 1, C-1): an
 * (entity, attribute) group whose normalized values disagree. A
 * candidate is NOT a finding — nothing surfaces it as one; it is
 * the reconciliation step's input, and the pairing discipline
 * there decides which candidates become findings.
 */
export type AgentDataValueMismatch = {
  entity: string;
  attribute: string;
  values: { value: string; normalizedValue: string; file: string; location: string }[];
};

/** Candidate ceiling: a noisy extraction must not flood the
 * reconciliation input (or the bundle) without bound. */
export const AGENT_DATA_VALUE_MISMATCH_MAX = 200;
const AGENT_DATA_VALUE_MISMATCH_VALUES_MAX = 8;

const emptyAgentDataStructure = (): AgentDataStructure => ({ agreements: [], definitions: [] });

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

function trimmedAuditText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Tolerant parser for the layer-1 `values` section, in the same
 * style as the resources/remediations parsers: an item missing its
 * entity, attribute or value is dropped, never allowed to fail the
 * chunk — the value table is reconciliation material, and its
 * judgment happens deterministically at mismatch computation.
 */
export function parseAgentDataValues(raw: unknown): AgentDataValue[] {
  if (!Array.isArray(raw)) return [];
  const values: AgentDataValue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const entity = trimmedAuditText(record.entity, 120);
    const attribute = trimmedAuditText(record.attribute, 120);
    const value = trimmedAuditText(record.value, 200);
    if (!entity || !attribute || !value) continue;
    const normalizedValue = trimmedAuditText(record.normalizedValue, 200);
    // Scope is one of the closed set only; anything else is
    // dropped, never trusted as a grouping dimension.
    const scope = trimmedAuditText(record.scope, 20);
    values.push({
      entity,
      attribute,
      value,
      ...(normalizedValue ? { normalizedValue } : {}),
      file: trimmedAuditText(record.file, 200),
      location: trimmedAuditText(record.location, 200),
      ...(scope && AGENT_DATA_VALUE_SCOPES.includes(scope) ? { scope } : {}),
    });
  }
  return values;
}

/** Tolerant parser for the layer-1 `structure` section. */
export function parseAgentDataStructure(raw: unknown): AgentDataStructure {
  const structure = emptyAgentDataStructure();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structure;
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.agreements)) {
    for (const item of record.agreements) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const agreement = item as Record<string, unknown>;
      const name = trimmedAuditText(agreement.name, 120);
      if (!name) continue;
      const parties: { name: string; role: string }[] = [];
      if (Array.isArray(agreement.parties)) {
        for (const rawParty of agreement.parties) {
          if (!rawParty || typeof rawParty !== 'object' || Array.isArray(rawParty)) continue;
          const party = rawParty as Record<string, unknown>;
          const partyName = trimmedAuditText(party.name, 120);
          if (!partyName) continue;
          parties.push({ name: partyName, role: trimmedAuditText(party.role, 80) });
        }
      }
      structure.agreements.push({ name, parties });
    }
  }
  if (Array.isArray(record.definitions)) {
    for (const item of record.definitions) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const definition = item as Record<string, unknown>;
      const short = trimmedAuditText(definition.short, 120);
      const full = trimmedAuditText(definition.full, 200);
      if (!short || !full) continue;
      structure.definitions.push({
        short,
        full,
        file: trimmedAuditText(definition.file, 200),
        location: trimmedAuditText(definition.location, 200),
      });
    }
  }
  return structure;
}

/**
 * Deterministic value normalization (layer 1, C-1): full-width →
 * half-width (NFKC), ISO dates from `YYYY/MM/DD`-style forms, and a
 * canonical numeric form (commas and spaces removed, a trailing
 * `%` removed, a zero-only fraction dropped, leading zeros folded)
 * so the same quantity written two ways compares equal —
 * `146,660,332.00` and `146660332` are one value, `45%` and `45.0`
 * are one value. Anything that is neither a date nor a number is
 * NOT normalized (undefined): classification values （自有資金 vs
 * 一部銀行借入） compare by their NFKC text instead, which is the
 * reconciliation model's material, not a deterministic verdict.
 */
export function normalizeAgentDataValueText(raw: string): string | undefined {
  const text = raw.normalize('NFKC').trim();
  if (!text) return undefined;
  const date = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (date) {
    const month = Number(date[2]);
    const day = Number(date[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return `${date[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const ymd = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text);
  if (ymd) {
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return `${ymd[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const numeric = text.replace(/[,\s]/g, '').replace(/%$/, '');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(numeric)) return undefined;
  const [intPart, fracPart] = numeric.split('.');
  const intCanonical = intPart.replace(/^([+-]?)0+(?=\d)/, '$1');
  const fracCanonical = (fracPart ?? '').replace(/0+$/, '');
  return fracCanonical ? `${intCanonical}.${fracCanonical}` : intCanonical;
}

/**
 * The deterministic structure merge (layer 1, C-2), first-seen
 * like the resources merge: agreements unite by name (their
 * parties by name + role), definitions by short + full.
 */
export function mergeAgentDataStructures(
  base: AgentDataStructure,
  extra: AgentDataStructure,
): AgentDataStructure {
  const agreements: AgentDataStructureAgreement[] = base.agreements.map((agreement) => ({
    name: agreement.name,
    parties: agreement.parties.map((party) => ({ ...party })),
  }));
  for (const agreement of extra.agreements) {
    const existing = agreements.find((candidate) => candidate.name === agreement.name);
    if (!existing) {
      agreements.push({ name: agreement.name, parties: agreement.parties.map((party) => ({ ...party })) });
      continue;
    }
    for (const party of agreement.parties) {
      if (!existing.parties.some((candidate) => candidate.name === party.name && candidate.role === party.role)) {
        existing.parties.push({ ...party });
      }
    }
  }
  const definitions = base.definitions.map((definition) => ({ ...definition }));
  for (const definition of extra.definitions) {
    if (!definitions.some((candidate) => candidate.short === definition.short && candidate.full === definition.full)) {
      definitions.push({ ...definition });
    }
  }
  return { agreements, definitions };
}

/**
 * Resolves an entity name through the structure map's definitions
 * (layer 1, C-2 (a)): a name the documents define as an abbreviation
 * groups under its full form, so the same party named two ways is
 * one entity in the value table. An unresolvable name stays as it
 * is — the resolver never guesses two names together.
 */
export function resolveAgentDataEntity(entity: string, structure: AgentDataStructure): string {
  const key = entity.normalize('NFKC').trim();
  if (!key) return key;
  const definition = structure.definitions.find(
    (candidate) => candidate.short.normalize('NFKC').trim() === key,
  );
  return definition ? definition.full.normalize('NFKC').trim() : key;
}

/**
 * The closed set of unit decorations a reported value may carry
 * (D2): one trailing unit word （元・円・株…) and/or one leading
 * 約 or currency symbol. Stripping is only ever a retry — the
 * remainder must then normalize as a whole — so a sentence that
 * merely contains a number is never reduced to one.
 */
const AGENT_DATA_VALUE_UNIT_SUFFIXES: readonly string[] = [
  'USD', 'CNY', 'JPY', 'EUR', '元', '円', 'ドル', 'ユーロ', '株', '個', '件', '名', '人',
];
const AGENT_DATA_VALUE_UNIT_PREFIXES: readonly string[] = ['約', '¥', '$', '€'];

function stripAgentDataValueUnit(text: string): string {
  let out = text;
  for (const prefix of AGENT_DATA_VALUE_UNIT_PREFIXES) {
    if (out.startsWith(prefix)) {
      out = out.slice(prefix.length).trim();
      break;
    }
  }
  for (const suffix of AGENT_DATA_VALUE_UNIT_SUFFIXES) {
    if (out.length > suffix.length && out.toUpperCase().endsWith(suffix.toUpperCase())) {
      out = out.slice(0, out.length - suffix.length).trim();
      break;
    }
  }
  return out;
}

/**
 * The deterministic typed reading of one reported value (D2):
 * the whole-text normalization, retried once with a unit
 * decoration stripped — `146,660,323.00元` is the amount
 * 146660323, `45％` is the ratio 45, `2024年3月31日` is the date
 * 2024-03-31. A value that is neither a quantity nor a date has
 * no typed reading (undefined).
 */
function normalizeAgentDataTypedValue(raw: string): string | undefined {
  const direct = normalizeAgentDataValueText(raw);
  if (direct !== undefined) return direct;
  const text = raw.normalize('NFKC').trim();
  if (!text) return undefined;
  const stripped = stripAgentDataValueUnit(text);
  return stripped !== text ? normalizeAgentDataValueText(stripped) : undefined;
}

/**
 * The deterministic reading of a funding-source value (D2): the
 * composition of funding the text states, as a sorted component
 * set. Two writings of the same composition — 自有资金 and
 * 自己資金のみ, self-funded only — read equal; a composition
 * that adds bank borrowing — 自有資金及银行借款, partly bank
 * loans — reads different, so the pair is raised (or not)
 * regardless of the language or wording each document used. A
 * text stating no known component is not read this way at all
 * (undefined): a composition is claimed only from markers
 * actually present, and a raised candidate remains material for
 * the reconciliation's judgment, never a verdict by itself.
 */
const AGENT_DATA_FUNDING_COMPONENTS: readonly { component: string; markers: readonly string[] }[] = [
  { component: 'bank', markers: ['銀行', '借款', '借入', 'ローン', 'bank', 'loan', 'borrowing'] },
  { component: 'self', markers: ['自有', '自己資金', '自己资金', 'selffunded', 'ownfunds'] },
];

export function canonicalAgentDataFundingKey(raw: string): string | undefined {
  const folded = raw.normalize('NFKC').trim().toLowerCase().replace(/[\s-]/g, '');
  if (!folded) return undefined;
  const components = AGENT_DATA_FUNDING_COMPONENTS
    .filter(({ markers }) => markers.some((marker) => folded.includes(marker)))
    .map(({ component }) => component)
    .sort();
  return components.length > 0 ? `funding:${components.join('+')}` : undefined;
}

/** The comparison key of one reported value: the deterministic
 * typed reading of the raw value first (amounts, ratios and
 * dates read across writings and unit decorations), for a
 * funding-source value its stated composition, then the model's
 * own normalizedValue read the same two ways, and only then the
 * NFKC text itself (classification values whose disagreement is
 * real but not deterministically decidable). */
function effectiveAgentDataValue(entry: AgentDataValue, canonicalAttribute: string | undefined): string {
  const typed = normalizeAgentDataTypedValue(entry.value);
  if (typed !== undefined) return typed;
  if (canonicalAttribute === '資金源泉') {
    const funding = canonicalAgentDataFundingKey(entry.value);
    if (funding !== undefined) return funding;
  }
  if (entry.normalizedValue) {
    const modelTyped = normalizeAgentDataTypedValue(entry.normalizedValue);
    if (modelTyped !== undefined) return modelTyped;
    if (canonicalAttribute === '資金源泉') {
      const modelFunding = canonicalAgentDataFundingKey(entry.normalizedValue);
      if (modelFunding !== undefined) return modelFunding;
    }
  }
  return entry.value.normalize('NFKC').trim();
}

/**
 * The grouping key of one table value (C2, diagnosis 2026-11-26):
 * (resolved entity, canonical attribute, scope). Two values pair
 * only within one scope — a pre-transaction holding never pairs
 * with a post-transaction one. And identification through an
 * abbreviation is only a grouping when the scope is stated and
 * equal: a value whose entity resolved through a definition, with
 * no scope stated, groups only with the identical raw name, so a
 * row the model mis-attributed to a prose name cannot ride the
 * abbreviation into another holder's group (the production M&A
 * phantom: buyer2's pre-transaction 0% for 厦门联芯美, reported
 * under 物美集团, resolved onto the seller's 36.15%). Values
 * whose entities resolve to themselves are unaffected.
 */
function agentDataValueGroupKey(
  entry: AgentDataValue,
  structure: AgentDataStructure,
): { key: string; resolvedEntity: string; canonicalAttribute: string | undefined } {
  const resolvedEntity = resolveAgentDataEntity(entry.entity, structure);
  const { canonicalAttribute, scope: qualifierScope } = canonicalAgentDataAttributeAndScope(entry.attribute);
  const scope = agentDataValueEffectiveScope(entry) ?? qualifierScope;
  const rawEntity = entry.entity.normalize('NFKC').trim();
  const needsScope = resolvedEntity !== rawEntity;
  const scopePart = scope ?? (needsScope ? `raw:${rawEntity}` : '');
  return {
    key: `${resolvedEntity}\u0001${canonicalAttribute ?? ''}\u0001${scopePart}`,
    resolvedEntity,
    canonicalAttribute,
  };
}

/**
 * The deterministic cross-check (layer 1, C-1): group the value
 * table by (resolved entity, canonical attribute, scope); a group holding two or
 * more distinct effective values is a mismatch candidate. The same
 * value cited from several places is one entry (first-seen) — a
 * candidate needs differing values, not differing citations.
 * Capped at AGENT_DATA_VALUE_MISMATCH_MAX groups.
 */
export function computeAgentDataValueMismatches(
  values: readonly AgentDataValue[],
  structure: AgentDataStructure,
): AgentDataValueMismatch[] {
  const groups = new Map<string, {
    entity: string;
    attribute: string;
    byValue: Map<string, AgentDataValueMismatch['values'][number]>;
  }>();
  for (const entry of values) {
    const { key, resolvedEntity: entity, canonicalAttribute } = agentDataValueGroupKey(entry, structure);
    // The pairing contract (D2): grouping is by the canonical
    // attribute, so the same attribute written two ways groups
    // together; a label outside the controlled vocabulary does
    // not pair at all. The candidate keeps the first-seen
    // written label for display, as the merges elsewhere do.
    if (!entity || !canonicalAttribute) continue;
    let group = groups.get(key);
    if (!group) {
      group = { entity, attribute: entry.attribute.normalize('NFKC').trim(), byValue: new Map() };
      groups.set(key, group);
    }
    const effective = effectiveAgentDataValue(entry, canonicalAttribute);
    if (!group.byValue.has(effective)) {
      group.byValue.set(effective, {
        value: entry.value,
        normalizedValue: effective,
        file: entry.file,
        location: entry.location,
      });
    }
  }
  const mismatches: AgentDataValueMismatch[] = [];
  for (const group of groups.values()) {
    if (group.byValue.size < 2) continue;
    mismatches.push({
      entity: group.entity,
      attribute: group.attribute,
      values: [...group.byValue.values()].slice(0, AGENT_DATA_VALUE_MISMATCH_VALUES_MAX),
    });
    if (mismatches.length >= AGENT_DATA_VALUE_MISMATCH_MAX) break;
  }
  return mismatches;
}

/**
 * The recorded summary of one bundle's value table (failure
 * diagnosis 2026-11-24, 対策1(d)): how many entries the table
 * holds and how they group — the (entity, attribute, scope)
 * group keys with their entry counts and distinct-value counts,
 * in the same grouping the candidate computation uses. The
 * production M&A run
 * recorded candidateCount 0 with no way to tell whether the table
 * itself was empty or its keys simply never aligned; this summary
 * separates the two (entryCount 0 vs groups whose every entry
 * agrees), and the advancer projects it into the final analyzer
 * step's live detail. Group keys and counts only — the values
 * themselves never enter the summary. The group list is capped
 * like the candidate list; `groupCount` keeps the true total so
 * a capped list is visible as one.
 */
export type AgentDataValueTableSummary = {
  entryCount: number;
  groupCount: number;
  groups: { entity: string; attribute: string; entries: number; distinctValues: number }[];
};

export function summarizeAgentDataValueTable(
  values: readonly AgentDataValue[],
  structure: AgentDataStructure,
): AgentDataValueTableSummary {
  const groups = new Map<string, {
    entity: string;
    attribute: string;
    entries: number;
    distinct: Set<string>;
  }>();
  for (const entry of values) {
    const { key, resolvedEntity: entity, canonicalAttribute } = agentDataValueGroupKey(entry, structure);
    // The same canonical grouping the candidate computation
    // uses (D2): an entry whose label is outside the controlled
    // vocabulary belongs to no group here either, so the summary
    // can say the table held entries that could not pair.
    if (!entity || !canonicalAttribute) continue;
    let group = groups.get(key);
    if (!group) {
      group = { entity, attribute: entry.attribute.normalize('NFKC').trim(), entries: 0, distinct: new Set() };
      groups.set(key, group);
    }
    group.entries += 1;
    group.distinct.add(effectiveAgentDataValue(entry, canonicalAttribute));
  }
  const listed = [...groups.values()].slice(0, AGENT_DATA_VALUE_MISMATCH_MAX).map((group) => ({
    entity: group.entity,
    attribute: group.attribute,
    entries: group.entries,
    distinctValues: group.distinct.size,
  }));
  return { entryCount: values.length, groupCount: groups.size, groups: listed };
}

/**
 * Deterministic numeric value seeds (C1, diagnosis 2026-11-26):
 * values read from the chunk text itself — never from a model —
 * with the entity and attribute the surrounding text states. The
 * model's extraction drops numbers the PDF fragmentation splits
 * across lines (label on one line, value on the next) and values
 * it never looks for; the seeds are the deterministic complement,
 * not a replacement: they merge into the value table beside the
 * model's rows, and correct a model row's entity only when the
 * row's own subject says otherwise (C2). Every pattern below is
 * closed and crisp; anything ambiguous emits nothing (fail
 * closed). Seeds always carry a canonical attribute label and,
 * for pre/post holding tables, the scope the table states.
 */

const AGENT_DATA_SEED_AMOUNT_LABELS: Readonly<Record<string, string>> = {
  '协议转让对价': '金額',
  '价款支付方': '金額',
  '股份转让价款总额': '金額',
  '总价': '金額',
  '总价款': '金額',
  // `转让价格` is deliberately absent: it is the per-share price
  // (元/股), and seeding it as 金額 would pair a unit price with
  // the total amounts. `转让价款` stays — it is a total.
  '转让价款': '金額',
  '转让股份数量': '株数',
  '转让股份比例': '比率・持分',
};

const AGENT_DATA_SEED_FUNDING_MARKERS: readonly string[] = ['自有资金', '自筹资金', '银行借款'];

/** A fragment of a pre/post holding table's header: skipped
 * while looking for the next row subject, never a subject. */
const AGENT_DATA_SEED_TABLE_HEADER_FRAGMENTS: readonly string[] = [
  '本次权益变动', '持股数量', '持股比例', '占上市公司', '总股本比例', '信息披露义务人', '（股）', '（%）',
];

function seedEntityName(raw: string): string | undefined {
  const name = raw.normalize('NFKC').trim();
  if (name.length < 2 || name.length > 60) return undefined;
  if (/[、，。；：？！\s]/.test(name)) return undefined;
  if (/^[的及与在向为]/.test(name)) return undefined;
  // Parentheses must balance: a stray closing paren is a
  // fragment of a longer name, not a name.
  const open = (name.match(/[（(]/g) ?? []).length;
  const close = (name.match(/[）)]/g) ?? []).length;
  if (open !== close) return undefined;
  return name;
}

function seedStripLabelQualifier(line: string): string {
  return line.normalize('NFKC').trim().replace(/[（(][^（）()]*[）)]\s*$/, '').trim();
}

function seedIsLoneNumber(line: string): boolean {
  return /^[+-]?\d[\d,]*(?:\.\d+)?\s*(?:元|%)?$/.test(line.normalize('NFKC').trim());
}

function seedIsPercent(line: string): boolean {
  return /^\d[\d,]*(?:\.\d+)?\s*[%％]$/.test(line.normalize('NFKC').trim());
}

function seedIsCount(line: string): boolean {
  return /^\d[\d,]*$/.test(line.normalize('NFKC').trim());
}

function seedIsTableHeaderFragment(line: string): boolean {
  const text = line.normalize('NFKC').trim();
  if (!text) return true;
  // Fragments are compared against the NFKC text, so a fragment
  // written with full-width parens (`（股）`) must match its
  // half-width form (`(股)`).
  return AGENT_DATA_SEED_TABLE_HEADER_FRAGMENTS.some((fragment) => text.includes(fragment.normalize('NFKC')));
}

/**
 * Whether a name read off a holding line is a holder rather than
 * a fragment of one: at least 3 characters, and stripping the
 * corporate-suffix tokens must leave something behind — a bare
 * suffix sequence (`集团股份有限公司`, a wrapped line's tail) or
 * a bare adverb (`直接`, a wrapped line's head) is not a holder.
 */
function seedIsPlausibleHolder(name: string): boolean {
  if (name.length < 3) return false;
  const suffixes = ['股份有限公司', '有限公司', '合伙企业', '投资中心', '中心', '集团', '（有限合伙）', '(有限合伙)', '（普通合伙）', '(普通合伙)'];
  let rest = name;
  for (const suffix of suffixes) rest = rest.split(suffix).join('');
  return rest.trim().length > 0;
}

type AgentDataSeedContext = {
  /** The file's discloser, from its `信息披露义务人：<full>` line. */
  discloser?: string;
  /** The buyer of the table currently being read (`受让方N 名称`
   * followed by its full name). */
  currentBuyer?: string;
};

function seedChunkContext(lines: readonly string[]): AgentDataSeedContext {
  const context: AgentDataSeedContext = {};
  for (const line of lines) {
    const text = line.normalize('NFKC').trim();
    if (text.includes('信息披露义务人')) {
      const colon = Math.max(text.lastIndexOf('：'), text.lastIndexOf(':'));
      if (colon >= 0) {
        const name = seedEntityName(text.slice(colon + 1));
        if (name && !context.discloser) context.discloser = name;
      }
    }
  }
  return context;
}

function seedLocation(chunk: AgentDataChunk, lineIndex: number): string {
  return `チャンク ${chunk.index + 1}・行 ${lineIndex + 1}`;
}

/**
 * Deterministic value seeds for one chunk, in first-seen order.
 * Patterns (all chunk-local, all fail-closed):
 * (A) label/value table rows — a closed label set (`协议转让对价`
 * etc.) with a lone number on the same or a following line, and
 * `股份转让价款总额…人民币<amount>元` prose; the entity is the
 * table's buyer (`受让方N 名称`) or the file's discloser.
 * (B) `<holder>持有<ratio>%` / `<holder>持股<ratio>%` on one
 * line (or the verb ending the line and the ratio on the next);
 * the entity is the holder named on the line.
 * (C) funding source — a checked `√<marker>` line, or a sentence
 * stating the funding source (`资金来源…自有资金` /
 * `…向银行的借款`); the entity is the table's buyer or the
 * file's discloser. An unchecked `□` marker never seeds.
 * (D) pre/post holding tables — a `本次权益变动前/后` header
 * followed by rows of [subject, pre-count, pre-ratio, post-count,
 * post-ratio]; the entity is the row's subject, the scopes are
 * 交易前/交易后. A row whose four values do not match the shape
 * ends the table.
 */
export function extractAgentDataValueSeeds(chunk: AgentDataChunk): AgentDataValue[] {
  const lines = chunk.text.split('\n');
  const context = seedChunkContext(lines);
  const seeds: AgentDataValue[] = [];
  const push = (seed: AgentDataValue): void => {
    // The scope is part of the identity: a pre-transaction row
    // and a post-transaction row may carry the same number.
    const key = `${seed.entity}|${seed.attribute}|${seed.value}|${seed.file}|${seed.location}|${seed.scope ?? ''}`;
    if (!seeds.some((existing) => `${existing.entity}|${existing.attribute}|${existing.value}|${existing.file}|${existing.location}|${existing.scope ?? ''}` === key)) {
      seeds.push(seed);
    }
  };
  const buyerEntity = (): string | undefined => context.currentBuyer ?? context.discloser;

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.normalize('NFKC').trim();

    // Table-buyer tracking: `受让方N 名称` names the buyer of
    // the table that follows, on the next non-empty line; an
    // agreement's `乙方（受让方）：<name>` line names it too.
    const buyerMark = /^受让方\d+\s*名称$/.exec(line);
    if (buyerMark) {
      let j = i + 1;
      while (j < lines.length && !lines[j].normalize('NFKC').trim()) j += 1;
      const name = j < lines.length ? seedEntityName(lines[j]) : undefined;
      if (name) context.currentBuyer = name;
      i += 1;
      continue;
    }
    // Parens and the colon are matched in both widths: the line
    // is NFKC-normalized, so a full-width `（受让方）：` in the
    // source reads as the half-width `(受让方):` here.
    const agreementBuyer = /^乙方[（(]受让方[）)][：:]\s*(.+)$/.exec(line);
    if (agreementBuyer) {
      const name = seedEntityName(agreementBuyer[1]);
      if (name) context.currentBuyer = name;
      i += 1;
      continue;
    }

    // (D) Pre/post holding table.
    if (line.includes('本次权益变动前')) {
      let k = i + 1;
      let hasAfter = false;
      while (k < lines.length && k <= i + 3) {
        if (lines[k].normalize('NFKC').includes('本次权益变动后')) { hasAfter = true; break; }
        k += 1;
      }
      if (hasAfter) {
        let j = k + 1;
        let advanced = false;
        while (j < lines.length) {
          const subjectLine = lines[j].normalize('NFKC').trim();
          if (seedIsTableHeaderFragment(subjectLine)) { j += 1; continue; }
          const subject = seedEntityName(subjectLine);
          if (!subject || !seedIsPlausibleHolder(subject)) break;
          const quad = [j + 1, j + 2, j + 3, j + 4]
            .map((index) => (index < lines.length ? lines[index].normalize('NFKC').trim() : ''));
          if (!seedIsCount(quad[0]) || !seedIsPercent(quad[1]) || !seedIsCount(quad[2]) || !seedIsPercent(quad[3])) break;
          const location = seedLocation(chunk, j);
          push({ entity: subject, attribute: '株数', value: quad[0], file: chunk.fileName, location, scope: '交易前' });
          push({ entity: subject, attribute: '比率・持分', value: quad[1], file: chunk.fileName, location, scope: '交易前' });
          push({ entity: subject, attribute: '株数', value: quad[2], file: chunk.fileName, location, scope: '交易后' });
          push({ entity: subject, attribute: '比率・持分', value: quad[3], file: chunk.fileName, location, scope: '交易后' });
          j += 5;
          advanced = true;
        }
        if (advanced) { i = j; continue; }
      }
    }

    // (A) Label/value table rows: label on this line, lone
    // number on this or a following line (within 3 lines).
    const labelAttribute = AGENT_DATA_SEED_AMOUNT_LABELS[seedStripLabelQualifier(line)];
    if (labelAttribute) {
      const entity = buyerEntity();
      if (entity) {
        for (let k = i + 1; k < lines.length && k <= i + 3; k += 1) {
          const valueLine = lines[k].normalize('NFKC').trim();
          if (!valueLine) continue;
          if (seedIsLoneNumber(valueLine)) {
            push({ entity, attribute: labelAttribute, value: valueLine, file: chunk.fileName, location: seedLocation(chunk, k) });
          }
          break;
        }
      }
      i += 1;
      continue;
    }
    // Same-line label + value (`协议转让对价 146,660,332.00`).
    const sameLine = /^(.+?)\s+([+-]?\d[\d,]*(?:\.\d+)?)\s*(?:元|%)?$/.exec(line);
    if (sameLine) {
      const attribute = AGENT_DATA_SEED_AMOUNT_LABELS[seedStripLabelQualifier(sameLine[1])];
      const entity = buyerEntity();
      if (attribute && entity) {
        push({ entity, attribute, value: sameLine[2], file: chunk.fileName, location: seedLocation(chunk, i) });
      }
    }
    // (A, prose) `股份转让价款总额…人民币<amount>元` — the 元
    // is optional: the fragmented text ends some lines on the
    // bare number. `总额的50%…` never matches: 的 follows 总额.
    const totalPrice = /股份转让价款总额[（(]?为?人民币?([+-]?\d[\d,]*(?:\.\d+)?)\s*元?/.exec(line);
    if (totalPrice) {
      const entity = buyerEntity();
      if (entity) {
        push({ entity, attribute: '金額', value: totalPrice[1], file: chunk.fileName, location: seedLocation(chunk, i) });
      }
    }

    // (B) Holding ratios: `<holder>持有<ratio>%` on one line,
    // or the verb ending the line and the ratio on the next.
    const holding = /^(.+?)(?:持有|持股)\s*([\d,]+(?:\.\d+)?)\s*[%％]/.exec(line);
    if (holding) {
      const holder = seedEntityName(holding[1]);
      if (holder && seedIsPlausibleHolder(holder)) {
        push({ entity: holder, attribute: '比率・持分', value: `${holding[2]}%`, file: chunk.fileName, location: seedLocation(chunk, i) });
      }
    } else {
      const holdingSplit = /^(.+?)(?:持有|持股)\s*$/.exec(line);
      if (holdingSplit && i + 1 < lines.length) {
        const next = lines[i + 1].normalize('NFKC').trim();
        const ratio = /^([\d,]+(?:\.\d+)?)\s*[%％]/.exec(next);
        const holder = seedEntityName(holdingSplit[1]);
        if (ratio && holder && seedIsPlausibleHolder(holder)) {
          push({ entity: holder, attribute: '比率・持分', value: `${ratio[1]}%`, file: chunk.fileName, location: seedLocation(chunk, i + 1) });
        }
      }
    }

    // (C) Funding source.
    const checked = /^√\s*(.+)$/.exec(line);
    if (checked) {
      const marker = AGENT_DATA_SEED_FUNDING_MARKERS.find((candidate) => checked[1].trim() === candidate);
      const entity = buyerEntity();
      if (marker && entity) {
        push({ entity, attribute: '資金源泉', value: marker, file: chunk.fileName, location: seedLocation(chunk, i) });
      }
    } else if (line.includes('资金来源')) {
      const hasSelf = line.includes('自有资金');
      const hasBank = line.includes('银行') && /借款|贷款|借入/.test(line);
      const entity = context.discloser ?? context.currentBuyer;
      if (entity && (hasSelf || hasBank)) {
        push({
          entity,
          attribute: '資金源泉',
          value: hasSelf && hasBank ? '自有资金及银行借款' : hasSelf ? '自有资金' : '银行借款',
          file: chunk.fileName,
          location: seedLocation(chunk, i),
        });
      }
    }

    i += 1;
  }
  return seeds;
}

/**
 * Merges deterministic seeds into the value table (C1/C2):
 * a seed whose (file, canonical attribute, effective value)
 * matches exactly one model row of the same fact — the two
 * entities resolve to the same holder — corrects that row: the
 * row's entity becomes the seed's (the table row's own subject,
 * not a prose name) and a scope the seed states is filled in
 * when the row states none; the seed itself is then not added
 * twice. A seed matching a row of a different holder is a
 * distinct row (two holders may hold the same value), as is a
 * seed with no (or an ambiguous) match — added unless the same
 * entity, canonical attribute, effective value, file and scope
 * are already present (a number seeded from several chunks of
 * one file is one row). Returns a new array; the input is
 * untouched.
 */
export function applyAgentDataValueSeeds(
  values: readonly AgentDataValue[],
  seeds: readonly AgentDataValue[],
  structure: AgentDataStructure,
): AgentDataValue[] {
  const next = [...values];
  const seedKeyOf = (entry: AgentDataValue): string | undefined => {
    const { canonicalAttribute } = canonicalAgentDataAttributeAndScope(entry.attribute);
    if (!canonicalAttribute) return undefined;
    return `${entry.entity}|${canonicalAttribute}|${effectiveAgentDataValue(entry, canonicalAttribute)}|${entry.file}|${agentDataValueEffectiveScope(entry) ?? ''}`;
  };
  for (const seed of seeds) {
    const seedCanonical = canonicalAgentDataAttribute(seed.attribute);
    if (!seedCanonical) continue;
    const seedEffective = effectiveAgentDataValue(seed, seedCanonical);
    const matches = next
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        if (entry.file !== seed.file) return false;
        const { canonicalAttribute } = canonicalAgentDataAttributeAndScope(entry.attribute);
        return canonicalAttribute === seedCanonical
          && effectiveAgentDataValue(entry, canonicalAttribute) === seedEffective;
      });
    if (matches.length === 1) {
      const { entry, index } = matches[0];
      // A correction only when the seed and the row are the same
      // fact: their entities resolve to the same holder (a short
      // name against its full name, or the same name). Two
      // different holders may legitimately hold the same value —
      // both buyers fund from 自有资金 — and overwriting one
      // holder's row with the other's would erase a real row, so
      // an unrelated entity is a distinct row, not a correction.
      const sameFact = resolveAgentDataEntity(seed.entity, structure) === resolveAgentDataEntity(entry.entity, structure);
      if (sameFact) {
        const corrected = { ...entry };
        let changed = false;
        if (seed.entity !== entry.entity) {
          corrected.entity = seed.entity;
          changed = true;
        }
        const seedScope = agentDataValueEffectiveScope(seed);
        if (seedScope !== undefined && agentDataValueEffectiveScope(entry) === undefined) {
          corrected.scope = seedScope;
          changed = true;
        }
        if (changed) next[index] = corrected;
        continue;
      }
    }
    const key = seedKeyOf(seed);
    if (key === undefined) continue;
    if (!next.some((existing) => seedKeyOf(existing) === key)) next.push(seed);
  }
  return next;
}

/** Tolerant parser for a recorded candidate list (bundle
 * round-trip), mirroring computeAgentDataValueMismatches' shape. */
export function parseAgentDataValueMismatches(raw: unknown): AgentDataValueMismatch[] {
  if (!Array.isArray(raw)) return [];
  const mismatches: AgentDataValueMismatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const entity = trimmedAuditText(record.entity, 120);
    const attribute = trimmedAuditText(record.attribute, 120);
    if (!entity || !attribute || !Array.isArray(record.values)) continue;
    const values: AgentDataValueMismatch['values'] = [];
    for (const rawValue of record.values) {
      if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
      const entry = rawValue as Record<string, unknown>;
      const value = trimmedAuditText(entry.value, 200);
      if (!value) continue;
      values.push({
        value,
        normalizedValue: trimmedAuditText(entry.normalizedValue, 200) || value,
        file: trimmedAuditText(entry.file, 200),
        location: trimmedAuditText(entry.location, 200),
      });
    }
    if (values.length >= 2) mismatches.push({ entity, attribute, values });
    if (mismatches.length >= AGENT_DATA_VALUE_MISMATCH_MAX) break;
  }
  return mismatches;
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
  | 'finding-explanation-missing'
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
  'finding-explanation-missing',
  'text-not-string',
];

export type AgentDataParseResult =
  | { ok: true; output: ChunkOutput }
  | { ok: false; reason: AgentDataParseFailureReason };

export function parseChunkOutputDetailed(
  outputKind: AgentDataOutputKind,
  text: string,
  view: AgentAttachmentDataView,
  options?: { auditMode?: boolean },
): AgentDataParseResult {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'json-not-extractable' };
  }
  const record = parsed as Record<string, unknown>;
  const output: ChunkOutput = {
    rows: [],
    findings: [],
    textParts: [],
    resources: [],
    remediations: [],
    values: [],
    structure: emptyAgentDataStructure(),
  };
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
      // Layer 3 (misreading countermeasure design §2): the
      // explanation is part of the schema in every mode — parsed
      // whenever present — but only audit mode makes it a validity
      // condition. The chunk-local requirement stops at claim +
      // explanation + one citation: the pair's second citation
      // cannot be required per chunk, because the other half of a
      // pair lives in another chunk by the nature of the task; the
      // pair is judged by the reconciliation step alone.
      const explanation = typeof finding.explanation === 'string'
        ? finding.explanation.trim().slice(0, 1000)
        : '';
      if (options?.auditMode === true && !explanation) {
        return { ok: false, reason: 'finding-explanation-missing' };
      }
      const evidenceB = typeof finding.evidenceB === 'string' ? finding.evidenceB.trim().slice(0, 200) : '';
      const fileB = typeof finding.fileB === 'string' ? finding.fileB.trim() : '';
      const locationB = typeof finding.locationB === 'string' ? finding.locationB.trim() : '';
      const type = typeof finding.type === 'string' && finding.type.trim()
        ? finding.type.trim().slice(0, 80)
        : undefined;
      const severity = validFindingSeverity(finding.severity);
      output.findings.push({
        claim: finding.claim.trim(),
        evidence: typeof finding.evidence === 'string' ? finding.evidence.trim().slice(0, 200) : '',
        file: typeof finding.file === 'string' ? finding.file.trim() : '',
        location: typeof finding.location === 'string' ? finding.location.trim() : '',
        ...(explanation ? { explanation } : {}),
        ...(evidenceB ? { evidenceB } : {}),
        ...(fileB ? { fileB } : {}),
        ...(locationB ? { locationB } : {}),
        ...(type ? { type } : {}),
        ...(severity ? { severity } : {}),
      });
    }
    // Optional structured sections: invalid items are dropped, never
    // allowed to fail the chunk — coverage is judged on findings.
    output.resources = parseAgentDataResources(record.resources);
    output.remediations = parseAgentDataRemediations(record.remediations);
    // Layer-1 audit sections ride the same tolerance: parsed
    // whenever present, merged only in audit mode (the analyzer
    // decides), so a stray section can never change a non-audit
    // bundle.
    output.values = parseAgentDataValues(record.values);
    output.structure = parseAgentDataStructure(record.structure);
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
    case 'finding-explanation-missing':
      return `${base}explanation（なぜ矛盾と言えるのかの説明）が空か欠けている所見がありました。全ての所見にexplanationを含めてください。`;
    case 'text-not-string':
      return `${base}textが文字列になっていませんでした。{"text":"作成した文章"}の形で返してください。`;
    default:
      return `${base}JSONだけを返してください。`;
  }
}

/** Message-carried provider-attempt evidence (AGORA timeout
 * observability, diagnosis AGENT_AGORA_PROVIDER_TIMEOUT_DIAGNOSIS_
 * 2026-11-23 §5.3), in the same fixed-shape style as the parse
 * failure above: when a chunk's model call fails after its dispatch
 * recorded failover attempts, the step's failure message appends
 * them in one parenthetical — route | model | outcome | error code
 * | duration ms | transport count per attempt, `-` for an absent
 * field, attempts separated by `; `. The advancer reads the
 * parenthetical back into the step's live detail; the terminal code
 * stays the leading token, exactly as before. Only fields that match
 * the strict shapes below are encoded at all (the values arrive
 * pre-whitelisted from the provider layer; this is defense in depth
 * so a malformed value can never smuggle free text into the record
 * through the message), and at most six attempts are carried. */
const ANALYZER_ATTEMPT_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ANALYZER_ATTEMPT_MODEL_ID_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9@/_:.+-]{0,127}$/;
const ANALYZER_ATTEMPT_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,119}$/;
const ANALYZER_ATTEMPT_OUTCOMES: ReadonlySet<string> = new Set([
  'succeeded',
  'availability-error',
  'failed',
  'skipped',
]);
const ANALYZER_ATTEMPT_MAX_CARRIED = 6;
/** Distinct servings one step's execution trace carries at most
 * (coverage observability follow-on): a step's chunk calls
 * realistically touch one route per allocation bucket, so four is
 * generous headroom, and the cap keeps the trace a bounded shape
 * like the attempts above. */
const ANALYZER_EXECUTION_SERVINGS_MAX = 4;

export function analyzerProviderFailureMessage(
  result: Extract<AgentModelCallResult, { ok: false }>,
): string {
  const attempts = result.providerAttempts ?? [];
  const encoded: string[] = [];
  for (const attempt of attempts) {
    if (encoded.length >= ANALYZER_ATTEMPT_MAX_CARRIED) break;
    if (!attempt || typeof attempt !== 'object') continue;
    if (!ANALYZER_ATTEMPT_PROVIDER_ID_PATTERN.test(attempt.providerId)) continue;
    if (!ANALYZER_ATTEMPT_OUTCOMES.has(attempt.outcome)) continue;
    const modelId = attempt.modelId !== undefined && ANALYZER_ATTEMPT_MODEL_ID_PATTERN.test(attempt.modelId)
      ? attempt.modelId
      : '-';
    const errorCode = attempt.errorCode !== undefined && ANALYZER_ATTEMPT_ERROR_CODE_PATTERN.test(attempt.errorCode)
      ? attempt.errorCode
      : '-';
    const durationMs = typeof attempt.durationMs === 'number' && Number.isInteger(attempt.durationMs) && attempt.durationMs >= 0
      ? String(attempt.durationMs)
      : '-';
    const transport = typeof attempt.transportRequestCount === 'number'
      && Number.isInteger(attempt.transportRequestCount) && attempt.transportRequestCount >= 0
      ? String(attempt.transportRequestCount)
      : '-';
    encoded.push([attempt.providerId, modelId, attempt.outcome, errorCode, durationMs, transport].join('|'));
  }
  return encoded.length > 0 ? `${result.code} (attempts: ${encoded.join('; ')})` : result.code;
}

/**
 * The transient-retry caller shared by the analyzer and the
 * reconciler (design AGENT_SEGMENT2_WALL_DIAGNOSIS_2026-11-22 §6):
 * only provider-availability codes retry, only within one step's
 * cumulative wait ceiling; every other failure — and a transient
 * failure that exhausts its retries — returns exactly the result
 * the unretried call returned, so the step fails with the
 * provider's own code as before. The step's declared quota charge
 * is unaffected: retries are inside the step, and the ledger
 * counts the step once.
 */
function createTransientRetryCaller(
  modelCall: AgentModelExecutor,
  sleepMs: (ms: number) => Promise<void>,
): (input: AgentModelCallInput) => Promise<AgentModelCallResult> {
  let transientWaitMs = 0;
  return async (input: AgentModelCallInput): Promise<AgentModelCallResult> => {
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
}

type PriorBundle = ChunkOutput & {
  /** The predecessor chain's recorded processed-chunk count (its
   * artifact coverage block). The final step of a file-name-key rows
   * run verifies its chain against this count, so a bundle whose
   * coverage block is missing or inconsistent fails that gate
   * closed instead of being trusted. */
  processedChunks?: number;
  /** The predecessor chain's recorded count of rows discarded under
   * the primary-table contract (案1), from its artifact coverage
   * block. Observability only — no gate reads it — so a bundle
   * written before the count existed simply contributes 0. */
  discardedRows?: number;
  /** The final analyzer step's deterministic value-mismatch
   * candidates (layer 1), present only on an audit bundle that
   * completed the set. The reconciliation step reads them from
   * here; analyzer continuations never do. */
  candidates?: AgentDataValueMismatch[];
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
  const prior: PriorBundle = {
    rows: [],
    findings: [],
    textParts: [],
    resources: [],
    remediations: [],
    values: [],
    structure: emptyAgentDataStructure(),
  };
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
        ...(typeof finding.explanation === 'string' && finding.explanation ? { explanation: finding.explanation } : {}),
        ...(typeof finding.evidenceB === 'string' && finding.evidenceB ? { evidenceB: finding.evidenceB } : {}),
        ...(typeof finding.fileB === 'string' && finding.fileB ? { fileB: finding.fileB } : {}),
        ...(typeof finding.locationB === 'string' && finding.locationB ? { locationB: finding.locationB } : {}),
        ...(type ? { type } : {}),
        ...(severity ? { severity } : {}),
        // The deterministic-pickup mark (案B) survives the chain
        // like type/severity do, so a re-read bundle never loses
        // which findings were machine-assembled.
        ...(finding.origin === 'deterministic-candidate'
          ? { origin: 'deterministic-candidate' as const }
          : {}),
      });
    }
    // Structured sections survive the chain the same way findings do;
    // a continuation that dropped them would lose the earlier
    // chunks' resources and remediations from the final bundle.
    prior.resources = parseAgentDataResources(bundle.resources);
    prior.remediations = parseAgentDataRemediations(bundle.remediations);
    // Layer-1 audit sections survive the chain the same way; a
    // bundle written before they existed simply contributes empty
    // sections, and a non-audit bundle never carries them at all.
    prior.values = parseAgentDataValues(bundle.values);
    prior.structure = parseAgentDataStructure(bundle.structure);
    if (Array.isArray(bundle.candidates)) {
      prior.candidates = parseAgentDataValueMismatches(bundle.candidates);
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
    const discarded = (coverage as Record<string, unknown>).discardedRows;
    if (typeof discarded === 'number' && Number.isInteger(discarded) && discarded >= 0) {
      prior.discardedRows = discarded;
    }
  }
  return prior;
}

const AGENT_GOAL_CJK_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Whether the goal text is written in a CJK language — the
 * fallback deterministic language switch for the layer-3 rendering
 * labels (design §2 C-4), used when the goal carries no explicit
 * output-language directive (see agentGoalDirectedOutputLanguage).
 * The finding texts themselves are the model's, written in the
 * goal's language because the goal rides the analyzer instruction;
 * only the fixed labels are chosen here.
 */
export function agentGoalUsesCjk(goal: string): boolean {
  return AGENT_GOAL_CJK_PATTERN.test(goal);
}

const AGENT_GOAL_ENGLISH_DIRECTIVE_PATTERN = /\bin english\b|英語で(?:書|作|作成|記述|出力|回答|まとめ|お願い)|用英文|以英文|英文(?:撰写|写作|书写|输出|编写)/i;
const AGENT_GOAL_JAPANESE_DIRECTIVE_PATTERN = /\bin japanese\b|日本語で(?:書|作|作成|記述|出力|回答|まとめ|お願い)|用日文|以日文|日文(?:撰写|写作|书写|输出|编写)/i;

/**
 * The output language a goal explicitly directs, when it directs
 * exactly one (D5). Directive-shaped phrases — "Write in English",
 * 「英語で書いてください」, 「用英文撰写」 — name the language the
 * deliverable, fixed structure labels included, must be written
 * in. Only these closed shapes count: a bare mention of a language
 * (「英語の文書を要約して」) directs nothing, and a goal directing
 * both languages is undecided — both return undefined and the
 * caller falls back to the CJK check.
 */
export function agentGoalDirectedOutputLanguage(goal: string): 'english' | 'japanese' | undefined {
  const english = AGENT_GOAL_ENGLISH_DIRECTIVE_PATTERN.test(goal);
  const japanese = AGENT_GOAL_JAPANESE_DIRECTIVE_PATTERN.test(goal);
  if (english === japanese) return undefined;
  return english ? 'english' : 'japanese';
}

/**
 * Whether the layer-3 rendering labels are Japanese. An explicit
 * output-language directive decides first (D5): a goal can carry
 * CJK material — quoted source text, a Japanese harness preamble —
 * while explicitly directing another language's output, and the
 * CJK check alone rendered Japanese labels for exactly that goal
 * in production (an English audit whose headings came out
 * Japanese). Without a directive, the CJK check decides, unchanged.
 */
function agentGoalRendersJapaneseLabels(goal: string): boolean {
  const directed = agentGoalDirectedOutputLanguage(goal);
  if (directed !== undefined) return directed === 'japanese';
  return agentGoalUsesCjk(goal);
}

function renderFindingPair(finding: AgentDataFinding, index: number, japanese: boolean): string {
  const citation = (file: string, location: string, evidence: string): string => {
    const source = [file, location].filter(Boolean).join(', ');
    return japanese ? `  - \`${source}\`: 「${evidence}」` : `  - \`${source}\`: \`${evidence}\``;
  };
  const lines = [
    japanese ? `## 所見 ${index}: ${finding.claim}` : `## Finding ${index}: ${finding.claim}`,
    japanese ? `- 矛盾の説明: ${finding.explanation ?? ''}` : `- Why it is inconsistent: ${finding.explanation ?? ''}`,
    japanese ? '- 根拠:' : '- Evidence:',
    citation(finding.file, finding.location, finding.evidence),
  ];
  if (finding.evidenceB) {
    lines.push(citation(finding.fileB ?? '', finding.locationB ?? '', finding.evidenceB));
  }
  return lines.join('\n');
}

/**
 * Renders the findings bundle's text form. A finding carrying an
 * explanation renders in the layer-3 pair structure (design §2
 * C-4) — heading, why-it-is-inconsistent, and the pair of citations
 * — with labels in the goal's language; a finding without one
 * renders exactly as it did before the extension, so a non-audit
 * bundle's text is byte-identical to the pre-measure rendering.
 */
function renderFindings(findings: readonly AgentDataFinding[], goal = ''): string {
  const japanese = agentGoalRendersJapaneseLabels(goal);
  const hasPairs = findings.some((finding) => Boolean(finding.explanation));
  let pairIndex = 0;
  const segments = findings.map((finding) => {
    if (finding.explanation) {
      pairIndex += 1;
      return renderFindingPair(finding, pairIndex, japanese);
    }
    const source = [finding.file, finding.location].filter(Boolean).join(' ');
    const evidence = finding.evidence ? `「${finding.evidence}」` : '';
    return source || evidence ? `- ${finding.claim}（根拠: ${[source, evidence].filter(Boolean).join(' ')}）` : `- ${finding.claim}`;
  });
  return segments.join(hasPairs ? '\n\n' : '\n');
}

export type AgentDataCoverageFailure = Extract<AgentDataCoverageResult, { ok: false }>;

/**
 * The coverage failure message (Basel segment-2 fix, 案3): the
 * human-readable counts stay first — the failure code is the
 * message's leading token and the counts are what an operator
 * reads — and a fixed machine-readable parenthetical follows,
 * carrying the same breakdown plus the yardstick's scope and, for
 * a chunk-local failure, the step's chunk range, so the step
 * record's live detail can carry the breakdown in the same
 * "structure out of the message" pattern as the parse-failure
 * parenthetical. Counts and numeric column names only; key values
 * and row data never enter the message.
 */
/** Deterministic plain-decimal rendering for the coverage
 * message's numeric segment: at most four fractional digits, no
 * exponent, so the advancer's fixed-shape parser reads the value
 * back exactly. A sum outside the carried range (or not finite)
 * cannot be rendered in that shape and its detail entry is left
 * out of the message — the column still appears in numericMismatch
 * — rather than rounded into a wrong value. */
const MAX_COVERAGE_SUM_CARRIED = 1e15;

function formatCoverageSum(value: number): string | undefined {
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_COVERAGE_SUM_CARRIED) return undefined;
  const text = value.toFixed(4);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

export function agentDataCoverageFailureMessage(
  scope: 'final' | 'local',
  coverage: AgentDataCoverageFailure,
  range?: { chunkOffset: number; chunkCount: number },
): string {
  const human = `AGENT_DATA_COVERAGE_INSUFFICIENT (対象${coverage.expected}件中${coverage.covered}件を処理、未処理${coverage.missing.length}件、重複${coverage.duplicated.length}件、対象外${coverage.unexpected.length}件、数値不一致${coverage.numericMismatch.length}件)`;
  const rangePart = range ? `, range=${range.chunkOffset}+${range.chunkCount}` : '';
  // The per-column sums ride the same parenthetical (coverage
  // observability follow-on, diagnosis 2026-11-23): for each
  // checked numeric column, `column:expected:output:difference:
  // unparseable`, so the step record can show how far the output
  // sum landed from the input's own sum and whether unreadable
  // values were excluded on the way — the two facts that separate
  // a digit-drop transcription error from a notation failure.
  // Deterministic aggregates only; no cell text ever enters here.
  const numericEntries: string[] = [];
  for (const detail of coverage.numericDetails) {
    const expected = formatCoverageSum(detail.expectedSum);
    const output = formatCoverageSum(detail.outputSum);
    const difference = formatCoverageSum(detail.difference);
    if (expected === undefined || output === undefined || difference === undefined) continue;
    numericEntries.push(`${detail.column}:${expected}:${output}:${difference}:${detail.unparseableCount}`);
  }
  const numericPart = numericEntries.length > 0 ? `, numeric=${numericEntries.join('|')}` : '';
  const machine = `(coverage: scope=${scope}${rangePart}, expected=${coverage.expected}, covered=${coverage.covered}, missing=${coverage.missing.length}, duplicated=${coverage.duplicated.length}, unexpected=${coverage.unexpected.length}, numericMismatch=${coverage.numericMismatch.join('|')}${numericPart})`;
  return `${human} ${machine}`;
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
  // Dispatch timing collection (D7 countermeasure A): every model
  // dispatch this step makes appends its timing evidence here, in
  // dispatch order, and the result carries the list on success and
  // failure alike. Observability only — an empty list attaches
  // nothing, so a step whose executor reports no timing (an
  // injected double, a pre-dispatch refusal) returns results
  // identical to before, byte for byte.
  const modelCallTimings: AgentModelCallTiming[] = [];
  const fail = (message: string): ToolResult => ({
    ok: false,
    tool,
    message,
    ...(modelCallTimings.length > 0 ? { modelCallTimings: [...modelCallTimings] } : {}),
  });
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
  // Audit mode (misreading countermeasure design §2): the planner
  // marks analyzer steps of an inconsistency-audit goal, and only
  // those steps ask for — and validate — the explanation and the
  // layer-1 sections. Any other value, including absence, is the
  // pre-measure behavior exactly.
  const auditMode = params.auditMode === true;

  const loaded = await loadBoundData(tool, params, context);
  if ('failure' in loaded) return loaded.failure;
  const { view, files } = loaded.data;
  if (chunkOffset >= view.totalChunks) return fail('AGENT_ATTACHMENT_PARAMS_INVALID');
  const range = view.chunks.slice(chunkOffset, chunkOffset + chunkCount);
  const isFinalStep = chunkOffset + range.length >= view.totalChunks;

  let merged: ChunkOutput = {
    rows: [],
    findings: [],
    textParts: [],
    resources: [],
    remediations: [],
    values: [],
    structure: emptyAgentDataStructure(),
  };
  // The predecessor chain's recorded processed-chunk count: 0 for a
  // first step, the prior bundle's coverage count for a continuation,
  // and null when a continuation's bundle carries no count — the
  // file-name-key coverage gate treats null as unverifiable and
  // fails closed.
  let priorProcessedChunks: number | null = chunkOffset === 0 ? 0 : null;
  let priorDiscardedRows = 0;
  if (typeof params.content === 'string' && params.content.trim().length > 0) {
    const prior = parsePriorBundle(params.content, outputKind, view);
    if (!prior) return fail('AGENT_DATA_OUTPUT_INVALID');
    merged = prior;
    if (typeof prior.processedChunks === 'number') priorProcessedChunks = prior.processedChunks;
    if (typeof prior.discardedRows === 'number') priorDiscardedRows = prior.discardedRows;
  } else if (chunkOffset > 0) {
    // A continuation step without its predecessor's bundle would
    // silently drop the earlier chunks' work; refuse instead.
    return fail('AGENT_STEP_INPUT_UNAVAILABLE');
  }

  const modelCall = context?.modelCall ?? createAgentModelExecutor(context?.env ?? process.env);
  const sleepMs = context?.sleepMs ?? defaultSleepMs;
  // Timing capture sits BELOW the transient-retry caller, wrapped
  // around the raw executor, so every dispatch — including the
  // retries the caller performs internally and would otherwise
  // hide — appends exactly one entry, in dispatch order (D7
  // countermeasure A). The wrapper passes results through
  // untouched; a result without timing evidence adds nothing.
  const timedModelCall: AgentModelExecutor = async (input) => {
    const result = await modelCall(input);
    if (result.timing && modelCallTimings.length < MAX_AGENT_MODEL_CALL_TIMINGS_PER_STEP) {
      modelCallTimings.push(result.timing);
    }
    return result;
  };
  const callModelWithTransientRetry = createTransientRetryCaller(timedModelCall, sleepMs);
  // Execution trace (coverage observability follow-on, diagnosis
  // 2026-11-23): which route/model actually served this step's
  // chunk calls, and whether the parse repair retry ran. Until now
  // a coverage failure could not be attributed past "the model" —
  // the serving of the step that produced the rows was recorded
  // nowhere. The trace rides the same two carriers as the rest of
  // the step's observability: the success artifact's `execution`
  // block (the reconciler pattern) and a fixed parenthetical on
  // this step's failure messages (the parse-failure pattern); the
  // advancer reads both back into the step's live detail.
  // Identifiers and a boolean only — never a response body. A call
  // whose executor reports no serving (an injected double)
  // contributes nothing, so a step with no recorded serving
  // carries neither carrier and its messages stay byte-identical
  // to before this trace existed. A failed dispatch contributes
  // the servings of the attempts it actually exercised (see
  // noteExecutionServing), so a provider failure is traced in the
  // same shape as any later failure (D8).
  const executionServings: { providerId: string; modelId?: string }[] = [];
  let executionRepairRetried = false;
  const recordExecutionServing = (providerIdRaw: unknown, modelIdRaw: unknown): void => {
    if (typeof providerIdRaw !== 'string' || !ANALYZER_ATTEMPT_PROVIDER_ID_PATTERN.test(providerIdRaw)) return;
    const modelId = typeof modelIdRaw === 'string' && ANALYZER_ATTEMPT_MODEL_ID_PATTERN.test(modelIdRaw)
      ? modelIdRaw
      : undefined;
    if (executionServings.some((serving) => serving.providerId === providerIdRaw && serving.modelId === modelId)) return;
    if (executionServings.length >= ANALYZER_EXECUTION_SERVINGS_MAX) return;
    executionServings.push({ providerId: providerIdRaw, ...(modelId ? { modelId } : {}) });
  };
  const noteExecutionServing = (result: AgentModelCallResult): void => {
    if (result.ok === false) {
      // A dispatch that failed at the provider still exercised its
      // routes (D8): the attempts it actually dispatched join the
      // trace under the same whitelist the attempts segment applies
      // (a malformed entry or an unknown outcome contributes
      // nothing; a skipped route was never dispatched and is not a
      // serving). A step that dies on its first dispatch — the
      // production Basel shape, one invalid response before
      // anything succeeded — therefore carries an execution record
      // in the same shape as a step that fails later, instead of
      // the step record falling back to the attempts segment alone.
      // A failure carrying no attempt evidence (a plan-level
      // refusal, an injected double) contributes nothing, exactly
      // as before.
      for (const attempt of result.providerAttempts ?? []) {
        if (!attempt || typeof attempt !== 'object') continue;
        if (!ANALYZER_ATTEMPT_OUTCOMES.has(attempt.outcome) || attempt.outcome === 'skipped') continue;
        recordExecutionServing(attempt.providerId, attempt.modelId);
      }
      return;
    }
    if (result.serving) recordExecutionServing(result.serving.providerId, result.serving.modelId);
  };
  const executionParenthetical = (): string => (executionServings.length === 0
    ? ''
    : ` (execution: servings=${executionServings.map((serving) => `${serving.providerId}|${serving.modelId ?? '-'}`).join(',')}; repair=${executionRepairRetried ? 1 : 0})`);
  // Reference context (対策5): built once per step from the set's
  // file texts and attached to this step's primary-table chunk
  // calls only. Rows runs only — findings and text runs keep their
  // previous inputs exactly. An empty result (no reference tables)
  // leaves every call unchanged.
  const referenceContext = outputKind === 'rows'
    ? buildAgentReferenceContext(files, view.primaryFileName)
    : '';
  const instruction = analyzerInstruction(
    outputKind,
    goalInstruction,
    view,
    structuredJsonKeys.length > 0 ? structuredJsonKeys : undefined,
    auditMode,
    referenceContext.length > 0,
  );
  // Inter-chunk interval (design §2-E): while its switch is on, the
  // sends of one step are spaced by AGENT_ANALYZER_CHUNK_INTERVAL_MS
  // (between chunks only — never before the step's first chunk, and
  // never between a chunk's first call and its repair call, which are
  // one chunk's business). Read from the same env the model executor
  // is built from, so a test's injected env governs both.
  const chunkIntervalOn = agentAnalyzerChunkIntervalEnabled(context?.env ?? process.env);
  // The primary-table contract's per-step state (Basel segment-2
  // fix): the rows this step obtained from primary-table chunks —
  // the chunk-local yardstick's numerator (案2) — and the count of
  // rows discarded from non-primary chunks (案1). Both stay empty
  // unless the set's rows yardstick is a real table key.
  const primaryFileName = view.primaryFileName;
  const stepPrimaryRows: AgentDataRow[] = [];
  let discardedRowsThisStep = 0;
  let isFirstChunkOfStep = true;
  for (const chunk of range) {
    if (!isFirstChunkOfStep && chunkIntervalOn) await sleepMs(AGENT_ANALYZER_CHUNK_INTERVAL_MS);
    isFirstChunkOfStep = false;
    const userText = chunkModelInput(view, chunk, referenceContext);
    // The chunk's global index rides every call for this chunk —
    // first attempt and repair alike — so the alternating allocation
    // (design §2-C) assigns the chunk deterministically, including
    // across a resume that replays the step.
    const first = await callModelWithTransientRetry({ instruction, userText, goal: goalInstruction, chunkIndex: chunk.index });
    noteExecutionServing(first);
    if (first.ok === false) return fail(analyzerProviderFailureMessage(first) + executionParenthetical());
    const firstParsed = parseChunkOutputDetailed(outputKind, first.text, view, { auditMode });
    let output: ChunkOutput | null = firstParsed.ok ? firstParsed.output : null;
    if (firstParsed.ok === false) {
      // Exactly one repair retry (§4.2), now told which validation
      // condition rejected the first response (Basel fix D): the
      // generic "return JSON" wording made a model resubmit the same
      // shape — for a fragment with no key-bearing target, the same
      // failing rows — because nothing named the actual defect.
      executionRepairRetried = true;
      const repair = await callModelWithTransientRetry({
        instruction: `${instruction}${parseFailureRepairGuidance(firstParsed.reason, outputKind, view)}`,
        userText,
        goal: goalInstruction,
        chunkIndex: chunk.index,
      });
      noteExecutionServing(repair);
      if (repair.ok === false) return fail(analyzerProviderFailureMessage(repair) + executionParenthetical());
      const repairParsed = parseChunkOutputDetailed(outputKind, repair.text, view, { auditMode });
      if (repairParsed.ok === false) {
        // Observability (Basel fix, diagnosis §4): the terminal code
        // stays AGENT_DATA_OUTPUT_INVALID — the advancer's code
        // extraction reads the leading token, exactly as it does for
        // the coverage failure below — and the message additionally
        // names the chunk's global index and the parse-failure
        // reason, never the response body, so the step record can
        // say which chunk failed and why.
        return fail(`AGENT_DATA_OUTPUT_INVALID (chunk ${chunk.index}, parse: ${repairParsed.reason})${executionParenthetical()}`);
      }
      output = repairParsed.output;
    }
    if (!output) return fail('AGENT_DATA_OUTPUT_INVALID' + executionParenthetical());
    if (outputKind === 'rows' && primaryFileName !== undefined && chunk.fileName !== primaryFileName) {
      // Primary-table contract (Basel segment-2 fix, 案1): in a
      // keyed rows run only the primary table's chunks are
      // extraction targets. Rows a non-primary chunk produced —
      // reference-table rows, the output schema's sample rows —
      // are discarded deterministically instead of being merged,
      // where they would otherwise surface at the final step as
      // unexpected keys and numeric mismatches no segment could be
      // blamed for. The discard is counted, never silent: the
      // bundle's coverage block carries the chain's total. Rows
      // the model fabricates inside a primary chunk still fail
      // coverage exactly as before — the fail-closed judgment is
      // unchanged inside the primary table's range.
      discardedRowsThisStep += output.rows.length;
    } else {
      merged.rows.push(...output.rows);
      if (outputKind === 'rows' && primaryFileName !== undefined) stepPrimaryRows.push(...output.rows);
    }
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
    // Layer-1 audit sections merge only in audit mode: values with
    // exact-duplicate removal (the same value reported by two
    // chunks is one row of the table), the structure map with the
    // deterministic first-seen merge.
    if (auditMode && outputKind === 'findings') {
      for (const value of output.values) {
        const key = `${value.entity}|${value.attribute}|${value.value}|${value.file}|${value.location}`;
        if (!merged.values.some((existing) => `${existing.entity}|${existing.attribute}|${existing.value}|${existing.file}|${existing.location}` === key)) {
          merged.values.push(value);
        }
      }
      merged.structure = mergeAgentDataStructures(merged.structure, output.structure);
      // C1/C2 (diagnosis 2026-11-26): deterministic numeric seeds
      // from this chunk's own text, merged into the value table
      // beside the model's rows — the model drops numbers the
      // fragmentation splits across lines, the seeds do not — and
      // a seed corrects a model row's entity when the row's own
      // subject says otherwise. Seeds never change the findings
      // or the rendered content, only the table the deterministic
      // candidate computation reads.
      merged.values = applyAgentDataValueSeeds(merged.values, extractAgentDataValueSeeds(chunk), merged.structure);
    }
  }

  // Diagnostic bundle (K-17 target B, design AGENT_K17_FAILED_STEP_
  // ARTIFACT_DESIGN_2026-11-24 §2/§5): the artifact this step has
  // computed from the merge so far, built by exactly the code the
  // success return below uses. The post-merge gates after this
  // point — chunk-local coverage, the final coverage verification,
  // the required-columns check — refuse the step AFTER the bundle
  // exists; their failures attach the bundle on the result's
  // diagnostic channel so the rows that were actually produced
  // survive for diagnosis (which rows are missing, which values
  // diverge), instead of only the failure message's aggregates.
  // The attachment changes nothing about the failure itself: ok
  // stays false, the code and message are byte-identical, and the
  // bundle never becomes the step's artifact — the executor keeps
  // it off the dataflow channel, so no later step can consume it.
  const buildBundleArtifact = (): string => {
    const content = outputKind === 'rows'
      ? renderAgentDataRowsCsv(view, merged.rows)
      : outputKind === 'findings'
        ? renderFindings(merged.findings, goalInstruction)
        : merged.textParts.join('\n\n');
    return JSON.stringify({
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
      // Layer-1 audit sections ride the bundle only in audit mode;
      // the mismatch candidates are computed once, deterministically,
      // on the step that completes the set — intermediate bundles
      // carry the table and the map the final step cross-checks.
      ...(outputKind === 'findings' && auditMode
        ? {
            values: merged.values,
            structure: merged.structure,
            ...(isFinalStep
              ? {
                  candidates: computeAgentDataValueMismatches(merged.values, merged.structure),
                  // The value table's recorded summary (対策1(d)):
                  // computed on the same final step as the
                  // candidates, from the same merged table.
                  valueTable: summarizeAgentDataValueTable(merged.values, merged.structure),
                }
              : {}),
          }
        : {}),
      ...(outputKind === 'rows' && Object.keys(view.aggregates).length > 0 ? { aggregates: view.aggregates } : {}),
      // BIA inputs (failure diagnosis 2026-11-24, 対策6): when the
      // set carries a readable Basel parameter table, its parsed
      // inputs ride the FINAL rows bundle so the capital-calculation
      // document step assembles its file deterministically from
      // them. The inputs are the set's own numbers, parsed by a pure
      // function — the model never sees this block and never
      // computes the capital. Sets without the table's shape carry
      // nothing and their bundles stay byte-identical.
      ...(outputKind === 'rows' && isFinalStep
        ? (() => {
            const biaInputs = parseBaselBiaInputs(files);
            return biaInputs ? { biaInputs } : {};
          })()
        : {}),
      coverage: {
        totalChunks: view.totalChunks,
        processedChunks: chunkOffset + range.length,
        ...(outputKind === 'rows' && !agentDataUsesFileNameKeys(view) ? { keyCount: view.expectedKeys.length } : {}),
        // Rows discarded under the primary-table contract (案1),
        // accumulated across the chain so the final bundle keeps the
        // total observable. Observability only — never a gate.
        ...(outputKind === 'rows' ? { discardedRows: priorDiscardedRows + discardedRowsThisStep } : {}),
      },
      // Execution trace (see the trace note at the chunk loop): the
      // servings this step's calls actually used and whether the
      // repair retry ran, read back by the advancer into the step's
      // live detail. Present only when a serving was recorded.
      ...(executionServings.length > 0
        ? { execution: { servings: executionServings, repairRetried: executionRepairRetried } }
        : {}),
      chunkRange: { offset: chunkOffset, count: range.length },
    });
  };
  const failWithDiagnosticBundle = (message: string): ToolResult => ({
    ok: false,
    tool,
    message,
    diagnosticArtifact: buildBundleArtifact(),
    ...(modelCallTimings.length > 0 ? { modelCallTimings: [...modelCallTimings] } : {}),
  });

  // Chunk-local coverage (Basel segment-2 fix, 案2): a step whose
  // range completes primary-table chunks must account for exactly
  // those chunks' keys and numeric subtotals from its own output.
  // The final whole-set verification below remains the last gate,
  // unchanged in meaning.
  if (outputKind === 'rows' && primaryFileName !== undefined) {
    // Deterministic numeric copy (Basel coverage diagnosis
    // 2026-11-24, 案1): this step's primary rows take their
    // declared numeric columns from the input itself, by key —
    // never from the model's transcription — before the local
    // gate below verifies them. The step's rows are the same
    // objects the merge holds, so the final gate and the
    // rendered artifact inherit the copied values; the final
    // step re-applies the copy to the whole merge regardless.
    applyAgentDataNumericCopy(view, stepPrimaryRows);
    const primaryChunksInRange = range.filter((chunk) => chunk.fileName === primaryFileName);
    if (primaryChunksInRange.length > 0) {
      const localCoverage = verifyAgentDataLocalCoverage(view, primaryChunksInRange, stepPrimaryRows);
      if (localCoverage.ok === false) {
        return failWithDiagnosticBundle(agentDataCoverageFailureMessage('local', localCoverage, { chunkOffset, chunkCount: range.length }) + executionParenthetical());
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
        return failWithDiagnosticBundle(`AGENT_DATA_COVERAGE_INSUFFICIENT (対象${chunkCoverage.expectedChunks}チャンク中${Math.max(0, chunkCoverage.processedChunks)}チャンクを処理、行${chunkCoverage.rowCount}件)${executionParenthetical()}`);
      }
    } else {
      // Deterministic numeric copy (diagnosis 案1) over the
      // whole merge, before the final gate: this step's own rows
      // were already copied above and re-applying is idempotent;
      // rows a predecessor bundle carried in are covered here.
      applyAgentDataNumericCopy(view, merged.rows);
      const coverage = verifyAgentDataCoverage(view, merged.rows);
      if (coverage.ok === false) {
        return failWithDiagnosticBundle(agentDataCoverageFailureMessage('final', coverage) + executionParenthetical());
      }
    }
  }

  // Required output columns (failure diagnosis 2026-11-24, 対策4):
  // when the set carries an output schema, the final rows must
  // carry its columns on every row. The coverage gates above judge
  // the input's own yardstick (keys and copied numbers); they say
  // nothing about derived columns, so a run whose rows were the
  // input copied verbatim — no classification columns at all —
  // passed them and "completed" (production Basel, scored Fail/0).
  // This check is the schema contract's gate half: fail closed,
  // naming the missing columns, instead of completing.
  if (isFinalStep && outputKind === 'rows') {
    const missingColumns = findMissingAgentDataRequiredColumns(view, merged.rows);
    if (missingColumns.length > 0) {
      return failWithDiagnosticBundle(`AGENT_DATA_REQUIRED_COLUMNS_MISSING (columns: ${missingColumns.join(', ')})${executionParenthetical()}`);
    }
  }

  const artifact = buildBundleArtifact();
  return {
    ok: true,
    tool,
    artifact,
    message: `Attachment data analyzed (${chunkOffset + range.length}/${view.totalChunks} chunk(s)).`,
    ...(modelCallTimings.length > 0 ? { modelCallTimings: [...modelCallTimings] } : {}),
  };
}

/**
 * The closed set of drop-reason categories the reconciliation
 * records (design §2 layer 2, observability): why a finding did
 * not survive the pairing discipline, in the failure-type
 * vocabulary of the diagnosis (協議混同／主体混同／略称／定型開示／
 * 対なし). Anything outside the set is not a recorded reason.
 */
export const AGENT_RECONCILIATION_DROP_REASONS: readonly string[] = [
  'agreement-mismatch',
  'entity-mismatch',
  'abbreviation',
  'boilerplate',
  'no-pair',
  'other',
];

/**
 * The reconciliation's recorded outcome (design §2 layer 2,
 * observability): counts only — never finding text — carried in
 * the output bundle and read back into the step's live detail by
 * the advancer, in the same style as the coverage breakdown.
 * `failed` marks a shadow run whose reconciliation could not be
 * judged (provider failure or unparseable output): shadow never
 * fails a run or changes its deliverable, so the failure is
 * recorded here instead. `failureCode` names why it could not be
 * judged (function inspection 2026-11-25, D4): the code the step
 * would have failed with under enforce — the provider's own code
 * for a provider failure, AGENT_RECONCILIATION_OUTPUT_INVALID
 * for output that stayed unparseable after the repair retry, or
 * AGENT_RECONCILIATION_NO_FINDINGS when candidates existed but
 * no finding survived the discipline. Until now `failed` was
 * recorded without its reason, so each shadow failure spent the
 * observation the mode exists to collect: the enforce decision
 * could not tell a provider outage from an output-shape problem
 * from an empty judgment. Present only with `failed`.
 */
export type AgentDataReconciliationSummary = {
  mode: 'shadow' | 'enforce';
  candidateCount: number;
  keptCount: number;
  droppedCount: number;
  droppedReasons: Record<string, number>;
  pickedUpCount: number;
  failed?: boolean;
  failureCode?: string;
  /**
   * Which original findings the judgment kept and dropped, by
   * their index in the source bundle, with the drop reasons
   * (failure diagnosis 2026-11-24, 対策1(a)). Indexes and reason
   * tokens are not finding text, so carrying them does not break
   * the counts-only discipline the record layer keeps — but
   * without them the shadow observation could not answer its own
   * question (the production M&A run kept 2 of 5 findings, at
   * least one of them necessarily a misreading, and which two was
   * unrecoverable from the record). Present only when the
   * reconciliation was actually judged; a shadow failure that
   * could not judge carries neither list.
   */
  keptIndexes?: number[];
  droppedIndexes?: { index: number; reason: string }[];
};

type AuditBundle = {
  findings: AgentDataFinding[];
  values: AgentDataValue[];
  structure: AgentDataStructure;
  candidates: AgentDataValueMismatch[];
  /** Whether the source bundle carried the layer-1 sections at
   * all: the pass-through forms re-emit them only when present,
   * so a bundle without them keeps its shape. */
  hasAuditSections: boolean;
  coverage?: unknown;
  chunkRange?: unknown;
};

function parseAuditBundle(content: string, view: AgentAttachmentDataView): AuditBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.kind !== 'data-analysis' || raw.outputKind !== 'findings') return null;
  const prior = parsePriorBundle(content, 'findings', view);
  if (!prior) return null;
  const isPlain = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  return {
    findings: prior.findings,
    values: prior.values,
    structure: prior.structure,
    candidates: prior.candidates ?? [],
    hasAuditSections: 'values' in raw || 'structure' in raw || 'candidates' in raw,
    ...(isPlain(raw.coverage) ? { coverage: raw.coverage } : {}),
    ...(isPlain(raw.chunkRange) ? { chunkRange: raw.chunkRange } : {}),
  };
}

function reconcilerInstruction(goalInstruction: string): string {
  const head = 'あなたは監査所見の照合担当です。与えられた所見リスト・値の食い違い候補・構造マップだけを使い、JSONだけを返してください。説明文やコードフェンスは付けないでください。生の文書本文は渡されていません。引用は素材に載っているものだけを使い、新しい引用や値を作らないでください。';
  const discipline = '所見を残す条件（対の規律）: (1) 1つの属性（金額・比率・資金源泉・日付など）が明示されていること。(2) 比較の両辺が同一の主体・同一の合意の範囲に属すること（構造マップで確認し、範囲が不明なものは落とすこと）。(3) 食い違う2値が、それぞれ異なる引用（異なる文書、または同一文書内の異なる箇所）で示されていること。(4) 手続き未了などの定型の状況開示だけで、他文書が異なる状態を述べていないものは不整合ではないこと。(5) 略称は構造マップの定義で解決してから比較すること。';
  const shape = '出力形式: {"findings":[{"claim":"所見","explanation":"なぜ矛盾と言えるのかの説明","evidence":"引用1","file":"ファイル名1","location":"場所1","evidenceB":"引用2","fileB":"ファイル名2","locationB":"場所2","source":{"kind":"kept","index":0}}],"dropped":[{"index":0,"reason":"no-pair"}]}。findingsには吟味済みの所見だけを入れ、各所見にsource（元の所見は{"kind":"kept","index":元の番号}、候補から作った所見は{"kind":"candidate","index":候補の番号}）を付けてください。droppedには落とした元の所見の番号と理由（agreement-mismatch／entity-mismatch／abbreviation／boilerplate／no-pair／other）を入れてください。値の食い違い候補のうち対の規律を満たすものは所見化してください。';
  const budget = AGENT_ATTACHMENT_INSTRUCTION_TOTAL_MAX_CHARS - head.length - discipline.length - shape.length - '依頼: '.length;
  const clipped = clipAgentAttachmentInstruction(
    goalInstruction,
    Math.max(0, Math.min(AGENT_ATTACHMENT_INSTRUCTION_MAX_CHARS, budget)),
  );
  return `${head}${discipline}${shape}依頼: ${clipped}`;
}

/**
 * The reconciliation's model input: the merged findings (numbered,
 * so the output can name them), the deterministic candidates and
 * the structure map — never raw chunk text. Field lengths are the
 * stored caps, with claim and explanation additionally clipped
 * for input size only; the bundle keeps the full text.
 */
function reconcilerMaterials(bundle: AuditBundle): string {
  const findings = bundle.findings.map((finding, index) => ({
    index,
    claim: finding.claim.slice(0, 500),
    ...(finding.explanation ? { explanation: finding.explanation.slice(0, 800) } : {}),
    evidence: finding.evidence,
    file: finding.file,
    location: finding.location,
    ...(finding.evidenceB ? { evidenceB: finding.evidenceB } : {}),
    ...(finding.fileB ? { fileB: finding.fileB } : {}),
    ...(finding.locationB ? { locationB: finding.locationB } : {}),
  }));
  return JSON.stringify({ findings, candidates: bundle.candidates, structure: bundle.structure });
}

/** Where one vetted finding came from: a kept original (by its
 * index in the source bundle) or a value-mismatch candidate it
 * was built from (by the candidate's index). Carried per finding
 * so the pair gate (D3) can anchor each finding to the pair it
 * claims descent from. */
export type AgentReconciliationFindingSource = { kind: 'kept' | 'candidate'; index: number };

export type AgentReconciliationParseResult =
  | {
      ok: true;
      findings: AgentDataFinding[];
      /** Aligned with `findings`: each vetted finding's source. */
      sources: AgentReconciliationFindingSource[];
      dropped: { index: number; reason: string }[];
      keptCount: number;
      /** The kept originals' indexes, ascending (対策1(a)). */
      keptIndexes: number[];
      pickedUpCount: number;
    }
  | { ok: false };

/**
 * Validates the reconciliation model's output against the pairing
 * discipline's mechanical half: every vetted finding must carry a
 * claim, an explanation and TWO citations (the discipline's rule
 * 3 — a finding whose pair cannot be shown is not vetted), and
 * must name its source — a kept original (index in range, no
 * duplicates) or a candidate it was built from (index in range).
 * The semantic half (same entity, same agreement, boilerplate
 * judgment) is the model's, instructed above; whether the cited
 * pair actually stands in the value table is NOT judged here —
 * that half is deterministic and applied by the pair gate
 * (applyAgentDataPairGate) on the parsed result. Dropped entries are
 * observability: malformed ones are discarded, never fatal, and
 * an index that was also kept is kept (the kept list wins).
 */
export function parseReconciliationOutput(
  text: string,
  originalCount: number,
  candidateCount: number,
): AgentReconciliationParseResult {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.findings)) return { ok: false };
  const findings: AgentDataFinding[] = [];
  const sources: AgentReconciliationFindingSource[] = [];
  const keptIndexes = new Set<number>();
  let pickedUpCount = 0;
  for (const raw of record.findings) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
    const item = raw as Record<string, unknown>;
    const claim = typeof item.claim === 'string' ? item.claim.trim() : '';
    const explanation = typeof item.explanation === 'string' ? item.explanation.trim().slice(0, 1000) : '';
    const evidence = typeof item.evidence === 'string' ? item.evidence.trim().slice(0, 200) : '';
    const evidenceB = typeof item.evidenceB === 'string' ? item.evidenceB.trim().slice(0, 200) : '';
    if (!claim || !explanation || !evidence || !evidenceB) return { ok: false };
    const source = item.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return { ok: false };
    const sourceRecord = source as Record<string, unknown>;
    const index = typeof sourceRecord.index === 'number' && Number.isInteger(sourceRecord.index)
      ? sourceRecord.index
      : -1;
    if (sourceRecord.kind === 'kept') {
      if (index < 0 || index >= originalCount || keptIndexes.has(index)) return { ok: false };
      keptIndexes.add(index);
      sources.push({ kind: 'kept', index });
    } else if (sourceRecord.kind === 'candidate') {
      if (index < 0 || index >= candidateCount) return { ok: false };
      pickedUpCount += 1;
      sources.push({ kind: 'candidate', index });
    } else {
      return { ok: false };
    }
    const type = typeof item.type === 'string' && item.type.trim() ? item.type.trim().slice(0, 80) : undefined;
    const severity = validFindingSeverity(item.severity);
    findings.push({
      claim,
      evidence,
      file: typeof item.file === 'string' ? item.file.trim() : '',
      location: typeof item.location === 'string' ? item.location.trim() : '',
      explanation,
      evidenceB,
      fileB: typeof item.fileB === 'string' ? item.fileB.trim() : '',
      locationB: typeof item.locationB === 'string' ? item.locationB.trim() : '',
      ...(type ? { type } : {}),
      ...(severity ? { severity } : {}),
    });
  }
  const dropped: { index: number; reason: string }[] = [];
  if (Array.isArray(record.dropped)) {
    for (const raw of record.dropped) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const index = typeof item.index === 'number' && Number.isInteger(item.index) ? item.index : -1;
      const reason = typeof item.reason === 'string' && AGENT_RECONCILIATION_DROP_REASONS.includes(item.reason)
        ? item.reason
        : '';
      if (index < 0 || index >= originalCount || !reason) continue;
      if (keptIndexes.has(index)) continue;
      if (dropped.some((entry) => entry.index === index)) continue;
      dropped.push({ index, reason });
    }
  }
  return {
    ok: true,
    findings,
    sources,
    dropped,
    keptCount: keptIndexes.size,
    keptIndexes: [...keptIndexes].sort((a, b) => a - b),
    pickedUpCount,
  };
}

function countReconciliationDropReasons(
  dropped: readonly { reason: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of dropped) counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
  return counts;
}

/**
 * One anchor group for the pair gate (D3): the conflicting
 * values of one (entity, canonical attribute) group, each with
 * its deterministic comparison key and its raw text.
 */
type AgentDataPairAnchorGroup = {
  values: { key: string; raw: string }[];
};

function pairAnchorGroupFromCandidate(candidate: AgentDataValueMismatch): AgentDataPairAnchorGroup | null {
  const canonicalAttribute = canonicalAgentDataAttribute(candidate.attribute);
  const byKey = new Map<string, string>();
  for (const entry of candidate.values) {
    const key = effectiveAgentDataValue(
      {
        entity: candidate.entity,
        attribute: candidate.attribute,
        value: entry.value,
        ...(entry.normalizedValue ? { normalizedValue: entry.normalizedValue } : {}),
        file: entry.file,
        location: entry.location,
      },
      canonicalAttribute,
    );
    if (!byKey.has(key)) byKey.set(key, entry.value);
  }
  if (byKey.size < 2) return null;
  return { values: [...byKey.entries()].map(([key, raw]) => ({ key, raw })) };
}

function buildPairAnchorGroups(bundle: {
  values: readonly AgentDataValue[];
  structure: AgentDataStructure;
  candidates: readonly AgentDataValueMismatch[];
}): {
  tableGroups: AgentDataPairAnchorGroup[];
  candidateGroups: (AgentDataPairAnchorGroup | null)[];
} {
  // The table's own groups, recomputed from the value table so a
  // bundle whose candidate list is stale or absent still anchors
  // against the table itself; the bundle's candidates anchor
  // additionally, aligned by index for candidate-built findings.
  const tableGroups = computeAgentDataValueMismatches(bundle.values, bundle.structure)
    .map((mismatch) => ({
      values: mismatch.values.map((entry) => ({ key: entry.normalizedValue, raw: entry.value })),
    }));
  const candidateGroups = bundle.candidates.map((candidate) => pairAnchorGroupFromCandidate(candidate));
  return { tableGroups, candidateGroups };
}

/**
 * The deterministic key of one citation for the pair gate: the
 * typed value the citation quotes — the whole citation read as
 * a value, else the first date or amount token it carries, else
 * its funding composition. A citation quoting no typed value has
 * no key and can only match an anchor value verbatim.
 */
export function agentDataCitationPairKey(citation: string): string | undefined {
  const typed = normalizeAgentDataTypedValue(citation);
  if (typed !== undefined) return typed;
  const text = citation.normalize('NFKC');
  const ymd = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(text);
  if (ymd) {
    const iso = normalizeAgentDataValueText(`${ymd[1]}-${ymd[2]}-${ymd[3]}`);
    if (iso !== undefined) return iso;
  }
  const token = /[+-]?\d[\d,]*(?:\.\d+)?\s*[%％]?/.exec(text);
  if (token) {
    const key = normalizeAgentDataValueText(token[0]);
    if (key !== undefined) return key;
  }
  return canonicalAgentDataFundingKey(citation);
}

/** The anchor values one citation matches in a group: by its
 * deterministic key, or verbatim when the citation carries the
 * value's text but no typed reading (a name, a classification
 * phrase). Verbatim matching needs a value text of at least two
 * characters so a stray digit or mark cannot anchor a pair. */
function citationAnchorKeys(citation: string, group: AgentDataPairAnchorGroup): Set<string> {
  const matched = new Set<string>();
  const key = agentDataCitationPairKey(citation);
  const text = citation.normalize('NFKC').trim();
  for (const value of group.values) {
    if (key !== undefined && value.key === key) {
      matched.add(value.key);
      continue;
    }
    const raw = value.raw.normalize('NFKC').trim();
    if (raw.length >= 2 && text.includes(raw)) matched.add(value.key);
  }
  return matched;
}

/**
 * Whether a finding's two citations anchor to one group (案A,
 * gate diagnosis 2026-11-26): each citation must pull at least
 * one of the group's values, and together they must pull at
 * least two distinct values. The pre-fix predicate additionally
 * required the second citation to pull a value the first did
 * not — a difference-set test that structurally rejected the
 * production R1 finding, whose first citation quotes BOTH
 * amounts of the pair (a faithful, complete citation), leaving
 * no key the second citation could add. The requirement that
 * both cited values actually stand in the group is unchanged:
 * a citation pulling no group value (first empty) still never
 * anchors, and a pair is still two distinct values of one
 * group — only which citation carries which value is no longer
 * prescribed.
 */
function findingAnchoredToGroup(finding: AgentDataFinding, group: AgentDataPairAnchorGroup): boolean {
  const first = citationAnchorKeys(finding.evidence, group);
  if (first.size === 0) return false;
  const second = citationAnchorKeys(finding.evidenceB ?? '', group);
  if (second.size === 0) return false;
  const union = new Set([...first, ...second]);
  return union.size >= 2;
}

export type AgentDataPairGateResult = {
  findings: AgentDataFinding[];
  keptIndexes: number[];
  dropped: { index: number; reason: string }[];
  pickedUpCount: number;
  /** Kept originals the gate removed, ascending (observability:
   * they join `dropped` with the reason 'no-pair'). */
  gatedOutKeptIndexes: number[];
};

/**
 * The pair gate (function inspection 2026-11-25, D3): the
 * deterministic half of the reconciliation's publication
 * condition. A vetted finding publishes only when its pair
 * actually stands in the value table — one (entity, canonical
 * attribute) group holding the two conflicting values its two
 * citations quote. A candidate-built finding must anchor to the
 * very candidate it claims descent from; a kept original may
 * anchor to any table or candidate group. A finding that cannot
 * form such a pair — the production M&A mispair combined a
 * funding-source value with an unrelated status disclosure —
 * does not publish: kept originals move to the dropped list
 * with the reason 'no-pair' (the record the enforce decision
 * reads, D4), candidate-built ones simply do not count as
 * picked up. The model's semantic judgment (agreement scope,
 * boilerplate) is untouched; the gate removes only what the
 * table itself cannot support.
 */
export function applyAgentDataPairGate(
  parsed: Extract<AgentReconciliationParseResult, { ok: true }>,
  bundle: {
    values: readonly AgentDataValue[];
    structure: AgentDataStructure;
    candidates: readonly AgentDataValueMismatch[];
  },
): AgentDataPairGateResult {
  const { tableGroups, candidateGroups } = buildPairAnchorGroups(bundle);
  const findings: AgentDataFinding[] = [];
  const keptIndexes: number[] = [];
  const gatedOutKeptIndexes: number[] = [];
  let pickedUpCount = 0;
  parsed.findings.forEach((finding, position) => {
    const source = parsed.sources[position];
    let anchored = false;
    if (source?.kind === 'candidate') {
      const group = candidateGroups[source.index];
      anchored = group !== null && group !== undefined && findingAnchoredToGroup(finding, group);
    } else {
      anchored = tableGroups.some((group) => findingAnchoredToGroup(finding, group))
        || candidateGroups.some((group) => group !== null && findingAnchoredToGroup(finding, group));
    }
    if (!anchored) {
      if (source?.kind === 'kept') gatedOutKeptIndexes.push(source.index);
      return;
    }
    findings.push(finding);
    if (source?.kind === 'kept') keptIndexes.push(source.index);
    else if (source?.kind === 'candidate') pickedUpCount += 1;
  });
  const dropped = [...parsed.dropped];
  for (const index of gatedOutKeptIndexes) {
    if (!dropped.some((entry) => entry.index === index)) {
      dropped.push({ index, reason: 'no-pair' });
    }
  }
  keptIndexes.sort((a, b) => a - b);
  gatedOutKeptIndexes.sort((a, b) => a - b);
  return { findings, keptIndexes, dropped, pickedUpCount, gatedOutKeptIndexes };
}

export type AgentDataCandidatePickupResult = {
  findings: AgentDataFinding[];
  pickedUpCount: number;
};

/**
 * Whether a surviving finding already states a candidate's
 * inconsistency: its two citations anchor to the candidate's
 * own group (案A's predicate) and the values they pull from
 * that group are exactly the candidate's normalized value set
 * — the same group and the same pair of values, nothing
 * looser. Anchoring alone does not suffice: a finding that
 * anchors to a wider group while pulling only some of its
 * values states a different (narrower) pair than the
 * candidate names.
 */
function findingCoversCandidateGroup(finding: AgentDataFinding, group: AgentDataPairAnchorGroup): boolean {
  if (!findingAnchoredToGroup(finding, group)) return false;
  const pulled = new Set([
    ...citationAnchorKeys(finding.evidence, group),
    ...citationAnchorKeys(finding.evidenceB ?? '', group),
  ]);
  if (pulled.size !== group.values.length) return false;
  return group.values.every((value) => pulled.has(value.key));
}

/**
 * The deterministic candidate pickup (案B, gate diagnosis
 * 2026-11-26): the layer behind the pair gate that ends the
 * pickup's single dependence on the reconciliation model's
 * output. A candidate the model was the only path to a finding
 * for — when the model built no finding from it, a perfectly
 * formed candidate died with the run under enforce. For every
 * candidate no surviving finding covers — coverage meaning a
 * surviving candidate-built finding descended from it, or a
 * surviving finding of any origin anchoring to its group with
 * exactly its value pair — this
 * synthesizes a finding from the candidate alone: its entity,
 * its attribute and its own two conflicting values with their
 * recorded sources — no new value, citation or claim of fact is
 * created. The synthesized finding must pass the same anchor
 * check against its own candidate's group that a candidate-
 * built model finding faces (案A's predicate), and it carries
 * the `origin: 'deterministic-candidate'` mark so the record
 * never confuses it with a model-written finding. The model's
 * own kept/dropped judgment is untouched, and fail-closed is
 * unchanged: when synthesis still leaves the judged list empty,
 * the caller fails exactly as before.
 */
export function synthesizeDeterministicCandidatePickups(
  parsed: Extract<AgentReconciliationParseResult, { ok: true }>,
  gated: AgentDataPairGateResult,
  bundle: {
    values: readonly AgentDataValue[];
    structure: AgentDataStructure;
    candidates: readonly AgentDataValueMismatch[];
  },
  japanese: boolean,
): AgentDataCandidatePickupResult {
  const { candidateGroups } = buildPairAnchorGroups(bundle);
  const covered = new Set<number>();
  parsed.findings.forEach((finding, position) => {
    const source = parsed.sources[position];
    if (source?.kind === 'candidate' && gated.findings.includes(finding)) {
      covered.add(source.index);
    }
  });
  // Coverage is not limited to candidate-built findings: a
  // surviving finding of ANY origin that anchors to the
  // candidate's own group with exactly the candidate's value
  // pair already states the inconsistency the candidate names,
  // so synthesizing a second finding for it would publish the
  // same pair twice (the production 8c49293c replay before this
  // adjustment: R1 survived as the model's kept original AND
  // was synthesized). The pair match stays exact — see
  // findingCoversCandidateGroup.
  bundle.candidates.forEach((candidate, index) => {
    if (covered.has(index)) return;
    const group = candidateGroups[index];
    if (!group) return;
    if (gated.findings.some((finding) => findingCoversCandidateGroup(finding, group))) {
      covered.add(index);
    }
  });
  const findings: AgentDataFinding[] = [];
  let pickedUpCount = 0;
  bundle.candidates.forEach((candidate, index) => {
    if (covered.has(index)) return;
    const group = candidateGroups[index];
    if (!group || group.values.length < 2) return;
    const firstValue = group.values[0];
    const secondValue = group.values[1];
    if (!firstValue || !secondValue) return;
    const firstEntry = candidate.values.find((entry) => entry.value === firstValue.raw) ?? candidate.values[0];
    const secondEntry = candidate.values.find((entry) => entry.value === secondValue.raw) ?? candidate.values[1] ?? firstEntry;
    if (!firstEntry || !secondEntry) return;
    const finding: AgentDataFinding = {
      claim: japanese
        ? `${candidate.entity}の${candidate.attribute}について、${firstValue.raw}と${secondValue.raw}という異なる値が示されています`
        : `Inconsistent ${candidate.attribute} values for ${candidate.entity}: ${firstValue.raw} versus ${secondValue.raw}`,
      explanation: japanese
        ? `値の照合で検出された食い違いです。${firstEntry.file}（${firstEntry.location}）では${firstValue.raw}、${secondEntry.file}（${secondEntry.location}）では${secondValue.raw}とされています。`
        : `Detected by the deterministic value cross-check: ${firstEntry.file} (${firstEntry.location}) states ${firstValue.raw}, while ${secondEntry.file} (${secondEntry.location}) states ${secondValue.raw}.`,
      evidence: firstValue.raw,
      file: firstEntry.file,
      location: firstEntry.location,
      evidenceB: secondValue.raw,
      fileB: secondEntry.file,
      locationB: secondEntry.location,
      origin: 'deterministic-candidate',
    };
    if (!findingAnchoredToGroup(finding, group)) return;
    findings.push(finding);
    pickedUpCount += 1;
  });
  return { findings, pickedUpCount };
}

/**
 * attachment_reconciler (misreading countermeasure design §2,
 * layer 2 — the single most effective move): the step the planner
 * issues after the last analyzer step of an inconsistency-audit
 * run, and only then. It makes exactly one model call over
 * deterministic material — the merged findings, the layer-1
 * value-mismatch candidates and the structure map; never raw
 * chunk text — and applies the pairing discipline: a finding
 * survives only with one attribute, both sides in the same
 * entity's and agreement's scope, and two differing values shown
 * by two citations; boilerplate status disclosures and unresolved
 * abbreviations are dropped; candidates that satisfy the
 * discipline are picked up into findings.
 *
 * Mode comes from ORIGIN_AGENT_FINDINGS_RECONCILIATION_ENABLED at
 * execution time (the planner issues the step only when the mode
 * was on at plan time; a switch turned off in between degrades
 * the step to an identity pass-through rather than failing a run
 * over a configuration change). The vetted list then passes the
 * deterministic pair gate (D3, applyAgentDataPairGate): a finding
 * whose cited pair does not stand in the value table does not
 * publish, in either mode's judgment — shadow records the gated
 * list and the 'no-pair' drops exactly as enforce publishes
 * them, and still ships the original bundle untouched. Behind
 * the gate, the deterministic candidate pickup (案B, gate
 * diagnosis 2026-11-26) synthesizes findings for candidates the
 * model's output left uncovered, so a candidate's survival no
 * longer depends on the model alone. Enforce fails closed when
 * candidates exist but the judged list — vetted, gated and
 * picked up — is still empty (AGENT_RECONCILIATION_NO_FINDINGS):
 * an audit that could not judge its candidates must not silently
 * report nothing. Shadow never fails the step and never changes
 * the deliverable — an unjudgeable reconciliation is recorded
 * with `failed: true` and the original bundle passes through.
 */
export async function executeAttachmentReconciler(
  params: ToolParams,
  context?: AgentAttachmentToolContext,
): Promise<ToolResult> {
  const tool = 'attachment_reconciler' as const;
  // Dispatch timing collection (D7 countermeasure A): same
  // discipline as the analyzer's — every dispatch appends in
  // order, an empty list attaches nothing.
  const modelCallTimings: AgentModelCallTiming[] = [];
  const fail = (message: string, diagnosticArtifact?: string): ToolResult => ({
    ok: false,
    tool,
    message,
    ...(diagnosticArtifact !== undefined ? { diagnosticArtifact } : {}),
    ...(modelCallTimings.length > 0 ? { modelCallTimings: [...modelCallTimings] } : {}),
  });
  const loaded = await loadBoundData(tool, params, context);
  if ('failure' in loaded) return loaded.failure;
  const { view } = loaded.data;
  const goalInstruction = typeof params.instruction === 'string' ? params.instruction : '';
  if (typeof params.content !== 'string' || params.content.trim().length === 0) {
    // Without the last analyzer step's bundle there is nothing to
    // reconcile; refuse instead of reporting an empty audit.
    return fail('AGENT_STEP_INPUT_UNAVAILABLE');
  }
  const bundle = parseAuditBundle(params.content, view);
  if (!bundle) return fail('AGENT_DATA_OUTPUT_INVALID');

  const buildArtifact = (input: {
    findings: AgentDataFinding[];
    content: string;
    summary?: AgentDataReconciliationSummary;
    reconciledFindings?: AgentDataFinding[];
  }): string => JSON.stringify({
    kind: 'data-analysis',
    content: input.content,
    outputKind: 'findings',
    findings: input.findings,
    ...(bundle.hasAuditSections
      ? { values: bundle.values, structure: bundle.structure, candidates: bundle.candidates }
      : {}),
    ...(input.summary ? { reconciliation: input.summary } : {}),
    ...(input.reconciledFindings ? { reconciledFindings: input.reconciledFindings } : {}),
    ...(bundle.coverage !== undefined ? { coverage: bundle.coverage } : {}),
    ...(bundle.chunkRange !== undefined ? { chunkRange: bundle.chunkRange } : {}),
  });
  const passThrough = (summary?: AgentDataReconciliationSummary): ToolResult => ({
    ok: true,
    tool,
    artifact: buildArtifact({
      findings: bundle.findings,
      content: renderFindings(bundle.findings, goalInstruction),
      ...(summary ? { summary } : {}),
    }),
    message: summary
      ? `Attachment findings reconciliation recorded in shadow (candidates ${summary.candidateCount}, kept ${summary.keptCount}, dropped ${summary.droppedCount}, picked up ${summary.pickedUpCount}).`
      : 'Attachment findings passed through without reconciliation.',
    ...(modelCallTimings.length > 0 ? { modelCallTimings: [...modelCallTimings] } : {}),
  });

  const mode = agentFindingsReconciliationMode(context?.env ?? process.env);
  if (mode === 'off') return passThrough();
  // A shadow failure records the code the step would have failed
  // with under enforce (D4): nothing was judged, so neither index
  // list is carried, but the reason always is.
  const shadowFailure = (failureCode: string): ToolResult => passThrough({
    mode: 'shadow',
    candidateCount: bundle.candidates.length,
    keptCount: 0,
    droppedCount: 0,
    droppedReasons: {},
    pickedUpCount: 0,
    failed: true,
    failureCode,
  });

  const modelCall = context?.modelCall ?? createAgentModelExecutor(context?.env ?? process.env);
  const sleepMs = context?.sleepMs ?? defaultSleepMs;
  // Timing capture below the transient-retry caller, exactly as
  // in the analyzer (D7 countermeasure A): every dispatch appends
  // one entry; results pass through untouched.
  const timedModelCall: AgentModelExecutor = async (input) => {
    const result = await modelCall(input);
    if (result.timing && modelCallTimings.length < MAX_AGENT_MODEL_CALL_TIMINGS_PER_STEP) {
      modelCallTimings.push(result.timing);
    }
    return result;
  };
  const callModelWithTransientRetry = createTransientRetryCaller(timedModelCall, sleepMs);
  const instruction = reconcilerInstruction(goalInstruction);
  const userText = reconcilerMaterials(bundle);
  const first = await callModelWithTransientRetry({ instruction, userText, goal: goalInstruction });
  if (first.ok === false) {
    if (mode === 'shadow') return shadowFailure(first.code);
    return fail(analyzerProviderFailureMessage(first));
  }
  let parsed = parseReconciliationOutput(first.text, bundle.findings.length, bundle.candidates.length);
  if (!parsed.ok) {
    // Exactly one repair retry, told the concrete defect class —
    // the same discipline as the analyzer's parse repair.
    const repair = await callModelWithTransientRetry({
      instruction: `${instruction}前回の応答は指定のJSON形式に適合しませんでした。各所見にはclaim・explanation・evidence・evidenceBとsource（kind と番号）を必ず含め、JSONだけを返してください。`,
      userText,
      goal: goalInstruction,
    });
    if (repair.ok === false) {
      if (mode === 'shadow') return shadowFailure(repair.code);
      return fail(analyzerProviderFailureMessage(repair));
    }
    parsed = parseReconciliationOutput(repair.text, bundle.findings.length, bundle.candidates.length);
    if (!parsed.ok) {
      if (mode === 'shadow') return shadowFailure('AGENT_RECONCILIATION_OUTPUT_INVALID');
      return fail('AGENT_RECONCILIATION_OUTPUT_INVALID');
    }
  }
  // The pair gate (D3): the vetted list publishes only the
  // findings whose cited pair stands in the value table. Audit
  // bundles only — a bundle without the layer-1 sections has no
  // table to anchor against and keeps the pre-gate judgment.
  const gated = bundle.hasAuditSections
    ? applyAgentDataPairGate(parsed, bundle)
    : {
        findings: parsed.findings,
        keptIndexes: parsed.keptIndexes,
        dropped: parsed.dropped,
        pickedUpCount: parsed.pickedUpCount,
        gatedOutKeptIndexes: [] as number[],
      };
  // The deterministic candidate pickup (案B, gate diagnosis
  // 2026-11-26): candidates the model's output left uncovered
  // are synthesized into findings from the candidate alone, so
  // a candidate's survival no longer depends on the model alone.
  // Audit bundles only, like the gate — the pickup anchors
  // against the same layer-1 material.
  const pickup = bundle.hasAuditSections
    ? synthesizeDeterministicCandidatePickups(
        parsed,
        gated,
        bundle,
        agentGoalRendersJapaneseLabels(goalInstruction),
      )
    : { findings: [] as AgentDataFinding[], pickedUpCount: 0 };
  const judgedFindings = [...gated.findings, ...pickup.findings];
  const summary: AgentDataReconciliationSummary = {
    mode,
    candidateCount: bundle.candidates.length,
    keptCount: gated.keptIndexes.length,
    droppedCount: gated.dropped.length,
    droppedReasons: countReconciliationDropReasons(gated.dropped),
    pickedUpCount: gated.pickedUpCount + pickup.pickedUpCount,
    // Which findings were kept/dropped (対策1(a)): the judged case
    // only — the shadow-failure summaries built earlier carry
    // neither list, because nothing was judged there.
    keptIndexes: gated.keptIndexes,
    droppedIndexes: gated.dropped.map((dropped) => ({ index: dropped.index, reason: dropped.reason })),
  };
  if (judgedFindings.length === 0 && (bundle.candidates.length > 0 || parsed.findings.length > 0)) {
    // Fail closed (enforce): candidates the run could not judge —
    // or vetted findings the pair gate could not anchor — must
    // not become a silently empty report. Shadow records the
    // same fact and passes the original findings through.
    if (mode === 'enforce') {
      // C0 (diagnosis 2026-11-26): the summary computed just
      // above would otherwise be discarded with the failure —
      // attach it to the K-17 diagnostic channel (counts and
      // indexes only, never finding text) together with how many
      // findings the model vetted, so the next failed run's
      // record says whether the model or the gate emptied the
      // list. The code and message are unchanged; ok stays false.
      return fail('AGENT_RECONCILIATION_NO_FINDINGS', JSON.stringify({
        kind: 'attachment-reconciliation-failure',
        reconciliation: summary,
        parsedFindingsCount: parsed.findings.length,
        // 案C (gate diagnosis 2026-11-26): the parse stage's own
        // pickup count and the gate's added drops ride alongside,
        // so the record separates what the model declared (its
        // dropped list, its candidate findings) from what the
        // gate removed — the decomposition the C0 record alone
        // could not make.
        parsedPickedUpCount: parsed.pickedUpCount,
        gatedOutKeptIndexes: gated.gatedOutKeptIndexes,
      }));
    }
    return passThrough({ ...summary, failed: true, failureCode: 'AGENT_RECONCILIATION_NO_FINDINGS' });
  }
  if (mode === 'shadow') {
    return {
      ok: true,
      tool,
      artifact: buildArtifact({
        findings: bundle.findings,
        content: renderFindings(bundle.findings, goalInstruction),
        summary,
        reconciledFindings: judgedFindings,
      }),
      message: `Attachment findings reconciliation recorded in shadow (candidates ${summary.candidateCount}, kept ${summary.keptCount}, dropped ${summary.droppedCount}, picked up ${summary.pickedUpCount}).`,
      ...(modelCallTimings.length > 0 ? { modelCallTimings: [...modelCallTimings] } : {}),
    };
  }
  return {
    ok: true,
    tool,
    artifact: buildArtifact({
      findings: judgedFindings,
      content: renderFindings(judgedFindings, goalInstruction),
      summary,
    }),
    message: `Attachment findings reconciled (candidates ${summary.candidateCount}, kept ${summary.keptCount}, dropped ${summary.droppedCount}, picked up ${summary.pickedUpCount}).`,
    ...(modelCallTimings.length > 0 ? { modelCallTimings: [...modelCallTimings] } : {}),
  };
}
