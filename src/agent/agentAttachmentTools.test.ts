// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toolRegistry, type ToolExecutionContext } from './toolRegistry.js';
import { InMemoryAgentAttachmentStore } from './agentAttachmentStoreMemory.fixture.js';
import {
  computeAgentAttachmentSetDigest,
  validateAgentAttachmentFileText,
} from './agentAttachmentRecord.js';
import { servingFromRoutingEvidence, type AgentModelExecutor } from './agentModelCall.js';
import {
  AGENT_ANALYZER_CHUNK_INTERVAL_MS,
  AGENT_AUDIT_ATTRIBUTE_VOCABULARY,
  agentGoalUsesCjk,
  computeAgentDataValueMismatches,
  mergeAgentDataStructures,
  normalizeAgentDataValueText,
  parseChunkOutputDetailed,
  parseFailureRepairGuidance,
  parseReconciliationOutput,
  summarizeAgentDataValueTable,
  type AgentDataValue,
} from './agentAttachmentTools.js';
import { buildAgentAttachmentDataView } from './agentAttachmentData.js';

const OWNER = 'ab'.repeat(32); // owner bindings are sha256 hex digests
const SET_ID = 'att-12345678-abcd-4ef0-9abc-def012345678';
const FRUITS = ['id,item,amount', 'A-1,りんご,120', 'A-2,みかん,80', 'A-3,ぶどう,300'].join('\n');

async function storeWithFruits() {
  const store = new InMemoryAgentAttachmentStore();
  await store.createSet({
    setId: SET_ID,
    ownerBinding: OWNER,
    uploadTokenDigest: 'cd'.repeat(32),
    expiresAt: Date.now() + 3_600_000,
  });
  const measured = validateAgentAttachmentFileText(FRUITS);
  await store.addFile(SET_ID, OWNER, {
    name: 'fruits.csv',
    mediaType: 'text/csv',
    kind: 'text',
    byteSize: measured.byteSize,
    charCount: measured.charCount,
    sha256: measured.sha256,
    extractedText: FRUITS,
  });
  const set = await store.getSet(SET_ID, OWNER);
  if (!set) throw new Error('fixture set missing');
  return { store, setDigest: computeAgentAttachmentSetDigest(set.files) };
}

function contextFor(
  store: InMemoryAgentAttachmentStore,
  modelCall?: AgentModelExecutor,
  sleepMs?: (ms: number) => Promise<void>,
): ToolExecutionContext {
  return {
    attachments: { store, ownerBinding: OWNER },
    ...(modelCall ? { modelCall } : {}),
    ...(sleepMs ? { sleepMs } : {}),
  };
}

/** Instant sleep fake that records the backoff schedule it was asked
 * to wait, so retry tests assert the schedule instead of sleeping. */
function recordingSleep(record: number[]): (ms: number) => Promise<void> {
  return async (ms: number) => {
    record.push(ms);
  };
}

/** Deterministic stand-in at the provider port: classifies each CSV
 * row in the chunk it is actually given (amount >= 200 → 高額). The
 * analyzer frames each chunk with a provenance line (【出典: …】);
 * like a real model, the stand-in reads it as metadata, not data. */
const classifyingExecutor: AgentModelExecutor = async ({ userText }) => {
  const lines = userText.split('\n').filter((line) => line.length > 0 && !line.startsWith('【出典:'));
  const rows = lines.slice(1).map((line) => {
    const [id, item, amount] = line.split(',');
    return { id, item, amount, category: Number(amount) >= 200 ? '高額' : '通常' };
  });
  return { ok: true, text: JSON.stringify({ rows }) };
};

const analyzerParams = (setDigest: string, extra: Record<string, unknown> = {}) => ({
  attachmentSetId: SET_ID,
  setDigest,
  instruction: '各行を金額で分類してください',
  outputKind: 'rows',
  chunkOffset: 0,
  chunkCount: 1,
  ...extra,
});

describe('attachment_reader tool', () => {
  it('profiles the bound set: first chunk, key field and counts', async () => {
    const { store, setDigest } = await storeWithFruits();
    const result = await toolRegistry.attachment_reader.execute(
      { attachmentSetId: SET_ID, setDigest },
      contextFor(store),
    );
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as Record<string, unknown>;
    expect(artifact.kind).toBe('attachment-profile');
    expect(artifact.content).toBe(FRUITS);
    expect(artifact.keyField).toBe('id');
    expect(artifact.keyCount).toBe(3);
    expect(artifact.totalChunks).toBe(1);
  });

  it('refuses a digest that does not match the stored contents', async () => {
    const { store } = await storeWithFruits();
    const result = await toolRegistry.attachment_reader.execute(
      { attachmentSetId: SET_ID, setDigest: 'f'.repeat(64) },
      contextFor(store),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_ATTACHMENT_DIGEST_MISMATCH');
  });

  it('fails closed when the run has no attachment port', async () => {
    const { setDigest } = await storeWithFruits();
    const result = await toolRegistry.attachment_reader.execute(
      { attachmentSetId: SET_ID, setDigest },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_ATTACHMENT_UNAVAILABLE');
  });

  it('rejects missing binding params', async () => {
    const { store } = await storeWithFruits();
    const result = await toolRegistry.attachment_reader.execute({}, contextFor(store));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_ATTACHMENT_PARAMS_INVALID');
  });
});

describe('attachment_analyzer tool', () => {
  it('produces a coverage-verified rows bundle rendered as CSV', async () => {
    const { store, setDigest } = await storeWithFruits();
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, classifyingExecutor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      kind: string; content: string; coverage: { keyCount: number };
      aggregates?: Record<string, { sum: number; count: number; mean: number }>;
    };
    expect(bundle.kind).toBe('data-analysis');
    expect(bundle.content).toContain('A-3,ぶどう,300,高額');
    expect(bundle.content).toContain('A-1,りんご,120,通常');
    expect(bundle.coverage.keyCount).toBe(3);
    expect(bundle.aggregates).toEqual({ amount: { sum: 500, count: 3, mean: 500 / 3 } });
  });

  it('fails with AGENT_DATA_COVERAGE_INSUFFICIENT when the model drops a row', async () => {
    const { store, setDigest } = await storeWithFruits();
    const droppingExecutor: AgentModelExecutor = async ({ userText }) => {
      const lines = userText.split('\n').filter((line) => line.length > 0 && !line.startsWith('【出典:')).slice(1, 3);
      const rows = lines.map((line) => {
        const [id, item, amount] = line.split(',');
        return { id, item, amount };
      });
      return { ok: true, text: JSON.stringify({ rows }) };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, droppingExecutor),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('AGENT_DATA_COVERAGE_INSUFFICIENT');
    expect(result.message).toContain('対象3件中2件を処理');
  });

  it('allows exactly one repair retry, then fails AGENT_DATA_OUTPUT_INVALID naming the chunk and reason', async () => {
    const { store, setDigest } = await storeWithFruits();
    let calls = 0;
    const garbageExecutor: AgentModelExecutor = async () => {
      calls += 1;
      return { ok: true, text: 'not json at all' };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, garbageExecutor),
    );
    expect(result.ok).toBe(false);
    // The terminal code is unchanged; the message additionally names
    // the failing chunk's global index and the parse-failure reason
    // (Basel observability) — never the response body.
    expect(result.message).toBe('AGENT_DATA_OUTPUT_INVALID (chunk 0, parse: json-not-extractable)');
    expect(calls).toBe(2);
  });

  it('tells the repair retry which validation failed: a missing key names the key field and the empty answer', async () => {
    const { store, setDigest } = await storeWithFruits();
    const instructions: string[] = [];
    const keylessExecutor: AgentModelExecutor = async (input) => {
      instructions.push(input.instruction);
      // Every response drops the key field `id` from its rows.
      return { ok: true, text: JSON.stringify({ rows: [{ item: 'りんご', amount: '120' }] }) };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, keylessExecutor),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_DATA_OUTPUT_INVALID (chunk 0, parse: row-key-missing)');
    expect(instructions).toHaveLength(2);
    // The repair instruction names the defect concretely: the key
    // field every row must carry, and the legitimate empty answer.
    expect(instructions[1]).toContain('キー項目「id」');
    expect(instructions[1]).toContain('{"rows":[]}');
    // And the base rows instruction itself carries the empty-answer
    // escape hatch from the start (Basel fix D).
    expect(instructions[0]).toContain('{"rows":[]} とだけ返してください。それが正しい応答です');
  });

  it('accepts {"rows":[]} for a reference chunk with no key-bearing target (Basel shape)', async () => {
    // The Basel trap-3 shape: a primary table with a real key, plus a
    // reference table whose rows carry a different key entirely. The
    // reference chunk is a non-final range here; an empty rows answer
    // is its only valid output and must parse.
    const store = new InMemoryAgentAttachmentStore();
    await store.createSet({
      setId: SET_ID,
      ownerBinding: OWNER,
      uploadTokenDigest: 'cd'.repeat(32),
      expiresAt: Date.now() + 3_600_000,
    });
    const events = ['Event_ID\tAmount', 'OR001\t100', 'OR002\t200'].join('\n');
    const categories = ['## sheet: Sheet1', 'Category_Code\tName', 'EL1\tInternal Fraud', 'EL2\tExternal Fraud'].join('\n');
    for (const [name, text] of [['events.tsv', events], ['categories.tsv', categories]] as const) {
      const measured = validateAgentAttachmentFileText(text);
      await store.addFile(SET_ID, OWNER, {
        name,
        mediaType: 'text/tab-separated-values',
        kind: 'text',
        byteSize: measured.byteSize,
        charCount: measured.charCount,
        sha256: measured.sha256,
        extractedText: text,
      });
    }
    const set = await store.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    const digest = computeAgentAttachmentSetDigest(set.files);
    // Chunk 0 is the events table, chunk 1 the reference table. The
    // executor answers real rows for the events chunk and the empty
    // answer for the reference chunk; the step completes the range,
    // so coverage judges the merged rows against the events keys.
    // Dispatch is by the provenance frame, not the body: since the
    // reference co-location (対策5) the events chunk's input also
    // CONTAINS the categories table (as its reference block), so a
    // body-content dispatch can no longer tell the chunks apart.
    const mixedExecutor: AgentModelExecutor = async (input) => {
      if (input.userText.startsWith('【出典: categories.tsv')) return { ok: true, text: '{"rows":[]}' };
      return {
        ok: true,
        text: JSON.stringify({ rows: [{ Event_ID: 'OR001', Amount: '100' }, { Event_ID: 'OR002', Amount: '200' }] }),
      };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(digest, { chunkOffset: 0, chunkCount: 2 }),
      contextFor(store, mixedExecutor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as { coverage: { keyCount: number } };
    expect(bundle.coverage.keyCount).toBe(2);
  });

  it('propagates the provider failure code as the step failure', async () => {
    const { store, setDigest } = await storeWithFruits();
    let calls = 0;
    const failingExecutor: AgentModelExecutor = async () => {
      calls += 1;
      return { ok: false, code: 'PROVIDER_TIMEOUT' };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, failingExecutor, recordingSleep([])),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('PROVIDER_TIMEOUT');
    // PROVIDER_TIMEOUT is in the transient class: the step retried
    // the chunk call twice before failing with the same code.
    expect(calls).toBe(3);
  });

  it('requires the previous bundle for a continuation step', async () => {
    // A multi-chunk set, so chunkOffset 1 is a valid range start and
    // only the missing predecessor bundle can refuse the step.
    const store = new InMemoryAgentAttachmentStore();
    await store.createSet({
      setId: SET_ID,
      ownerBinding: OWNER,
      uploadTokenDigest: 'cd'.repeat(32),
      expiresAt: Date.now() + 3_600_000,
    });
    const lines = ['id,item,amount'];
    for (let i = 0; i < 240; i += 1) lines.push(`R-${String(i).padStart(3, '0')},${'x'.repeat(30)},${i}`);
    const text = lines.join('\n');
    const measured = validateAgentAttachmentFileText(text);
    await store.addFile(SET_ID, OWNER, {
      name: 'big.csv',
      mediaType: 'text/csv',
      kind: 'text',
      byteSize: measured.byteSize,
      charCount: measured.charCount,
      sha256: measured.sha256,
      extractedText: text,
    });
    const set = await store.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    const setDigest = computeAgentAttachmentSetDigest(set.files);
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 1, chunkCount: 1 }),
      contextFor(store, classifyingExecutor),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_STEP_INPUT_UNAVAILABLE');
  });
});

describe('attachment_analyzer transient provider retry (segment-2 wall)', () => {
  it('retries a rate-limited chunk call after 15s and completes the step', async () => {
    const { store, setDigest } = await storeWithFruits();
    let calls = 0;
    const flakyExecutor: AgentModelExecutor = async (input) => {
      calls += 1;
      if (calls === 1) return { ok: false, code: 'PROVIDER_RATE_LIMITED' };
      return classifyingExecutor(input);
    };
    const sleeps: number[] = [];
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, flakyExecutor, recordingSleep(sleeps)),
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([15_000]);
  });

  it('exhausts two retries (15s, 30s) and fails with the provider code', async () => {
    const { store, setDigest } = await storeWithFruits();
    let calls = 0;
    const downExecutor: AgentModelExecutor = async () => {
      calls += 1;
      return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
    };
    const sleeps: number[] = [];
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, downExecutor, recordingSleep(sleeps)),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([15_000, 30_000]);
  });

  it('never retries a non-transient failure', async () => {
    const { store, setDigest } = await storeWithFruits();
    let calls = 0;
    const unconfiguredExecutor: AgentModelExecutor = async () => {
      calls += 1;
      return { ok: false, code: 'PROVIDER_NOT_CONFIGURED' };
    };
    const sleeps: number[] = [];
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, unconfiguredExecutor, recordingSleep(sleeps)),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('PROVIDER_NOT_CONFIGURED');
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('caps cumulative waiting per step: a later chunk loses its second retry', async () => {
    // Two-chunk step over a multi-chunk set. Chunk 1 burns the full
    // 15s+30s schedule before succeeding; chunk 2 then gets its 15s
    // retry (cumulative 60s, exactly at the cap) but not the 30s one
    // (would reach 90s), so the step fails with the provider code.
    const store = new InMemoryAgentAttachmentStore();
    await store.createSet({
      setId: SET_ID,
      ownerBinding: OWNER,
      uploadTokenDigest: 'cd'.repeat(32),
      expiresAt: Date.now() + 3_600_000,
    });
    const lines = ['id,item,amount'];
    for (let i = 0; i < 240; i += 1) lines.push(`R-${String(i).padStart(3, '0')},${'x'.repeat(30)},${i}`);
    const bigText = lines.join('\n');
    const measured = validateAgentAttachmentFileText(bigText);
    await store.addFile(SET_ID, OWNER, {
      name: 'big.csv',
      mediaType: 'text/csv',
      kind: 'text',
      byteSize: measured.byteSize,
      charCount: measured.charCount,
      sha256: measured.sha256,
      extractedText: bigText,
    });
    const set = await store.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    const setDigest = computeAgentAttachmentSetDigest(set.files);
    let calls = 0;
    const scriptedExecutor: AgentModelExecutor = async (input) => {
      calls += 1;
      if (calls === 3) return classifyingExecutor(input);
      return { ok: false, code: 'PROVIDER_RATE_LIMITED' };
    };
    const sleeps: number[] = [];
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 0, chunkCount: 2 }),
      contextFor(store, scriptedExecutor, recordingSleep(sleeps)),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('PROVIDER_RATE_LIMITED');
    expect(calls).toBe(5);
    expect(sleeps).toEqual([15_000, 30_000, 15_000]);
  });

  it('carries the failed dispatch\'s failover attempts in the failure message, after the terminal code (AGORA observability)', async () => {
    const { store, setDigest } = await storeWithFruits();
    const timeoutExecutor: AgentModelExecutor = async () => ({
      ok: false,
      code: 'PROVIDER_TIMEOUT',
      providerAttempts: [
        { providerId: 'cloudflare-workers-ai-free', modelId: '@cf/openai/gpt-oss-120b', outcome: 'availability-error', errorCode: 'PROVIDER_TIMEOUT', durationMs: 25_000, transportRequestCount: 2 },
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_TIMEOUT', durationMs: 45_000, transportRequestCount: 1 },
      ],
    });
    const sleeps: number[] = [];
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, timeoutExecutor, recordingSleep(sleeps)),
    );
    expect(result.ok).toBe(false);
    // The terminal code is still the leading token (the advancer's
    // code extraction is unaffected); the parenthetical carries the
    // attempts of the LAST dispatch the transient retry made — route,
    // model, outcome, code, duration, transports; never a body.
    expect(result.message).toBe(
      'PROVIDER_TIMEOUT (attempts: cloudflare-workers-ai-free|@cf/openai/gpt-oss-120b|availability-error|PROVIDER_TIMEOUT|25000|2; groq-free|openai/gpt-oss-120b|failed|PROVIDER_TIMEOUT|45000|1)',
    );
    expect(sleeps).toEqual([15_000, 30_000]);
  });

  it('keeps the bare code when the failure carries no attempt evidence', async () => {
    const { store, setDigest } = await storeWithFruits();
    const bareExecutor: AgentModelExecutor = async () => ({ ok: false, code: 'PROVIDER_INTERNAL_ERROR' });
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, bareExecutor),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('PROVIDER_INTERNAL_ERROR');
  });

  it('drops attempt entries and fields that fall outside the fixed shapes instead of encoding them', async () => {
    const { store, setDigest } = await storeWithFruits();
    const poisonedExecutor: AgentModelExecutor = async () => ({
      ok: false,
      code: 'PROVIDER_INTERNAL_ERROR',
      providerAttempts: [
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_INTERNAL_ERROR' },
        { providerId: 'evil route with spaces', modelId: 'x', outcome: 'failed' },
        { providerId: 'groq-free', modelId: 'has space', outcome: 'failed' },
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'unknown-outcome' },
      ],
    } as unknown as Awaited<ReturnType<AgentModelExecutor>>);
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, poisonedExecutor),
    );
    expect(result.ok).toBe(false);
    // The entry with an unusable route id and the entry with an
    // unknown outcome are dropped whole; the entry whose model id
    // alone is unusable keeps its route and outcome with the model
    // field blanked — the same field-wise whitelist the provider
    // layer applies to its surfaced diagnostics.
    expect(result.message).toBe(
      'PROVIDER_INTERNAL_ERROR (attempts: groq-free|openai/gpt-oss-120b|failed|PROVIDER_INTERNAL_ERROR|-|-; groq-free|-|failed|-|-|-)',
    );
    expect(result.message).not.toContain('evil');
    expect(result.message).not.toContain('has space');
  });
});

describe('document_generator dataGrounded rule (F2)', () => {
  it('refuses to compose from the template fallback when dataGrounded has no content', async () => {
    const result = await toolRegistry.document_generator.execute(
      { title: 'Report', dataGrounded: true },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_DOCUMENT_PARAMS_INVALID');
  });

  it('composes with the supplied data content when dataGrounded', async () => {
    const result = await toolRegistry.document_generator.execute(
      { title: 'Report', dataGrounded: true, content: 'id,item\nA-1,りんご' },
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.artifact).toContain('A-1,りんご');
  });

  it('keeps the legacy fallback for non-grounded plans (byte-identical behavior)', async () => {
    const grounded = await toolRegistry.document_generator.execute({ title: 'Report' }, {});
    const explicit = await toolRegistry.document_generator.execute({ title: 'Report', dataGrounded: false }, {});
    expect(grounded.ok).toBe(true);
    expect(explicit.artifact).toBe(grounded.artifact);
  });
});

/**
* End-to-end regression for the ALE day-1 coverage failure
* (2026-11-21): prose-only sets whose analyzer was planned as rows
* (K8s shape) or could still be planned as rows over prose (M&A
* shape). The set compositions reproduce the staged ones at the same
* sizes (see agentAttachmentData.test.ts): K8s = 3 prose files /
* 4 chunks, first file spanning two; M&A = 5 prose files / 17 chunks.
*/
function proseParagraphs(count: number, chars: number, seed: string): string {
return Array.from({ length: count}, (_, i) => `${seed} paragraph ${i + 1}. `.padEnd(chars, 'x')).join('\n\n');
}

const K8S_SHAPE_FILES = [
{ name: 'cluster_state.txt', text: proseParagraphs(2, 2_490, 'cluster state')},
{ name: 'deployment.yaml', text: proseParagraphs(1, 2_178, 'deployment manifest')},
{ name: 'failing_pod.log', text: proseParagraphs(1, 3_980, 'pod log')},
];

const MA_SHAPE_FILES = [
{ name: 'announcement.txt', text: proseParagraphs(8, 1_200, 'announcement')},
{ name: 'buyer1_report.txt', text: proseParagraphs(6, 1_200, 'buyer one')},
{ name: 'buyer2_report.txt', text: proseParagraphs(6, 1_200, 'buyer two')},
{ name: 'document_manifest.json', text: '{"documents": ["announcement", "buyer1", "buyer2", "seller"]}'},
{ name: 'seller_report.txt', text: proseParagraphs(12, 1_200, 'seller')},
];

async function storeWithFiles(files: { name: string; text: string}[]) {
const store = new InMemoryAgentAttachmentStore();
await store.createSet({
setId: SET_ID,
ownerBinding: OWNER,
uploadTokenDigest: 'cd'.repeat(32),
expiresAt: Date.now() + 3_600_000,
});
for (const file of files) {
const measured = validateAgentAttachmentFileText(file.text);
await store.addFile(SET_ID, OWNER, {
name: file.name,
mediaType: 'text/plain',
kind: 'text',
byteSize: measured.byteSize,
charCount: measured.charCount,
sha256: measured.sha256,
extractedText: file.text,
});
}
const set = await store.getSet(SET_ID, OWNER);
if (!set) throw new Error('fixture set missing');
return { store, setDigest: computeAgentAttachmentSetDigest(set.files)};
}

/** Reads the chunk's provenance frame the way a model would: the
* frame names the file the chunk came from. */
function frameFileName(userText: string): string {
const match = userText.match(/^【出典: (.+?)（/);
return match? match[1]: '';
}

describe('attachment_analyzer over staged prose compositions', () => {
it('completes the K8s shape as findings, and the model can name each chunk file', async () => {
const { store, setDigest} = await storeWithFiles(K8S_SHAPE_FILES);
const seenFrames: string[] = [];
const executor: AgentModelExecutor = async ({ userText}) => {
seenFrames.push(userText.split('\n')[0]);
return {
ok: true,
text: JSON.stringify({
findings: [{ claim: '断片から読み取れる所見', evidence: '引用', file: frameFileName(userText), location: '冒頭'}],
}),
};
};
const result = await toolRegistry.attachment_analyzer.execute(
{
attachmentSetId: SET_ID, setDigest,
instruction: '障害の原因を分析してください',
outputKind: 'findings', chunkOffset: 0, chunkCount: 2,
},
contextFor(store, executor),
);
expect(result.ok).toBe(true);
const bundle = JSON.parse(result.artifact?? '{}') as {
coverage: { processedChunks: number};
findings: { file: string}[];
};
expect(bundle.coverage.processedChunks).toBe(2);
expect(bundle.findings.map((finding) => finding.file)).toEqual([
'cluster_state.txt', 'cluster_state.txt',
]);
expect(seenFrames).toEqual([
'【出典: cluster_state.txt（チャンク 1/4）】',
'【出典: cluster_state.txt（チャンク 2/4）】',
]);
});

it('carries typed findings, resources and remediations through chained steps (structured JSON)', async () => {
const { store, setDigest} = await storeWithFiles(K8S_SHAPE_FILES);
const executor: AgentModelExecutor = async ({ userText}) => {
const file = frameFileName(userText);
return {
ok: true,
text: JSON.stringify({
findings: [{ claim: `${file}の所見`, evidence: '引用', file, location: '冒頭', type: 'OOMKilled', severity: 'critical'}],
resources: [{ kind: 'Deployment', name: 'payment-api', namespace: 'prod'}],
remediations: [{ action: 'メモリ上限を引き上げる', priority: 'high'}],
}),
};
};
const params = (extra: Record<string, unknown>) => ({
attachmentSetId: SET_ID, setDigest,
instruction: '障害の原因を分析してください',
outputKind: 'findings',
structuredJsonKeys: ['incident_metadata', 'root_causes', 'affected_resources', 'remediation_plan', 'summary'],
...extra,
});
const step1 = await toolRegistry.attachment_analyzer.execute(
params({ chunkOffset: 0, chunkCount: 2}), contextFor(store, executor));
expect(step1.ok).toBe(true);
const step2 = await toolRegistry.attachment_analyzer.execute(
params({ chunkOffset: 2, chunkCount: 2, content: step1.artifact}), contextFor(store, executor));
expect(step2.ok).toBe(true);
const bundle = JSON.parse(step2.artifact?? '{}') as {
findings: { claim: string; type?: string; severity?: string}[];
resources: { kind: string; name: string; namespace: string}[];
remediations: { action: string; priority?: string}[];
coverage: { processedChunks: number};
};
expect(bundle.coverage.processedChunks).toBe(4);
expect(bundle.findings).toHaveLength(4);
expect(bundle.findings[0].type).toBe('OOMKilled');
expect(bundle.findings[0].severity).toBe('critical');
// The same Deployment is named in every chunk: one resource, not four.
expect(bundle.resources).toEqual([{ kind: 'Deployment', name: 'payment-api', namespace: 'prod'}]);
// The same remediation proposed in every chunk: one action, not four.
expect(bundle.remediations).toEqual([{ action: 'メモリ上限を引き上げる', priority: 'high'}]);
});

it('drops invalid structured items without failing the chunk', async () => {
const { store, setDigest} = await storeWithFiles(K8S_SHAPE_FILES);
const executor: AgentModelExecutor = async ({ userText}) => ({
ok: true,
text: JSON.stringify({
findings: [{ claim: '断片から読み取れる所見', evidence: '引用', file: frameFileName(userText), location: '冒頭', type: 'OOMKilled', severity: 'urgent'}],
resources: [{ kind: 'Deployment', name: 'payment-api'}],
remediations: [{ action: ''}, { action: 'メモリ上限を引き上げる', priority: 'top'}],
}),
});
const result = await toolRegistry.attachment_analyzer.execute(
{
attachmentSetId: SET_ID, setDigest,
instruction: '障害の原因を分析してください',
outputKind: 'findings', chunkOffset: 0, chunkCount: 2,
structuredJsonKeys: ['root_causes', 'affected_resources', 'remediation_plan'],
},
contextFor(store, executor),
);
expect(result.ok).toBe(true);
const bundle = JSON.parse(result.artifact?? '{}') as {
findings: { severity?: string}[];
resources: unknown[];
remediations: { action: string; priority?: string}[];
};
// The out-of-enum severity is dropped (the assembler defaults it);
// the resource without a namespace is dropped; the empty action is
// dropped while the valid one survives without its bad priority.
expect(bundle.findings[0].severity).toBeUndefined();
expect(bundle.resources).toEqual([]);
expect(bundle.remediations).toEqual([{ action: 'メモリ上限を引き上げる'}]);
});

it('completes rows over the M&A prose shape across chained steps (chunk-range coverage)', async () => {
const { store, setDigest} = await storeWithFiles(MA_SHAPE_FILES);
const executor: AgentModelExecutor = async ({ userText}) => ({
ok: true,
text: JSON.stringify({ rows: [{ file: frameFileName(userText), note: '処理済み'}]}),
});
const params = (extra: Record<string, unknown>) => ({
attachmentSetId: SET_ID, setDigest,
instruction: '各断片から対象を抽出してください',
outputKind: 'rows',
...extra,
});
// Nine 2-chunk steps cover the 17 chunks (the 2-chunk segment
// size after the AGORA timeout fix); the merged bundle and the
// coverage gate are unchanged by the finer split.
const steps: Array<Awaited<ReturnType<typeof toolRegistry.attachment_analyzer.execute>>> = [];
for (let offset = 0; offset < 17; offset += 2) {
  const chunkCount = Math.min(2, 17 - offset);
  const content = steps.length > 0 ? steps[steps.length - 1].artifact : undefined;
  const step = await toolRegistry.attachment_analyzer.execute(
    params({ chunkOffset: offset, chunkCount, ...(content ? { content } : {}) }),
    contextFor(store, executor),
  );
  expect(step.ok).toBe(true);
  steps.push(step);
}
expect(steps).toHaveLength(9);
const bundle = JSON.parse(steps[steps.length - 1].artifact ?? '{}') as {
coverage: { processedChunks: number};
rows: { file: string}[];
};
expect(bundle.coverage.processedChunks).toBe(17);
expect(bundle.rows).toHaveLength(17);
// seller_report.txt spans six chunks, so its name legitimately
// appears six times in the merged rows — the old file-name key
// multiset failed exactly this shape as a duplicated key.
expect(bundle.rows.filter((row) => row.file === 'seller_report.txt')).toHaveLength(6);
});

it('fails coverage when the predecessor bundle does not cover the step offset', async () => {
const { store, setDigest} = await storeWithFiles(MA_SHAPE_FILES);
const executor: AgentModelExecutor = async ({ userText}) => ({
ok: true,
text: JSON.stringify({ rows: [{ file: frameFileName(userText), note: '処理済み'}]}),
});
// A bundle claiming only 3 processed chunks, presented to the
// final step at offset 16: chunks 3..15 are unaccounted for, so
// the chain total (3 + 1) cannot equal the set's 17.
const fabricated = JSON.stringify({
kind: 'data-analysis',
outputKind: 'rows',
rows: [{ file: 'announcement.txt', note: 'x'}],
coverage: { totalChunks: 17, processedChunks: 3},
chunkRange: { offset: 0, count: 3},
});
const result = await toolRegistry.attachment_analyzer.execute(
{
attachmentSetId: SET_ID, setDigest,
instruction: '各断片から対象を抽出してください',
outputKind: 'rows', chunkOffset: 16, chunkCount: 1, content: fabricated,
},
contextFor(store, executor),
);
expect(result.ok).toBe(false);
expect(result.message).toContain('AGENT_DATA_COVERAGE_INSUFFICIENT');
});

it('fails coverage when rows over a prose set come back empty', async () => {
const { store, setDigest} = await storeWithFiles(K8S_SHAPE_FILES);
const emptyExecutor: AgentModelExecutor = async () => ({ ok: true, text: JSON.stringify({ rows: []})});
// The coverage gate runs only on the final step (chunkOffset +
// range == totalChunks): with the 2-chunk segment size the
// 4-chunk K8s set needs two steps to reach it.
const first = await toolRegistry.attachment_analyzer.execute(
{
attachmentSetId: SET_ID, setDigest,
instruction: '各断片から対象を抽出してください',
outputKind: 'rows', chunkOffset: 0, chunkCount: 2,
},
contextFor(store, emptyExecutor),
);
expect(first.ok).toBe(true);
const result = await toolRegistry.attachment_analyzer.execute(
{
attachmentSetId: SET_ID, setDigest,
instruction: '各断片から対象を抽出してください',
outputKind: 'rows', chunkOffset: 2, chunkCount: 2, content: first.artifact,
},
contextFor(store, emptyExecutor),
);
expect(result.ok).toBe(false);
expect(result.message).toContain('AGENT_DATA_COVERAGE_INSUFFICIENT');
});
});

describe('attachment_analyzer coverage observability (numeric details + execution trace)', () => {
  const EVENTS = ['Event_ID,Loss_Amount_CNY', 'OR001,11000000', 'OR002,5000000'].join('\n');
  const SERVING: { providerId: string; modelId: string } = { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b' };

  async function storeWithEvents() {
    const store = new InMemoryAgentAttachmentStore();
    await store.createSet({
      setId: SET_ID,
      ownerBinding: OWNER,
      uploadTokenDigest: 'cd'.repeat(32),
      expiresAt: Date.now() + 3_600_000,
    });
    const measured = validateAgentAttachmentFileText(EVENTS);
    await store.addFile(SET_ID, OWNER, {
      name: 'events.csv',
      mediaType: 'text/csv',
      kind: 'text',
      byteSize: measured.byteSize,
      charCount: measured.charCount,
      sha256: measured.sha256,
      extractedText: EVENTS,
    });
    const set = await store.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    return { store, setDigest: computeAgentAttachmentSetDigest(set.files) };
  }

  /** Echo stand-in at the provider port: returns the chunk's data
   * rows with an optional per-key value transform, optionally
   * reporting the serving that produced them. */
  function echoExecutor(
    transform?: (id: string, amount: string) => string,
    serving?: { providerId: string; modelId: string },
  ): AgentModelExecutor {
    return async ({ userText }) => {
      const lines = userText.split('\n').filter((line) => line.length > 0 && !line.startsWith('【出典:'));
      const rows = lines.slice(1).map((line) => {
        const [id, amount] = line.split(',');
        return { Event_ID: id, Loss_Amount_CNY: transform ? transform(id, amount) : amount };
      });
      return { ok: true, text: JSON.stringify({ rows }), ...(serving ? { serving } : {}) };
    };
  }

  /** Stand-in that omits OR001's row entirely, optionally
   * reporting a serving. A dropped row is the coverage failure
   * shape the deterministic numeric copy does not repair: the
   * value never reaches the output at all. */
  function omittingExecutor(serving?: { providerId: string; modelId: string }): AgentModelExecutor {
    return async ({ userText }) => {
      const lines = userText.split('\n').filter((line) => line.length > 0 && !line.startsWith('【出典:'));
      const rows = lines.slice(1)
        .filter((line) => !line.startsWith('OR001,'))
        .map((line) => {
          const [id, amount] = line.split(',');
          return { Event_ID: id, Loss_Amount_CNY: amount };
        });
      return { ok: true, text: JSON.stringify({ rows }), ...(serving ? { serving } : {}) };
    };
  }

  it('carries the exact sum difference in the coverage failure message when a row is dropped', async () => {
    const { store, setDigest } = await storeWithEvents();
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, omittingExecutor()),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('AGENT_DATA_COVERAGE_INSUFFICIENT');
    // The record-bound segment names the column and reads the whole
    // failure off the sums: expected 16,000,000, output 5,000,000,
    // difference exactly -11,000,000, nothing unreadable. (A
    // mistranscribed value on a present row no longer reaches this
    // message: the deterministic copy restores the input's cell
    // before the gate runs — see the numeric copy tests below.)
    expect(result.message).toContain(
      'numericMismatch=Loss_Amount_CNY, numeric=Loss_Amount_CNY:16000000:5000000:-11000000:0',
    );
  });

  it('counts an unreadable notation in the coverage failure message, apart from the difference', async () => {
    const { store, setDigest } = await storeWithEvents();
    // A fabricated row carries 500万円 — a notation the numeric
    // parser rejects (the 万 survives its cleaning), so the value
    // drops out of the output sum and is counted instead. (On a
    // matched row the notation never survives to be counted: the
    // deterministic copy restores the input's cell first.)
    const notating: AgentModelExecutor = async (input) => {
      const base = await echoExecutor()(input);
      if (!base.ok) return base;
      const parsed = JSON.parse(base.text) as { rows: Array<Record<string, string>> };
      parsed.rows.push({ Event_ID: 'OR999', Loss_Amount_CNY: '500万円' });
      return { ok: true, text: JSON.stringify(parsed) };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, notating),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      'numeric=Loss_Amount_CNY:16000000:16000000:0:1',
    );
  });

  it('passes verbatim rows exactly as before, and records the serving in the artifact execution block', async () => {
    const { store, setDigest } = await storeWithEvents();
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, echoExecutor(undefined, SERVING)),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as { execution?: unknown };
    expect(bundle.execution).toEqual({ servings: [SERVING], repairRetried: false });
  });

  it('appends the execution trace to a coverage failure when a serving was recorded', async () => {
    const { store, setDigest } = await storeWithEvents();
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, omittingExecutor(SERVING)),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('(execution: servings=groq-free|openai/gpt-oss-120b; repair=0)');
  });

  it('repairs a compounded transcription failure deterministically: numeric cells become the input\u2019s own (numeric copy 案1)', async () => {
    const { store, setDigest } = await storeWithEvents();
    // Both amounts mistranscribed at once — the production shape
    // (an output sum far below the input's, every value still
    // parseable). The generated classification column is the
    // model's own and must survive untouched.
    const mistranscribing: AgentModelExecutor = async ({ userText }) => {
      const lines = userText.split('\n').filter((line) => line.length > 0 && !line.startsWith('【出典:'));
      const rows = lines.slice(1).map((line) => {
        const [id] = line.split(',');
        return {
          Event_ID: id,
          Loss_Amount_CNY: id === 'OR001' ? '1000000' : '5500000',
          Basel_Category: id === 'OR001' ? '内部詐欺' : '外部詐欺',
        };
      });
      return { ok: true, text: JSON.stringify({ rows }) };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, mistranscribing),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      rows: Array<Record<string, string>>;
      content: string;
    };
    expect(bundle.rows).toEqual([
      { Event_ID: 'OR001', Loss_Amount_CNY: '11000000', Basel_Category: '内部詐欺' },
      { Event_ID: 'OR002', Loss_Amount_CNY: '5000000', Basel_Category: '外部詐欺' },
    ]);
    expect(bundle.content).toContain('OR001,11000000');
    expect(bundle.content).toContain('OR002,5000000');
  });

  it('records a serving reduced from production-shaped routing evidence in the execution block', async () => {
    const { store, setDigest } = await storeWithEvents();
    // The production composition: the executor's serving is
    // servingFromRoutingEvidence over display-name evidence
    // ("Cloudflare"), which the slug normalization now reduces to
    // the identifier the trace entrance accepts.
    const executor: AgentModelExecutor = async (input) => {
      const base = await echoExecutor()(input);
      if (!base.ok) return base;
      return {
        ...base,
        serving: servingFromRoutingEvidence({ provider: 'Cloudflare', servedModel: '@cf/openai/gpt-oss-120b' }),
      };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as { execution?: unknown };
    expect(bundle.execution).toEqual({
      servings: [{ providerId: 'cloudflare', modelId: '@cf/openai/gpt-oss-120b' }],
      repairRetried: false,
    });
  });

  it('carries a production-shaped serving into the coverage failure execution segment', async () => {
    const { store, setDigest } = await storeWithEvents();
    const executor: AgentModelExecutor = async (input) => {
      const base = await omittingExecutor()(input);
      if (!base.ok) return base;
      return {
        ...base,
        serving: servingFromRoutingEvidence({ provider: 'Groq', servedModel: 'openai/gpt-oss-120b' }),
      };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, executor),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('(execution: servings=groq|openai/gpt-oss-120b; repair=0)');
  });

  it('records repairRetried when the first response fails parsing and the repair succeeds', async () => {
    const { store, setDigest } = await storeWithEvents();
    let calls = 0;
    const flaky: AgentModelExecutor = async (input) => {
      calls += 1;
      if (calls === 1) return { ok: true, text: 'not json at all', serving: SERVING };
      return echoExecutor(undefined, SERVING)(input);
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, flaky),
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    const bundle = JSON.parse(result.artifact ?? '{}') as { execution?: unknown };
    expect(bundle.execution).toEqual({ servings: [SERVING], repairRetried: true });
  });

  it('appends the execution trace to the terminal parse failure when a serving was recorded', async () => {
    const { store, setDigest } = await storeWithEvents();
    const garbage: AgentModelExecutor = async () => ({ ok: true, text: 'not json at all', serving: SERVING });
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, garbage),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      'AGENT_DATA_OUTPUT_INVALID (chunk 0, parse: json-not-extractable) (execution: servings=groq-free|openai/gpt-oss-120b; repair=1)',
    );
  });
});

describe('attachment_analyzer alternating allocation + chunk interval (design §2-C / §2-E)', () => {
  async function storeWithBigSet() {
    const store = new InMemoryAgentAttachmentStore();
    await store.createSet({
      setId: SET_ID,
      ownerBinding: OWNER,
      uploadTokenDigest: 'cd'.repeat(32),
      expiresAt: Date.now() + 3_600_000,
    });
    const lines = ['id,item,amount'];
    for (let i = 0; i < 240; i += 1) lines.push(`R-${String(i).padStart(3, '0')},${'x'.repeat(30)},${i}`);
    const bigText = lines.join('\n');
    const measured = validateAgentAttachmentFileText(bigText);
    await store.addFile(SET_ID, OWNER, {
      name: 'big.csv',
      mediaType: 'text/csv',
      kind: 'text',
      byteSize: measured.byteSize,
      charCount: measured.charCount,
      sha256: measured.sha256,
      extractedText: bigText,
    });
    const set = await store.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    return { store, setDigest: computeAgentAttachmentSetDigest(set.files) };
  }

  const textExecutor = (record: (number | undefined)[]): AgentModelExecutor => async (input) => {
    record.push(input.chunkIndex);
    return { ok: true, text: JSON.stringify({ text: '要約です' }) };
  };

  it('passes each chunk its deterministic global index, across steps and into repair calls', async () => {
    const { store, setDigest } = await storeWithBigSet();
    const seen: (number | undefined)[] = [];
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { outputKind: 'text', chunkOffset: 0, chunkCount: 2 }),
      contextFor(store, textExecutor(seen)),
    );
    expect(result.ok).toBe(true);
    expect(seen).toEqual([0, 1]);

    // A continuation step resumes the same numbering (offset + range
    // position), so a chunk keeps its allocation assignment across a
    // resume that replays the step.
    const seenContinuation: (number | undefined)[] = [];
    const continuation = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, {
        outputKind: 'text',
        chunkOffset: 2,
        chunkCount: 1,
        content: result.artifact,
      }),
      contextFor(store, textExecutor(seenContinuation)),
    );
    expect(continuation.ok).toBe(true);
    expect(seenContinuation).toEqual([2]);

    // The repair call for a chunk carries the same index as its first
    // call: chunk 0 succeeds, chunk 1's first response is not JSON, so
    // its repair repeats index 1.
    const seenRepair: (number | undefined)[] = [];
    let calls = 0;
    const repairExecutor: AgentModelExecutor = async (input) => {
      seenRepair.push(input.chunkIndex);
      calls += 1;
      if (calls === 2) return { ok: true, text: 'not json at all' };
      return { ok: true, text: JSON.stringify({ text: '要約です' }) };
    };
    const repaired = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { outputKind: 'text', chunkOffset: 0, chunkCount: 2 }),
      contextFor(store, repairExecutor),
    );
    expect(repaired.ok).toBe(true);
    expect(seenRepair).toEqual([0, 1, 1]);
  });

  it('inserts no interval while the interval switch is off (default)', async () => {
    const { store, setDigest } = await storeWithBigSet();
    const seen: (number | undefined)[] = [];
    const sleeps: number[] = [];
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { outputKind: 'text', chunkOffset: 0, chunkCount: 3 }),
      contextFor(store, textExecutor(seen), recordingSleep(sleeps)),
    );
    expect(result.ok).toBe(true);
    expect(sleeps).toEqual([]);
  });

  it('spaces a step’s chunk calls by the interval while the switch is on, separately from retry waits', async () => {
    const { store, setDigest } = await storeWithBigSet();
    const seen: (number | undefined)[] = [];
    const sleeps: number[] = [];
    const context: ToolExecutionContext = {
      ...contextFor(store, textExecutor(seen), recordingSleep(sleeps)),
      env: { ORIGIN_AGENT_ANALYZER_CHUNK_INTERVAL_ENABLED: 'true' },
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { outputKind: 'text', chunkOffset: 0, chunkCount: 2 }),
      context,
    );
    expect(result.ok).toBe(true);
    // Two chunks → one interval, none before the first chunk.
    expect(sleeps).toEqual([AGENT_ANALYZER_CHUNK_INTERVAL_MS]);

    // A transient retry inside chunk 1 keeps its own backoff; the
    // interval before chunk 2 follows it, unmerged and uncounted
    // against the retry ceiling's schedule.
    const retrySleeps: number[] = [];
    let calls = 0;
    const flakyExecutor: AgentModelExecutor = async (input) => {
      calls += 1;
      if (calls === 1) return { ok: false, code: 'PROVIDER_RATE_LIMITED' };
      return textExecutor([])(input);
    };
    const flakyContext: ToolExecutionContext = {
      ...contextFor(store, flakyExecutor, recordingSleep(retrySleeps)),
      env: { ORIGIN_AGENT_ANALYZER_CHUNK_INTERVAL_ENABLED: 'true' },
    };
    const flaky = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { outputKind: 'text', chunkOffset: 0, chunkCount: 2 }),
      flakyContext,
    );
    expect(flaky.ok).toBe(true);
    expect(retrySleeps).toEqual([15_000, AGENT_ANALYZER_CHUNK_INTERVAL_MS]);
  });
});

describe('parseChunkOutputDetailed parse-failure reasons (Basel fix D)', () => {
  const view = buildAgentAttachmentDataView([{ name: 'fruits.csv', text: FRUITS }]);

  it('classifies an unextractable response as json-not-extractable', () => {
    expect(parseChunkOutputDetailed('rows', 'not json at all', view)).toEqual({ ok: false, reason: 'json-not-extractable' });
    expect(parseChunkOutputDetailed('rows', '{"rows": [', view)).toEqual({ ok: false, reason: 'json-not-extractable' });
  });

  it('classifies a non-array rows payload as rows-not-array', () => {
    expect(parseChunkOutputDetailed('rows', '{"rows": {}}', view)).toEqual({ ok: false, reason: 'rows-not-array' });
    expect(parseChunkOutputDetailed('rows', '{"other": []}', view)).toEqual({ ok: false, reason: 'rows-not-array' });
  });

  it('classifies a non-object row as row-not-object', () => {
    expect(parseChunkOutputDetailed('rows', '{"rows": ["A-1"]}', view)).toEqual({ ok: false, reason: 'row-not-object' });
    expect(parseChunkOutputDetailed('rows', '{"rows": [null]}', view)).toEqual({ ok: false, reason: 'row-not-object' });
  });

  it('classifies a row without the key field as row-key-missing', () => {
    expect(parseChunkOutputDetailed('rows', '{"rows": [{"item": "りんご"}]}', view)).toEqual({ ok: false, reason: 'row-key-missing' });
    expect(parseChunkOutputDetailed('rows', '{"rows": [{"id": ""}]}', view)).toEqual({ ok: false, reason: 'row-key-missing' });
  });

  it('accepts an empty rows array: the reference-chunk answer parses', () => {
    const result = parseChunkOutputDetailed('rows', '{"rows":[]}', view);
    expect(result.ok).toBe(true);
    if (result.ok === true) expect(result.output.rows).toEqual([]);
  });

  it('classifies findings failures by their own reasons', () => {
    expect(parseChunkOutputDetailed('findings', '{"findings": {}}', view)).toEqual({ ok: false, reason: 'findings-not-array' });
    expect(parseChunkOutputDetailed('findings', '{"findings": [42]}', view)).toEqual({ ok: false, reason: 'finding-not-object' });
    expect(parseChunkOutputDetailed('findings', '{"findings": [{"claim": "  "}]}', view)).toEqual({ ok: false, reason: 'finding-claim-missing' });
    expect(parseChunkOutputDetailed('findings', '{"findings": [{"claim": "所見"}]}', view).ok).toBe(true);
  });

  it('classifies a non-string text payload as text-not-string', () => {
    expect(parseChunkOutputDetailed('text', '{"text": 42}', view)).toEqual({ ok: false, reason: 'text-not-string' });
    expect(parseChunkOutputDetailed('text', '{"text": "文章"}', view).ok).toBe(true);
  });

  it('gives each reason its own concrete repair guidance', () => {
    expect(parseFailureRepairGuidance('json-not-extractable', 'rows', view)).toContain('JSONオブジェクトだけを返してください');
    expect(parseFailureRepairGuidance('rows-not-array', 'rows', view)).toContain('rowsを配列として');
    expect(parseFailureRepairGuidance('row-not-object', 'rows', view)).toContain('オブジェクトとして');
    const keyGuidance = parseFailureRepairGuidance('row-key-missing', 'rows', view);
    expect(keyGuidance).toContain('キー項目「id」');
    expect(keyGuidance).toContain('{"rows":[]} が正しい応答です');
    expect(parseFailureRepairGuidance('findings-not-array', 'findings', view)).toContain('findingsを配列として');
    expect(parseFailureRepairGuidance('finding-claim-missing', 'findings', view)).toContain('claim');
    expect(parseFailureRepairGuidance('text-not-string', 'text', view)).toContain('{"text":"作成した文章"}');
  });
});

describe('attachment_analyzer primary-table contract (Basel segment-2 fix)', () => {
  async function storeWithFiles(files: ReadonlyArray<readonly [string, string, string]>) {
    const store = new InMemoryAgentAttachmentStore();
    await store.createSet({
      setId: SET_ID,
      ownerBinding: OWNER,
      uploadTokenDigest: 'cd'.repeat(32),
      expiresAt: Date.now() + 3_600_000,
    });
    for (const [name, text, mediaType] of files) {
      const measured = validateAgentAttachmentFileText(text);
      await store.addFile(SET_ID, OWNER, {
        name,
        mediaType,
        kind: 'text',
        byteSize: measured.byteSize,
        charCount: measured.charCount,
        sha256: measured.sha256,
        extractedText: text,
      });
    }
    const set = await store.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    return { store, setDigest: computeAgentAttachmentSetDigest(set.files) };
  }

  const EVENTS = ['Event_ID\tAmount', 'OR001\t100', 'OR002\t200'].join('\n');
  const SCHEMA = [
    'Event_ID,Loss_Event_Category,Business_Line,Loss_Amount_CNY',
    'EXAMPLE001,EL1,BL2,100000',
    'EXAMPLE002,EL4,BL7,250000',
  ].join('\n');

  it('discards the output schema sample rows instead of merging them, and names the target file (案1)', async () => {
    const { store, setDigest } = await storeWithFiles([
      ['events.tsv', EVENTS, 'text/tab-separated-values'],
      ['classified.schema.csv', SCHEMA, 'text/csv'],
    ]);
    const instructions: string[] = [];
    // The literal-reading model: real rows for the events chunk, the
    // sample rows for the schema chunk — the pre-fix trap, which
    // failed the final coverage deterministically (unexpected keys
    // plus a numeric mismatch) even with a perfect primary output.
    const literalExecutor: AgentModelExecutor = async (input) => {
      instructions.push(input.instruction);
      if (input.userText.includes('classified.schema.csv')) {
        return {
          ok: true,
          text: JSON.stringify({
            rows: [
              { Event_ID: 'EXAMPLE001', Loss_Amount_CNY: '100000' },
              { Event_ID: 'EXAMPLE002', Loss_Amount_CNY: '250000' },
            ],
          }),
        };
      }
      return {
        ok: true,
        // The event rows carry the schema's columns: since the
        // 2026-11-24 wave (対策4) an output schema makes its
        // columns mandatory at the final gate, and a run whose
        // rows lack them fails closed instead of completing.
        text: JSON.stringify({
          rows: [
            { Event_ID: 'OR001', Loss_Event_Category: 'EL1', Business_Line: 'BL2', Loss_Amount_CNY: '100', Amount: '100' },
            { Event_ID: 'OR002', Loss_Event_Category: 'EL4', Business_Line: 'BL7', Loss_Amount_CNY: '200', Amount: '200' },
          ],
        }),
      };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 0, chunkCount: 2 }),
      contextFor(store, literalExecutor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      rows: Array<Record<string, string>>;
      coverage: { keyCount: number; discardedRows: number };
    };
    expect(bundle.rows.map((row) => row.Event_ID)).toEqual(['OR001', 'OR002']);
    expect(bundle.coverage.keyCount).toBe(2);
    // The discard is counted on the bundle, never silent.
    expect(bundle.coverage.discardedRows).toBe(2);
    // The rows instruction names the target table file.
    expect(instructions[0]).toContain('対象はファイル「events.tsv」の行だけです');
  });

  it('accumulates the discard count across chained steps (案1)', async () => {
    const mapping = ['BL_Code\tName', 'BL1\tRetail', 'BL2\tWholesale'].join('\n');
    const { store, setDigest } = await storeWithFiles([
      ['events.tsv', EVENTS, 'text/tab-separated-values'],
      ['classified.schema.csv', SCHEMA, 'text/csv'],
      ['mapping.tsv', mapping, 'text/tab-separated-values'],
    ]);
    // Dispatch is by the provenance frame, not the body: since the
    // reference co-location (対策5) the events chunk's input also
    // names mapping.tsv (its reference block's header), so a
    // body-content dispatch would poison the primary chunk itself.
    const poisonExecutor: AgentModelExecutor = async (input) => {
      if (input.userText.startsWith('【出典: classified.schema.csv')) {
        return {
          ok: true,
          text: JSON.stringify({
            rows: [
              { Event_ID: 'EXAMPLE001', Loss_Amount_CNY: '100000' },
              { Event_ID: 'EXAMPLE002', Loss_Amount_CNY: '250000' },
            ],
          }),
        };
      }
      if (input.userText.startsWith('【出典: mapping.tsv')) {
        return { ok: true, text: JSON.stringify({ rows: [{ Event_ID: 'OR999', Amount: '1' }] }) };
      }
      return {
        ok: true,
        // Schema columns included for the same reason as the
        // sibling test above (対策4 mandatory output columns).
        text: JSON.stringify({
          rows: [
            { Event_ID: 'OR001', Loss_Event_Category: 'EL1', Business_Line: 'BL2', Loss_Amount_CNY: '100', Amount: '100' },
            { Event_ID: 'OR002', Loss_Event_Category: 'EL4', Business_Line: 'BL7', Loss_Amount_CNY: '200', Amount: '200' },
          ],
        }),
      };
    };
    const step1 = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 0, chunkCount: 2 }),
      contextFor(store, poisonExecutor),
    );
    expect(step1.ok).toBe(true);
    const bundle1 = JSON.parse(step1.artifact ?? '{}') as { coverage: { discardedRows: number } };
    expect(bundle1.coverage.discardedRows).toBe(2);
    const step2 = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 2, chunkCount: 1, content: step1.artifact }),
      contextFor(store, poisonExecutor),
    );
    expect(step2.ok).toBe(true);
    const bundle2 = JSON.parse(step2.artifact ?? '{}') as {
      rows: Array<Record<string, string>>;
      coverage: { discardedRows: number };
    };
    expect(bundle2.coverage.discardedRows).toBe(3);
    expect(bundle2.rows.map((row) => row.Event_ID)).toEqual(['OR001', 'OR002']);
  });

  it('fails at the step that drops a primary row, with the local breakdown in the message (案2/案3)', async () => {
    // ~70-char rows split the table into several chunks; the step
    // below covers only chunk 0 and is not the final step — before
    // the fix it passed unverified and the shortfall surfaced one
    // segment later as a final-step failure.
    const lines = ['id,item,amount'];
    for (let i = 0; i < 100; i += 1) lines.push(`K-${String(i).padStart(3, '0')},${'x'.repeat(60)},${i}`);
    const { store, setDigest } = await storeWithFiles([['big.csv', lines.join('\n'), 'text/csv']]);
    const droppingExecutor: AgentModelExecutor = async ({ userText }) => {
      const body = userText.split('\n').filter((line) => line.length > 0 && !line.startsWith('【出典:')).slice(1);
      const kept = userText.includes('（チャンク 1/') ? body.slice(0, -1) : body;
      const rows = kept.map((line) => {
        const [id, , amount] = line.split(',');
        return { id, amount };
      });
      return { ok: true, text: JSON.stringify({ rows }) };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 0, chunkCount: 1 }),
      contextFor(store, droppingExecutor),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('AGENT_DATA_COVERAGE_INSUFFICIENT');
    expect(result.message).toContain('(coverage: scope=local, range=0+1,');
    expect(result.message).toContain('missing=1');
    expect(result.message).toContain('numericMismatch=amount');
  });

  it('still fails coverage for rows fabricated inside a primary chunk (fail-closed unchanged)', async () => {
    const { store, setDigest } = await storeWithFiles([
      ['events.tsv', EVENTS, 'text/tab-separated-values'],
    ]);
    const fabricatingExecutor: AgentModelExecutor = async () => ({
      ok: true,
      text: JSON.stringify({
        rows: [
          { Event_ID: 'OR001', Amount: '100' },
          { Event_ID: 'OR002', Amount: '200' },
          { Event_ID: 'OR999', Amount: '50' },
        ],
      }),
    });
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 0, chunkCount: 1 }),
      contextFor(store, fabricatingExecutor),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('AGENT_DATA_COVERAGE_INSUFFICIENT');
    expect(result.message).toContain('unexpected=1');
  });
});

/**
 * The M&A misreading countermeasure (design
 * AGENT_MA_MISREADING_COUNTERMEASURE_2026-11-23): layer 1 builds
 * the deterministic cross-check material (value table + structure
 * map → mismatch candidates), layer 2 vets the merged findings in
 * one reconciliation step under the pairing discipline, and layer
 * 3 forces the explanation/pair format in audit mode. The
 * regression condition is that NONE of it exists outside audit
 * mode: a non-audit findings bundle stays byte-identical.
 */
describe('misreading countermeasure layer 1: normalization and mismatch candidates', () => {
  it('normalizes quantities deterministically and refuses non-quantities', () => {
    expect(normalizeAgentDataValueText('146,660,332.00')).toBe('146660332');
    expect(normalizeAgentDataValueText('146660332')).toBe('146660332');
    expect(normalizeAgentDataValueText('45%')).toBe('45');
    expect(normalizeAgentDataValueText('45.0')).toBe('45');
    expect(normalizeAgentDataValueText('1,234.50')).toBe('1234.5');
    expect(normalizeAgentDataValueText('2026/01/09')).toBe('2026-01-09');
    expect(normalizeAgentDataValueText('2026/1/9')).toBe('2026-01-09');
    expect(normalizeAgentDataValueText('２０２６/０１/０９')).toBe('2026-01-09');
    expect(normalizeAgentDataValueText('自有資金')).toBeUndefined();
    expect(normalizeAgentDataValueText('')).toBeUndefined();
    expect(normalizeAgentDataValueText('2026/13/01')).toBeUndefined();
  });

  const value = (entity: string, attribute: string, raw: string, file: string): AgentDataValue => ({
    entity, attribute, value: raw, file, location: 'p.1',
  });

  it('catches the two production misses and the one production hit as candidates', () => {
    const candidates = computeAgentDataValueMismatches([
      value('买方一', '对价', '146,660,323.00', 'announcement.txt'),
      value('买方一', '对价', '146,660,332.00', 'buyer1_report.txt'),
      value('聚源盛业', '持股比例', '45%', 'announcement.txt'),
      value('聚源盛业', '持股比例', '40%', 'buyer1_report.txt'),
      value('买方一', '资金来源', '自有資金', 'announcement.txt'),
      value('买方一', '资金来源', '自有資金及银行借款', 'buyer1_report.txt'),
      // The same value stated twice is not a mismatch.
      value('买方二', '对价', '10,000.00', 'announcement.txt'),
      value('买方二', '对价', '10000', 'buyer2_report.txt'),
    ], { agreements: [], definitions: [] });
    expect(candidates).toHaveLength(3);
    const consideration = candidates.find((candidate) => candidate.attribute === '对价');
    expect(consideration?.values.map((entry) => entry.normalizedValue)).toEqual(['146660323', '146660332']);
    const share = candidates.find((candidate) => candidate.attribute === '持股比例');
    expect(share?.values.map((entry) => entry.normalizedValue)).toEqual(['45', '40']);
    const funding = candidates.find((candidate) => candidate.attribute === '资金来源');
    expect(funding?.values.map((entry) => entry.value)).toEqual(['自有資金', '自有資金及银行借款']);
  });

  it('resolves a defined abbreviation to its full name before grouping', () => {
    const structure = {
      agreements: [],
      definitions: [{ short: '物美集团', full: '物美科技集团有限公司', file: 'buyer2_report.txt', location: '釈義' }],
    };
    const candidates = computeAgentDataValueMismatches([
      value('物美集团', '持股比例', '60%', 'announcement.txt'),
      value('物美科技集团有限公司', '持股比例', '55%', 'buyer2_report.txt'),
    ], structure);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.entity).toBe('物美科技集团有限公司');
  });

  it('merges structure maps with first-seen dedupe', () => {
    const merged = mergeAgentDataStructures(
      {
        agreements: [{ name: '協議一', parties: [{ name: '甲', role: '转让方' }] }],
        definitions: [{ short: 'A', full: 'Alpha', file: 'f1', location: 'l1' }],
      },
      {
        agreements: [
          { name: '協議一', parties: [{ name: '甲', role: '转让方' }, { name: '乙', role: '受让方' }] },
          { name: '協議二', parties: [{ name: '丙', role: '转让方' }] },
        ],
        definitions: [
          { short: 'A', full: 'Alpha', file: 'f2', location: 'l2' },
          { short: 'B', full: 'Beta', file: 'f2', location: 'l3' },
        ],
      },
    );
    expect(merged.agreements).toEqual([
      { name: '協議一', parties: [{ name: '甲', role: '转让方' }, { name: '乙', role: '受让方' }] },
      { name: '協議二', parties: [{ name: '丙', role: '转让方' }] },
    ]);
    expect(merged.definitions.map((definition) => definition.short)).toEqual(['A', 'B']);
  });
});

describe('misreading countermeasure layers 1+3: audit-mode analyzer', () => {
  const AUDIT_FILES = [
    { name: 'announcement.txt', text: '公告本文。买方一の対価は146,660,323.00元と記載。' },
    { name: 'buyer1_report.txt', text: '買主一報告本文。対価は146,660,332.00元と記載。' },
  ];

  const auditExecutor: AgentModelExecutor = async ({ userText }) => {
    const file = frameFileName(userText);
    const amount = file === 'announcement.txt' ? '146,660,323.00' : '146,660,332.00';
    return {
      ok: true,
      text: JSON.stringify({
        findings: [{
          claim: '対価の金額が文書間で食い違う',
          explanation: '同一主体の同一属性で2つの異なる金額が記載されている',
          evidence: `対価 ${amount} 元`,
          file,
          location: '第1頁',
          evidenceB: '',
        }],
        values: [{ entity: '买方一', attribute: '对价', value: amount, file, location: '第1頁' }],
        structure: {
          agreements: [{ name: '協議一', parties: [{ name: '买方一', role: '受让方' }] }],
          definitions: [],
        },
      }),
    };
  };

  it('carries values, structure and deterministic candidates in the final bundle', async () => {
    const { store, setDigest } = await storeWithFiles(AUDIT_FILES);
    const result = await toolRegistry.attachment_analyzer.execute(
      {
        attachmentSetId: SET_ID, setDigest,
        instruction: 'Audit the documents for inconsistencies',
        outputKind: 'findings', chunkOffset: 0, chunkCount: 4, auditMode: true,
      },
      contextFor(store, auditExecutor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      findings: { explanation?: string }[];
      values: { value: string }[];
      structure: { agreements: { name: string }[] };
      candidates: { entity: string; values: { normalizedValue: string }[] }[];
      content: string;
    };
    expect(bundle.findings).toHaveLength(2);
    expect(bundle.findings[0]?.explanation).toContain('同一主体');
    expect(bundle.values.map((entry) => entry.value)).toEqual(['146,660,323.00', '146,660,332.00']);
    expect(bundle.structure.agreements.map((agreement) => agreement.name)).toEqual(['協議一']);
    expect(bundle.candidates).toHaveLength(1);
    expect(bundle.candidates[0]?.values.map((entry) => entry.normalizedValue)).toEqual(['146660323', '146660332']);
    // Layer-3 rendering: the goal is English, so the labels are.
    expect(bundle.content).toContain('## Finding 1:');
    expect(bundle.content).toContain('- Why it is inconsistent:');
    expect(bundle.content).toContain('- Evidence:');
  });

  it('rejects an audit finding without explanation and repairs it with the concrete reason', async () => {
    const { store, setDigest } = await storeWithFiles(AUDIT_FILES);
    const instructions: string[] = [];
    let calls = 0;
    const executor: AgentModelExecutor = async ({ instruction, userText }) => {
      instructions.push(instruction);
      calls += 1;
      const file = frameFileName(userText);
      const withExplanation = calls > 1;
      return {
        ok: true,
        text: JSON.stringify({
          findings: [{
            claim: '所見',
            ...(withExplanation ? { explanation: '説明' } : {}),
            evidence: '引用', file, location: '冒頭',
          }],
        }),
      };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      {
        attachmentSetId: SET_ID, setDigest,
        instruction: '文書の不整合を監査してください',
        outputKind: 'findings', chunkOffset: 0, chunkCount: 1, auditMode: true,
      },
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(instructions[1]).toContain('explanation');
  });

  it('parses the explanation requirement only in audit mode', () => {
    const view = buildAgentAttachmentDataView([{ name: 'a.txt', text: 'x' }]);
    const text = '{"findings": [{"claim": "所見"}]}';
    expect(parseChunkOutputDetailed('findings', text, view, { auditMode: true })).toEqual({
      ok: false, reason: 'finding-explanation-missing',
    });
    // The same payload is valid outside audit mode, with or
    // without the options argument.
    expect(parseChunkOutputDetailed('findings', text, view).ok).toBe(true);
    expect(parseChunkOutputDetailed('findings', text, view, { auditMode: false }).ok).toBe(true);
    expect(parseFailureRepairGuidance('finding-explanation-missing', 'findings', view)).toContain('explanation');
  });

  it('keeps the K8s findings bundle byte-identical outside audit mode (regression)', async () => {
    const { store, setDigest } = await storeWithFiles(K8S_SHAPE_FILES);
    const executor: AgentModelExecutor = async ({ userText }) => ({
      ok: true,
      text: JSON.stringify({
        findings: [{ claim: '断片から読み取れる所見', evidence: '引用', file: frameFileName(userText), location: '冒頭' }],
      }),
    });
    const result = await toolRegistry.attachment_analyzer.execute(
      {
        attachmentSetId: SET_ID, setDigest,
        instruction: '障害の原因を分析してください',
        outputKind: 'findings', chunkOffset: 0, chunkCount: 2,
      },
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    // The expected artifact is the bundle the pre-countermeasure
    // implementation produced for this exact scenario (generated
    // from the untouched base, 2026-11-23): same keys, same order,
    // same rendering — no values/structure/candidates, no
    // explanation fields. The scenario drives the 2-chunk segment
    // size (AGORA split, 2026-11-23): the expected bundle is the
    // base-generated bundle for chunks 0-1, the first two findings
    // of the full-range bundle pinned before the split.
    const expected = {
      kind: 'data-analysis',
      content: [
        '- 断片から読み取れる所見（根拠: cluster_state.txt 冒頭 「引用」）',
        '- 断片から読み取れる所見（根拠: cluster_state.txt 冒頭 「引用」）',
      ].join('\n'),
      outputKind: 'findings',
      findings: [
        { claim: '断片から読み取れる所見', evidence: '引用', file: 'cluster_state.txt', location: '冒頭' },
        { claim: '断片から読み取れる所見', evidence: '引用', file: 'cluster_state.txt', location: '冒頭' },
      ],
      coverage: { totalChunks: 4, processedChunks: 2 },
      chunkRange: { offset: 0, count: 2 },
    };
    expect(result.artifact).toBe(JSON.stringify(expected));
  });

  it('switches rendering labels by the goal language (deterministic CJK check)', () => {
    expect(agentGoalUsesCjk('文書の不整合を監査してください')).toBe(true);
    expect(agentGoalUsesCjk('Audit the documents for inconsistencies')).toBe(false);
  });
});

describe('misreading countermeasure layer 2: attachment_reconciler tool', () => {
  const RECONCILER_FILES = [
    { name: 'announcement.txt', text: '公告本文。' },
    { name: 'buyer1_report.txt', text: '買主一報告本文。' },
  ];

  const ANALYZER_BUNDLE = JSON.stringify({
    kind: 'data-analysis',
    content: 'prior rendering',
    outputKind: 'findings',
    findings: [
      {
        claim: '対価の金額が食い違う',
        explanation: '公告と買主1報告で同一主体の対価が異なる',
        evidence: '146,660,323.00元', file: 'announcement.txt', location: 'p.2',
        evidenceB: '146,660,332.00元', fileB: 'buyer1_report.txt', locationB: 'p.3',
      },
      {
        claim: '承認手続きが未了である',
        explanation: '状態の記述',
        evidence: '尚需取得上证合规性审查意见', file: 'announcement.txt', location: 'p.5',
      },
    ],
    values: [],
    structure: { agreements: [{ name: '協議一', parties: [{ name: '买方一', role: '受让方' }] }], definitions: [] },
    candidates: [{
      entity: '聚源盛业',
      attribute: '持股比例',
      values: [
        { value: '45%', normalizedValue: '45', file: 'announcement.txt', location: 'p.2' },
        { value: '40%', normalizedValue: '40', file: 'buyer1_report.txt', location: 'p.4' },
      ],
    }],
    coverage: { totalChunks: 2, processedChunks: 2 },
    chunkRange: { offset: 0, count: 2 },
  });

  const VETTED_OUTPUT = JSON.stringify({
    findings: [
      {
        claim: '対価の金額が食い違う',
        explanation: '公告と買主1報告で同一主体の対価が異なる',
        evidence: '146,660,323.00元', file: 'announcement.txt', location: 'p.2',
        evidenceB: '146,660,332.00元', fileB: 'buyer1_report.txt', locationB: 'p.3',
        source: { kind: 'kept', index: 0 },
      },
      {
        claim: '持股比例が食い違う',
        explanation: '公告は45%、買主1報告は40%で、合計も公告側は105%になる',
        evidence: '45%', file: 'announcement.txt', location: 'p.2',
        evidenceB: '40%', fileB: 'buyer1_report.txt', locationB: 'p.4',
        source: { kind: 'candidate', index: 0 },
      },
    ],
    dropped: [{ index: 1, reason: 'boilerplate' }],
  });

  const reconcilerParams = (setDigest: string, extra: Record<string, unknown> = {}) => ({
    attachmentSetId: SET_ID,
    setDigest,
    instruction: 'Audit the documents for inconsistencies and report each inconsistency with its explanation.',
    content: ANALYZER_BUNDLE,
    ...extra,
  });

  const contextWithMode = (
    store: InMemoryAgentAttachmentStore,
    modelCall: AgentModelExecutor,
    mode: string,
  ): ToolExecutionContext => ({
    ...contextFor(store, modelCall),
    env: { ORIGIN_AGENT_FINDINGS_RECONCILIATION_ENABLED: mode },
  });

  it('enforce: keeps the paired finding, drops the boilerplate one, picks up the candidate', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: VETTED_OUTPUT });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      findings: { claim: string; explanation?: string; evidenceB?: string }[];
      reconciliation: { mode: string; candidateCount: number; keptCount: number; droppedCount: number; droppedReasons: Record<string, number>; pickedUpCount: number };
      content: string;
    };
    expect(bundle.findings.map((finding) => finding.claim)).toEqual(['対価の金額が食い違う', '持股比例が食い違う']);
    expect(bundle.findings[1]?.evidenceB).toBe('40%');
    expect(bundle.reconciliation).toEqual({
      mode: 'enforce',
      candidateCount: 1,
      keptCount: 1,
      droppedCount: 1,
      droppedReasons: { boilerplate: 1 },
      pickedUpCount: 1,
      // Which findings were kept/dropped rides the summary since
      // the 2026-11-24 wave (対策1(a)): kept the paired finding
      // (index 0), dropped the boilerplate one (index 1).
      keptIndexes: [0],
      droppedIndexes: [{ index: 1, reason: 'boilerplate' }],
    });
    expect(bundle.content).toContain('## Finding 1: 対価の金額が食い違う');
    expect(bundle.content).toContain('- Why it is inconsistent:');
    expect(bundle.content).toContain('`announcement.txt, p.2`: `146,660,323.00元`');
    expect(bundle.content).not.toContain('承認手続きが未了である');
  });

  it('enforce: renders pair labels in Japanese for a Japanese goal', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: VETTED_OUTPUT });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest, { instruction: '文書の不整合を監査し、矛盾の説明とともに出力してください' }),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as { content: string };
    expect(bundle.content).toContain('## 所見 1: 対価の金額が食い違う');
    expect(bundle.content).toContain('- 矛盾の説明:');
    expect(bundle.content).toContain('- 根拠:');
  });

  it('enforce: fails closed when candidates exist but the vetted list is empty', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({
      ok: true,
      text: JSON.stringify({ findings: [], dropped: [{ index: 0, reason: 'no-pair' }, { index: 1, reason: 'boilerplate' }] }),
    });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_RECONCILIATION_NO_FINDINGS');
  });

  it('enforce: repairs an output that misses the pair discipline, then accepts the repair', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    let calls = 0;
    const executor: AgentModelExecutor = async () => {
      calls += 1;
      if (calls === 1) {
        // No source markers and no second citation: not vetted.
        return {
          ok: true,
          text: JSON.stringify({
            findings: [{ claim: '対価の金額が食い違う', explanation: '説明', evidence: '146,660,323.00元', file: 'announcement.txt', location: 'p.2' }],
          }),
        };
      }
      return { ok: true, text: VETTED_OUTPUT };
    };
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('enforce: fails with AGENT_RECONCILIATION_OUTPUT_INVALID when the repair also misses', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: '{"findings": "nope"}' });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_RECONCILIATION_OUTPUT_INVALID');
  });

  it('shadow: records the vetted list and counts but ships the original findings', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: VETTED_OUTPUT });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'shadow'),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      findings: { claim: string }[];
      reconciledFindings: { claim: string }[];
      reconciliation: {
        mode: string; droppedCount: number; pickedUpCount: number;
        keptIndexes?: number[]; droppedIndexes?: { index: number; reason: string }[];
      };
      content: string;
    };
    expect(bundle.findings.map((finding) => finding.claim)).toEqual(['対価の金額が食い違う', '承認手続きが未了である']);
    expect(bundle.reconciledFindings.map((finding) => finding.claim)).toEqual(['対価の金額が食い違う', '持股比例が食い違う']);
    expect(bundle.reconciliation.mode).toBe('shadow');
    expect(bundle.reconciliation.droppedCount).toBe(1);
    // The judged indexes ride the summary (対策1(a)): without
    // them the shadow record cannot say WHICH findings were kept.
    expect(bundle.reconciliation.keptIndexes).toEqual([0]);
    expect(bundle.reconciliation.droppedIndexes).toEqual([{ index: 1, reason: 'boilerplate' }]);
    expect(bundle.content).toContain('承認手続きが未了である');
  });

  it('shadow: an unjudgeable reconciliation degrades to a recorded pass-through, never a failure', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: 'not json at all' });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'shadow'),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      findings: { claim: string }[];
      reconciliation: { failed?: boolean; candidateCount: number; keptIndexes?: number[]; droppedIndexes?: unknown[] };
    };
    expect(bundle.findings).toHaveLength(2);
    expect(bundle.reconciliation.failed).toBe(true);
    expect(bundle.reconciliation.candidateCount).toBe(1);
    // Nothing was judged, so no index lists are recorded — an
    // unjudged reconciliation must not read as an empty judgment
    // (対策1(a)).
    expect(bundle.reconciliation.keptIndexes).toBeUndefined();
    expect(bundle.reconciliation.droppedIndexes).toBeUndefined();
  });

  it('off: passes the bundle through with no reconciliation record', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: VETTED_OUTPUT });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as Record<string, unknown>;
    expect(bundle.reconciliation).toBeUndefined();
    expect((bundle.findings as { claim: string }[]).map((finding) => finding.claim)).toEqual([
      '対価の金額が食い違う', '承認手続きが未了である',
    ]);
  });

  it('refuses a missing bundle and a non-bundle content', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: VETTED_OUTPUT });
    const missing = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest, { content: undefined }),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(missing.ok).toBe(false);
    expect(missing.message).toBe('AGENT_STEP_INPUT_UNAVAILABLE');
    const notBundle = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest, { content: '{"kind":"other"}' }),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(notBundle.ok).toBe(false);
    expect(notBundle.message).toBe('AGENT_DATA_OUTPUT_INVALID');
  });

  it('validates the reconciliation output mechanically (parseReconciliationOutput)', () => {
    const vetted = {
      claim: 'c', explanation: 'e', evidence: 'v1', file: 'f', location: 'l',
      evidenceB: 'v2', fileB: 'f2', locationB: 'l2',
    };
    expect(parseReconciliationOutput(JSON.stringify({ findings: [{ ...vetted, source: { kind: 'kept', index: 0 } }] }), 1, 0).ok).toBe(true);
    // The kept originals' indexes are part of the parse result
    // (対策1(a)), ascending regardless of output order.
    const multi = parseReconciliationOutput(JSON.stringify({
      findings: [
        { ...vetted, source: { kind: 'kept', index: 2 } },
        { ...vetted, source: { kind: 'kept', index: 0 } },
      ],
      dropped: [{ index: 1, reason: 'boilerplate' }],
    }), 3, 0);
    expect(multi.ok).toBe(true);
    if (multi.ok) {
      expect(multi.keptIndexes).toEqual([0, 2]);
      expect(multi.dropped).toEqual([{ index: 1, reason: 'boilerplate' }]);
    }
    // Kept index out of range.
    expect(parseReconciliationOutput(JSON.stringify({ findings: [{ ...vetted, source: { kind: 'kept', index: 1 } }] }), 1, 0).ok).toBe(false);
    // The same original kept twice.
    expect(parseReconciliationOutput(JSON.stringify({
      findings: [
        { ...vetted, source: { kind: 'kept', index: 0 } },
        { ...vetted, source: { kind: 'kept', index: 0 } },
      ],
    }), 1, 0).ok).toBe(false);
    // Candidate index out of range.
    expect(parseReconciliationOutput(JSON.stringify({ findings: [{ ...vetted, source: { kind: 'candidate', index: 0 } }] }), 1, 0).ok).toBe(false);
    // Missing second citation: not vetted.
    const { evidenceB: _dropped, ...noPair } = vetted;
    expect(parseReconciliationOutput(JSON.stringify({ findings: [{ ...noPair, source: { kind: 'kept', index: 0 } }] }), 1, 0).ok).toBe(false);
    // A dropped entry with an unknown reason is discarded, not fatal.
    const withBadDrop = parseReconciliationOutput(JSON.stringify({
      findings: [{ ...vetted, source: { kind: 'kept', index: 0 } }],
      dropped: [{ index: 0, reason: 'whatever' }],
    }), 2, 0);
    expect(withBadDrop.ok).toBe(true);
    if (withBadDrop.ok) expect(withBadDrop.dropped).toEqual([]);
  });
});

describe('failure diagnosis 2026-11-24 wave 1 (対策3・対策4・対策1(d))', () => {
  async function storeWithTypedFiles(files: ReadonlyArray<readonly [string, string, string]>) {
    const store = new InMemoryAgentAttachmentStore();
    await store.createSet({
      setId: SET_ID,
      ownerBinding: OWNER,
      uploadTokenDigest: 'cd'.repeat(32),
      expiresAt: Date.now() + 3_600_000,
    });
    for (const [name, text, mediaType] of files) {
      const measured = validateAgentAttachmentFileText(text);
      await store.addFile(SET_ID, OWNER, {
        name,
        mediaType,
        kind: 'text',
        byteSize: measured.byteSize,
        charCount: measured.charCount,
        sha256: measured.sha256,
        extractedText: text,
      });
    }
    const set = await store.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    return { store, setDigest: computeAgentAttachmentSetDigest(set.files) };
  }

  const BASEL_EVENTS = ['Event_ID\tLoss_Amount_CNY', 'OR001\t100', 'OR002\t200'].join('\n');
  const BASEL_SCHEMA = [
    'Event_ID,Loss_Event_Category,Business_Line,Loss_Amount_CNY',
    'EXAMPLE001,EL1,BL2,100000',
    'EXAMPLE002,EL4,BL7,250000',
  ].join('\n');
  const BASEL_FILES: ReadonlyArray<readonly [string, string, string]> = [
    ['operational_risk_events.tsv', BASEL_EVENTS, 'text/tab-separated-values'],
    ['classified_events.schema.csv', BASEL_SCHEMA, 'text/csv'],
  ];

  it('fails the final rows step closed, naming the missing schema columns (対策4)', async () => {
    const { store, setDigest } = await storeWithTypedFiles(BASEL_FILES);
    // The production failure shape: the model returns the input
    // rows faithfully — keys and amounts all correct — but never
    // produces the derived columns the schema names. Before this
    // wave the coverage gates passed and the run "completed".
    const copyExecutor: AgentModelExecutor = async ({ userText }) => {
      if (frameFileName(userText) === 'classified_events.schema.csv') {
        return { ok: true, text: JSON.stringify({ rows: [] }) };
      }
      return {
        ok: true,
        text: JSON.stringify({
          rows: [
            { Event_ID: 'OR001', Loss_Amount_CNY: '100' },
            { Event_ID: 'OR002', Loss_Amount_CNY: '200' },
          ],
        }),
      };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, {
        instruction: 'Classify each operational risk event and compute the BIA capital',
        chunkOffset: 0,
        chunkCount: 2,
      }),
      contextFor(store, copyExecutor),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      // The failure code is the message's leading token (the
      // shape every analyzer gate failure takes; the advancer
      // derives the step errorCode from it).
      expect(result.message).toContain('AGENT_DATA_REQUIRED_COLUMNS_MISSING');
      expect(result.message).toContain('Loss_Event_Category');
      expect(result.message).toContain('Business_Line');
    }
  });

  it('completes when every row carries the schema columns, and names them as mandatory in the instruction (対策4)', async () => {
    const { store, setDigest } = await storeWithTypedFiles(BASEL_FILES);
    const instructions: string[] = [];
    const classifyingExecutor: AgentModelExecutor = async ({ instruction, userText }) => {
      instructions.push(instruction);
      if (frameFileName(userText) === 'classified_events.schema.csv') {
        return { ok: true, text: JSON.stringify({ rows: [] }) };
      }
      return {
        ok: true,
        text: JSON.stringify({
          rows: [
            { Event_ID: 'OR001', Loss_Event_Category: 'EL1', Business_Line: 'BL2', Loss_Amount_CNY: '100' },
            { Event_ID: 'OR002', Loss_Event_Category: 'EL4', Business_Line: 'BL7', Loss_Amount_CNY: '200' },
          ],
        }),
      };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, {
        instruction: 'Classify each operational risk event and compute the BIA capital',
        chunkOffset: 0,
        chunkCount: 2,
      }),
      contextFor(store, classifyingExecutor),
    );
    expect(result.ok).toBe(true);
    expect(instructions[0]).toContain(
      '各行には次の列を必ず含め、空にしないでください: Event_ID, Loss_Event_Category, Business_Line, Loss_Amount_CNY',
    );
  });

  it('fails when a schema column is present on some rows but blank on others (対策4)', async () => {
    const { store, setDigest } = await storeWithTypedFiles(BASEL_FILES);
    const partialExecutor: AgentModelExecutor = async ({ userText }) => {
      if (frameFileName(userText) === 'classified_events.schema.csv') {
        return { ok: true, text: JSON.stringify({ rows: [] }) };
      }
      return {
        ok: true,
        text: JSON.stringify({
          rows: [
            { Event_ID: 'OR001', Loss_Event_Category: 'EL1', Business_Line: 'BL2', Loss_Amount_CNY: '100' },
            { Event_ID: 'OR002', Loss_Event_Category: '', Business_Line: 'BL7', Loss_Amount_CNY: '200' },
          ],
        }),
      };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, {
        instruction: 'Classify each operational risk event and compute the BIA capital',
        chunkOffset: 0,
        chunkCount: 2,
      }),
      contextFor(store, partialExecutor),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toContain('AGENT_DATA_REQUIRED_COLUMNS_MISSING');
      expect(result.message).toContain('Loss_Event_Category');
      expect(result.message).not.toContain('Business_Line');
    }
  });

  it('gives the audit contract the controlled attribute vocabulary and the finding-to-table pairing rule (対策3)', async () => {
    const { store, setDigest } = await storeWithTypedFiles([
      ['announcement.txt', '公告本文。', 'text/plain'],
    ]);
    const instructions: string[] = [];
    const executor: AgentModelExecutor = async ({ instruction }) => {
      instructions.push(instruction);
      return { ok: true, text: JSON.stringify({ findings: [] }) };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      {
        attachmentSetId: SET_ID, setDigest,
        instruction: '文書の不整合を監査してください',
        outputKind: 'findings', chunkOffset: 0, chunkCount: 1, auditMode: true,
      },
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    for (const label of AGENT_AUDIT_ATTRIBUTE_VOCABULARY) {
      expect(instructions[0]).toContain(label);
    }
    expect(instructions[0]).toContain('値テーブルの属性は統制語彙');
    expect(instructions[0]).toContain('所見として挙げた食い違いのペアは、同じ主体・同じ属性ラベルで値テーブルにも必ず入れること');
  });

  // The three discrepancies the 2026-11-24 diagnosis verified by
  // hand in the four M&A source documents, entered in the value
  // table under the controlled vocabulary (対策3), plus agreeing
  // controls. The candidate computation must raise exactly the
  // three verified pairs.
  const VERIFIED_MA_VALUES: AgentDataValue[] = [
    // 対価: the announcement's own tables disagree (p.2 carries
    // both figures; 323 appears once).
    { entity: '买方一', attribute: '金額', value: '146,660,332.00', file: 'announcement.txt', location: '2頁' },
    { entity: '买方一', attribute: '金額', value: '146,660,323.00', file: 'announcement.txt', location: '2頁 表' },
    // 持分: 聚源盛业's stake is 45% in the announcement (which
    // makes the stated total 105%) and 40% in buyer 1's report.
    { entity: '聚源盛业投资（宁波）有限公司', attribute: '比率・持分', value: '45%', file: 'announcement.txt', location: '4頁' },
    { entity: '聚源盛业投资（宁波）有限公司', attribute: '比率・持分', value: '40%', file: 'buyer1_report.txt', location: '5頁' },
    // 資金源泉: the announcement checks 自有资金 for buyer 1;
    // buyer 1's own report says part came from bank borrowing.
    { entity: '买方一', attribute: '資金源泉', value: '自有资金', file: 'announcement.txt', location: '資金源泉欄' },
    { entity: '买方一', attribute: '資金源泉', value: '部分来源于自有资金及向银行的借款', file: 'buyer1_report.txt', location: '12頁' },
    // Controls: buyer 2's funding agrees across documents, and
    // the other shareholders' stakes agree — no candidates.
    { entity: '买方二', attribute: '資金源泉', value: '自有资金', file: 'announcement.txt', location: '資金源泉欄' },
    { entity: '买方二', attribute: '資金源泉', value: '自有资金', file: 'buyer2_report.txt', location: '3頁' },
    { entity: '其他股东甲', attribute: '比率・持分', value: '33.33333%', file: 'announcement.txt', location: '4頁' },
    { entity: '其他股东甲', attribute: '比率・持分', value: '33.33333%', file: 'buyer1_report.txt', location: '6頁' },
    { entity: '其他股东乙', attribute: '比率・持分', value: '26.66667%', file: 'announcement.txt', location: '4頁' },
    { entity: '其他股东乙', attribute: '比率・持分', value: '26.66667%', file: 'buyer2_report.txt', location: '6頁' },
  ];

  it('raises all three verified M&A pairs as candidates under the controlled vocabulary (対策3)', () => {
    const candidates = computeAgentDataValueMismatches(VERIFIED_MA_VALUES, { agreements: [], definitions: [] });
    expect(candidates).toHaveLength(3);
    const consideration = candidates.find((candidate) => candidate.attribute === '金額');
    expect(consideration?.entity).toBe('买方一');
    expect(consideration?.values.map((entry) => entry.normalizedValue)).toEqual(['146660332', '146660323']);
    const stake = candidates.find((candidate) => candidate.attribute === '比率・持分');
    // The candidate carries the resolved entity: grouping
    // normalizes with NFKC, so the fullwidth parentheses of the
    // source name appear in their ASCII form.
    expect(stake?.entity).toBe('聚源盛业投资(宁波)有限公司');
    expect(stake?.values.map((entry) => entry.normalizedValue)).toEqual(['45', '40']);
    const funding = candidates.find((candidate) => candidate.attribute === '資金源泉');
    expect(funding?.entity).toBe('买方一');
    expect(funding?.values.map((entry) => entry.value)).toEqual(['自有资金', '部分来源于自有资金及向银行的借款']);
  });

  it('summarizes the value table in the candidate computation grouping (対策1(d))', () => {
    const summary = summarizeAgentDataValueTable(VERIFIED_MA_VALUES, { agreements: [], definitions: [] });
    expect(summary.entryCount).toBe(VERIFIED_MA_VALUES.length);
    expect(summary.groupCount).toBe(6);
    const consideration = summary.groups.find((group) => group.attribute === '金額');
    expect(consideration).toEqual({ entity: '买方一', attribute: '金額', entries: 2, distinctValues: 2 });
    const buyerTwoFunding = summary.groups.find(
      (group) => group.attribute === '資金源泉' && group.entity === '买方二',
    );
    expect(buyerTwoFunding).toEqual({ entity: '买方二', attribute: '資金源泉', entries: 2, distinctValues: 1 });
  });

  it('carries the value-table summary in the final audit bundle (対策1(d))', async () => {
    const { store, setDigest } = await storeWithTypedFiles([
      ['announcement.txt', '公告本文。买方一の対価は146,660,323.00元と記載。', 'text/plain'],
      ['buyer1_report.txt', '買主一報告本文。対価は146,660,332.00元と記載。', 'text/plain'],
    ]);
    const executor: AgentModelExecutor = async ({ userText }) => {
      const file = frameFileName(userText);
      const amount = file === 'announcement.txt' ? '146,660,323.00' : '146,660,332.00';
      return {
        ok: true,
        text: JSON.stringify({
          findings: [{
            claim: '対価の金額が文書間で食い違う',
            explanation: '同一主体の同一属性で2つの異なる金額が記載されている',
            evidence: `対価 ${amount} 元`,
            file,
            location: '第1頁',
            evidenceB: '',
          }],
          values: [{ entity: '买方一', attribute: '金額', value: amount, file, location: '第1頁' }],
          structure: { agreements: [], definitions: [] },
        }),
      };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      {
        attachmentSetId: SET_ID, setDigest,
        instruction: '文書の不整合を監査してください',
        outputKind: 'findings', chunkOffset: 0, chunkCount: 2, auditMode: true,
      },
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      candidates: unknown[];
      valueTable?: { entryCount: number; groupCount: number; groups: { entity: string; attribute: string; entries: number; distinctValues: number }[] };
    };
    expect(bundle.candidates).toHaveLength(1);
    expect(bundle.valueTable).toEqual({
      entryCount: 2,
      groupCount: 1,
      groups: [{ entity: '买方一', attribute: '金額', entries: 2, distinctValues: 2 }],
    });
  });
});

describe('attachment_analyzer wave 2 (対策5 reference co-location, 対策6 BIA inputs)', () => {
  const EVENTS = [
    'Event_ID\tLoss_Amount_CNY',
    'OR001\t100',
    'OR002\t200',
    'OR003\t300',
    'OR004\t400',
    'OR005\t500',
    'OR006\t600',
  ].join('\n');
  const CATEGORIES = [
    'Category_Code\tCategory_Name_EN\tDefinition\tKey_Indicators',
    'EL1\tInternal Fraud\tA long definition sentence.\tunauthorized trading, embezzlement',
    'EL2\tExternal Fraud\tAnother long definition.\thacking, phishing',
  ].join('\n');
  const MAPPING = [
    'Department\tBusiness_Line_Code\tBusiness_Line_Name_EN',
    'Retail Banking Operations\tBL2\tRetail Banking',
  ].join('\n');
  const PARAMS = [
    '## sheet: Sheet1',
    'Parameter\tValue\tDescription',
    'Alpha_Coefficient\t0.15\tBasel mandated coefficient',
    'Gross_Income_Year_1_2021_CNY\t2850000000\taudited gross income 2021',
    'Gross_Income_Year_2_2022_CNY\t3120000000\taudited gross income 2022',
    'Gross_Income_Year_3_2023_CNY\t-456000000\taudited gross income 2023',
  ].join('\n');
  const SCHEMA = [
    'Event_ID,Loss_Event_Category,Business_Line,Loss_Amount_CNY',
    'EXAMPLE001,EL1,BL1,1000',
  ].join('\n');

  async function storeWithBaselShape() {
    const store = new InMemoryAgentAttachmentStore();
    await store.createSet({
      setId: SET_ID,
      ownerBinding: OWNER,
      uploadTokenDigest: 'cd'.repeat(32),
      expiresAt: Date.now() + 3_600_000,
    });
    const files: [string, string][] = [
      ['events.tsv', EVENTS],
      ['loss_event_categories.tsv', CATEGORIES],
      ['business_line_mapping.tsv', MAPPING],
      ['capital_calculation_params.tsv', PARAMS],
      ['classified_events.schema.csv', SCHEMA],
    ];
    for (const [name, text] of files) {
      const measured = validateAgentAttachmentFileText(text);
      await store.addFile(SET_ID, OWNER, {
        name,
        mediaType: 'text/plain',
        kind: 'text',
        byteSize: measured.byteSize,
        charCount: measured.charCount,
        sha256: measured.sha256,
        extractedText: text,
      });
    }
    const set = await store.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    return { store, setDigest: computeAgentAttachmentSetDigest(set.files) };
  }

  it('co-locates the definition tables with the primary chunks and carries the BIA inputs on the final bundle', async () => {
    const { store, setDigest } = await storeWithBaselShape();
    const seenUserTexts: string[] = [];
    const seenInstructions: string[] = [];
    const executor: AgentModelExecutor = async (input) => {
      seenUserTexts.push(input.userText);
      seenInstructions.push(input.instruction);
      if (input.userText.startsWith('【出典: events.tsv')) {
        return {
          ok: true,
          text: JSON.stringify({
            rows: ['OR001', 'OR002', 'OR003', 'OR004', 'OR005', 'OR006'].map((id, index) => ({
              Event_ID: id,
              Loss_Event_Category: 'EL1',
              Business_Line: 'BL2',
              Loss_Amount_CNY: String((index + 1) * 100),
            })),
          }),
        };
      }
      return { ok: true, text: '{"rows":[]}' };
    };
    let content: string | undefined;
    let finalArtifact = '';
    for (const chunkOffset of [0, 2, 4]) {
      const result = await toolRegistry.attachment_analyzer.execute(
        analyzerParams(setDigest, {
          chunkOffset,
          chunkCount: 2,
          ...(content ? { content } : {}),
        }),
        contextFor(store, executor),
      );
      expect(result.ok).toBe(true);
      content = result.artifact;
      finalArtifact = result.artifact ?? '';
    }
    const primaryCall = seenUserTexts.find((text) => text.startsWith('【出典: events.tsv'));
    expect(primaryCall).toBeDefined();
    expect(primaryCall).toContain('【参照: loss_event_categories.tsv】');
    expect(primaryCall).toContain('EL1');
    expect(primaryCall).toContain('BL2');
    // The parameter table is settings, not a classification
    // definition: it is not co-located.
    expect(primaryCall).not.toContain('Alpha_Coefficient');
    // Reference-file chunks do not gain a reference block of their own.
    const referenceCall = seenUserTexts.find((text) => text.startsWith('【出典: loss_event_categories.tsv'));
    expect(referenceCall).toBeDefined();
    expect(referenceCall).not.toContain('【参照:');
    // The rows contract names the reference block when one is attached.
    expect(seenInstructions[0]).toContain('参照ブロック');
    const bundle = JSON.parse(finalArtifact) as {
      rows: unknown[];
      biaInputs?: { alphaText: string; grossIncomeByYear: Record<string, number> };
    };
    expect(bundle.rows).toHaveLength(6);
    expect(bundle.biaInputs).toEqual({
      alphaText: '0.15',
      grossIncomeByYear: { '2021': 2850000000, '2022': 3120000000, '2023': -456000000 },
    });
  });
});
