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
  agentDataCitationPairKey,
  agentGoalDirectedOutputLanguage,
  agentGoalUsesCjk,
  applyAgentDataPairGate,
  applyAgentDataValueSeeds,
  canonicalAgentDataAttribute,
  canonicalAgentDataFundingKey,
  computeAgentDataValueMismatches,
  extractAgentDataValueSeeds,
  mergeAgentDataStructures,
  normalizeAgentDataValueText,
  parseAgentDataValues,
  parseChunkOutputDetailed,
  parseFailureRepairGuidance,
  parseReconciliationOutput,
  summarizeAgentDataValueTable,
  synthesizeDeterministicCandidatePickups,
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

  it('attaches the computed bundle on the diagnostic channel when coverage refuses it (K-17, PR-β)', async () => {
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
    // The failure itself is unchanged: same code-bearing message,
    // and the bundle is NOT the step's artifact.
    expect(result.message).toContain('AGENT_DATA_COVERAGE_INSUFFICIENT');
    expect(result.artifact).toBeUndefined();
    // The rows the step actually computed survive on the diagnostic
    // channel, so the missing row is identifiable from the payload
    // alone — the diagnosis the failure message's aggregates cannot
    // give.
    const bundle = JSON.parse(result.diagnosticArtifact ?? '{}') as {
      kind: string;
      rows?: Array<Record<string, string>>;
    };
    expect(bundle.kind).toBe('data-analysis');
    expect(bundle.rows?.map((row) => row.id)).toEqual(['A-1', 'A-2']);
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
    // model, outcome, code, duration, transports; never a body. The
    // execution segment follows it (D8): the routes that dispatch
    // exercised are the step's execution trace, in the same shape a
    // later failure carries.
    expect(result.message).toBe(
      'PROVIDER_TIMEOUT (attempts: cloudflare-workers-ai-free|@cf/openai/gpt-oss-120b|availability-error|PROVIDER_TIMEOUT|25000|2; groq-free|openai/gpt-oss-120b|failed|PROVIDER_TIMEOUT|45000|1) (execution: servings=cloudflare-workers-ai-free|@cf/openai/gpt-oss-120b,groq-free|openai/gpt-oss-120b; repair=0)',
    );
    expect(sleeps).toEqual([15_000, 30_000]);
  });

  it('records the exercised route as the execution trace when the first dispatch fails outright (D8, Basel shape)', async () => {
    const { store, setDigest } = await storeWithFruits();
    const invalidExecutor: AgentModelExecutor = async () => ({
      ok: false,
      code: 'PROVIDER_INVALID_RESPONSE',
      providerAttempts: [
        { providerId: 'cloudflare-workers-ai-free', modelId: '@cf/google/gemma-4-26b-a4b-it', outcome: 'failed', errorCode: 'PROVIDER_INVALID_RESPONSE', durationMs: 22_895, transportRequestCount: 4 },
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'skipped' },
      ],
    });
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, invalidExecutor),
    );
    expect(result.ok).toBe(false);
    // Nothing ever succeeded, so before D8 this message carried no
    // execution segment and the step record had no analyzerExecution
    // — the record fell back to the attempts segment alone, in a
    // different shape from every successful step. The exercised
    // route now joins the trace; the skipped route, never
    // dispatched, does not.
    expect(result.message).toBe(
      'PROVIDER_INVALID_RESPONSE (attempts: cloudflare-workers-ai-free|@cf/google/gemma-4-26b-a4b-it|failed|PROVIDER_INVALID_RESPONSE|22895|4; groq-free|openai/gpt-oss-120b|skipped|-|-|-) (execution: servings=cloudflare-workers-ai-free|@cf/google/gemma-4-26b-a4b-it; repair=0)',
    );
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
    // layer applies to its surfaced diagnostics. The execution
    // segment (D8) harvests under the same whitelist: the two
    // surviving entries are its servings, the dropped entries
    // contribute nothing to either segment.
    expect(result.message).toBe(
      'PROVIDER_INTERNAL_ERROR (attempts: groq-free|openai/gpt-oss-120b|failed|PROVIDER_INTERNAL_ERROR|-|-; groq-free|-|failed|-|-|-) (execution: servings=groq-free|openai/gpt-oss-120b,groq-free|-; repair=0)',
    );
    expect(result.message).not.toContain('evil');
    expect(result.message).not.toContain('has space');
  });

  it('carries the final failure\'s finish reason and reasoning tokens after the attempts (Basel 案C)', async () => {
    const { store, setDigest } = await storeWithFruits();
    const detailExecutor: AgentModelExecutor = async () => ({
      ok: false,
      code: 'PROVIDER_INVALID_RESPONSE',
      providerAttempts: [
        { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'failed', errorCode: 'PROVIDER_INVALID_RESPONSE', durationMs: 12_000, transportRequestCount: 1 },
      ],
      providerFailureDetail: { finishReason: 'length', usageReasoningTokens: 2400 },
    });
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, detailExecutor),
    );
    expect(result.ok).toBe(false);
    // The production Basel shape with the 案C detail: the dispatch
    // died on an invalid response, and the record can now say the
    // completion ended at the length limit with its budget spent
    // on reasoning — the subtype the 2026-11-26 run could not
    // recover. The detail rides after the attempts, before the
    // execution segment, in the same fixed-shape style.
    expect(result.message).toBe(
      'PROVIDER_INVALID_RESPONSE (attempts: groq-free|openai/gpt-oss-120b|failed|PROVIDER_INVALID_RESPONSE|12000|1) (finish: length; reasoningTokens: 2400) (execution: servings=groq-free|openai/gpt-oss-120b; repair=0)',
    );
  });

  it('carries the final failure detail on its own when the dispatch recorded no attempts (Basel 案C)', async () => {
    const { store, setDigest } = await storeWithFruits();
    const tokensOnlyExecutor: AgentModelExecutor = async () => ({
      ok: false,
      code: 'PROVIDER_INVALID_RESPONSE',
      providerFailureDetail: { usageReasoningTokens: 2400 },
    });
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, tokensOnlyExecutor),
    );
    expect(result.ok).toBe(false);
    // Only the field the diagnostic carried is encoded — no finish
    // field is invented for a diagnostic that never reported one.
    expect(result.message).toBe('PROVIDER_INVALID_RESPONSE (reasoningTokens: 2400)');
  });

  it('drops final-failure detail fields outside the fixed shapes instead of encoding them (Basel 案C)', async () => {
    const { store, setDigest } = await storeWithFruits();
    const poisonedExecutor: AgentModelExecutor = async () => ({
      ok: false,
      code: 'PROVIDER_INVALID_RESPONSE',
      providerFailureDetail: { finishReason: 'a free-form sentence', usageReasoningTokens: -3 },
    } as unknown as Awaited<ReturnType<AgentModelExecutor>>);
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, poisonedExecutor),
    );
    expect(result.ok).toBe(false);
    // Neither field matches its closed shape, so the message is
    // exactly the bare code the failure produced before the detail
    // existed — free text never rides the message into the record.
    expect(result.message).toBe('PROVIDER_INVALID_RESPONSE');
    expect(result.message).not.toContain('free-form');
  });

  it('keeps a valid finish reason when the token count alone is unusable (Basel 案C)', async () => {
    const { store, setDigest } = await storeWithFruits();
    const partialExecutor: AgentModelExecutor = async () => ({
      ok: false,
      code: 'PROVIDER_INVALID_RESPONSE',
      providerFailureDetail: { finishReason: 'stop', usageReasoningTokens: 1.5 },
    } as unknown as Awaited<ReturnType<AgentModelExecutor>>);
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, partialExecutor),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('PROVIDER_INVALID_RESPONSE (finish: stop)');
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
    // C2 (diagnosis 2026-11-26): abbreviation identification
    // groups only when the stated scope matches — an unscoped
    // resolved value groups only with its identical raw name
    // (the production phantom: buyer2's pre-transaction 0% for
    // 厦门联芯美, mis-attributed to 物美集团, rode the
    // abbreviation onto the seller's 36.15%). The no-scope case
    // is pinned by the C2 replay test below.
    const candidates = computeAgentDataValueMismatches([
      { ...value('物美集团', '持股比例', '60%', 'announcement.txt'), scope: '交易前' },
      { ...value('物美科技集团有限公司', '持股比例', '55%', 'buyer2_report.txt'), scope: '交易前' },
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

  it('renders English labels when the goal directs English despite its CJK preamble (D5)', async () => {
    const { store, setDigest } = await storeWithFiles(AUDIT_FILES);
    const result = await toolRegistry.attachment_analyzer.execute(
      {
        attachmentSetId: SET_ID, setDigest,
        // The production M&A goal shape: a Japanese harness
        // preamble wrapped around an English brief whose first
        // report requirement is "Write in English". The CJK check
        // alone rendered Japanese labels for this goal.
        instruction: '添付ファイルが input です。成果物は指定されたファイル名・形式のファイルとして作成してください。\n\nReview the filings and write an English inconsistency audit.\n\nReport requirements:\n1. Write in English.\n2. Identify every material inconsistency you can support from the documents.',
        outputKind: 'findings', chunkOffset: 0, chunkCount: 4, auditMode: true,
      },
      contextFor(store, auditExecutor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as { content: string };
    expect(bundle.content).toContain('## Finding 1:');
    expect(bundle.content).toContain('- Why it is inconsistent:');
    expect(bundle.content).toContain('- Evidence:');
    expect(bundle.content).not.toContain('## 所見');
    expect(bundle.content).not.toContain('矛盾の説明');
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

  it('lets an explicit output-language directive outrank the CJK check (D5)', () => {
    // The production shape: a Japanese harness preamble (CJK)
    // wrapped around an English brief that directs English output.
    expect(agentGoalDirectedOutputLanguage('添付ファイルが input です。Write in English.')).toBe('english');
    expect(agentGoalDirectedOutputLanguage('英語で書いてください')).toBe('english');
    expect(agentGoalDirectedOutputLanguage('用英文撰写审计报告')).toBe('english');
    expect(agentGoalDirectedOutputLanguage('結果を日本語でまとめてください')).toBe('japanese');
    expect(agentGoalDirectedOutputLanguage('Write the summary in Japanese')).toBe('japanese');
    // A bare mention of a language directs nothing, and neither
    // does a goal directing both languages.
    expect(agentGoalDirectedOutputLanguage('英語の文書を要約してください')).toBeUndefined();
    expect(agentGoalDirectedOutputLanguage('文書の不整合を監査してください')).toBeUndefined();
    expect(agentGoalDirectedOutputLanguage('Write in English, then 日本語で書いてください')).toBeUndefined();
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
    // The layer-1 value table the analyzer contract requires:
    // every finding's pair stands in the table under one label.
    // The pair gate (D3) anchors against this table, so the
    // fixture carries it like a real analyzer bundle does.
    values: [
      { entity: '买方一', attribute: '金額', value: '146,660,323.00', file: 'announcement.txt', location: 'p.2' },
      { entity: '买方一', attribute: '金額', value: '146,660,332.00', file: 'buyer1_report.txt', location: 'p.3' },
      { entity: '聚源盛业', attribute: '比率・持分', value: '45%', file: 'announcement.txt', location: 'p.2' },
      { entity: '聚源盛业', attribute: '比率・持分', value: '40%', file: 'buyer1_report.txt', location: 'p.4' },
    ],
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

  // A bundle whose only candidate cannot form an anchor group:
  // its two values read as the same key (45% and 45.0% are one
  // value), so the deterministic candidate pickup (案B) has
  // nothing to synthesize from it. The fail-closed judgments
  // below run against this variant so they keep exercising the
  // empty-judgment path exactly as before the pickup existed.
  const ANALYZER_BUNDLE_DEGENERATE_CANDIDATE = JSON.stringify({
    ...(JSON.parse(ANALYZER_BUNDLE) as Record<string, unknown>),
    candidates: [{
      entity: '聚源盛业',
      attribute: '持股比例',
      values: [
        { value: '45%', normalizedValue: '45', file: 'announcement.txt', location: 'p.2' },
        { value: '45.0%', normalizedValue: '45', file: 'announcement.txt', location: 'p.2' },
      ],
    }],
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
    // The degenerate-candidate bundle: the candidate cannot be
    // picked up deterministically either, so the judged list is
    // empty after every layer and the step fails closed (案B).
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest, { content: ANALYZER_BUNDLE_DEGENERATE_CANDIDATE }),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_RECONCILIATION_NO_FINDINGS');
  });

  it('enforce: a NO_FINDINGS failure carries the reconciliation summary on the diagnostic channel (C0)', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    // The model vetted one finding, but its pair (999,999 vs
    // 888,888) stands nowhere in the value table, so the pair
    // gate drops it — the production M&A shape, where the record
    // could not tell the model from the gate apart.
    const executor: AgentModelExecutor = async () => ({
      ok: true,
      text: JSON.stringify({
        findings: [{
          claim: '対価の金額が食い違う',
          explanation: '公告と買主1報告で同一主体の対価が異なる',
          evidence: '999,999.00元', file: 'announcement.txt', location: 'p.2',
          evidenceB: '888,888.00元', fileB: 'buyer1_report.txt', locationB: 'p.3',
          source: { kind: 'kept', index: 0 },
        }],
        dropped: [{ index: 1, reason: 'boilerplate' }],
      }),
    });
    // The degenerate-candidate bundle, so the deterministic
    // pickup cannot rescue the judgment either and the failure
    // (and its diagnostic channel) is what is exercised.
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest, { content: ANALYZER_BUNDLE_DEGENERATE_CANDIDATE }),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_RECONCILIATION_NO_FINDINGS');
    const diagnostic = JSON.parse(result.diagnosticArtifact ?? '{}') as {
      kind: string;
      reconciliation: { mode: string; candidateCount: number; keptCount: number; droppedCount: number; droppedReasons: Record<string, number>; pickedUpCount: number; keptIndexes: number[]; droppedIndexes: { index: number; reason: string }[] };
      parsedFindingsCount: number;
      parsedPickedUpCount: number;
      gatedOutKeptIndexes: number[];
    };
    expect(diagnostic.kind).toBe('attachment-reconciliation-failure');
    // One candidate existed, the model kept one finding (so the
    // model did not empty the list), the gate dropped it.
    expect(diagnostic.parsedFindingsCount).toBe(1);
    // 案C: the parse stage's pickup count and the gate's own
    // drops ride the same channel, separating the model's
    // declarations from the gate's removals — the model built
    // no candidate finding (parse pickup 0) and the gate, not
    // the model, removed kept original 0.
    expect(diagnostic.parsedPickedUpCount).toBe(0);
    expect(diagnostic.gatedOutKeptIndexes).toEqual([0]);
    expect(diagnostic.reconciliation).toEqual({
      mode: 'enforce',
      candidateCount: 1,
      keptCount: 0,
      droppedCount: 2,
      droppedReasons: { boilerplate: 1, 'no-pair': 1 },
      pickedUpCount: 0,
      keptIndexes: [],
      droppedIndexes: [{ index: 1, reason: 'boilerplate' }, { index: 0, reason: 'no-pair' }],
    });
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
      reconciliation: { failed?: boolean; failureCode?: string; candidateCount: number; keptIndexes?: number[]; droppedIndexes?: unknown[] };
    };
    expect(bundle.findings).toHaveLength(2);
    expect(bundle.reconciliation.failed).toBe(true);
    expect(bundle.reconciliation.candidateCount).toBe(1);
    // The failure's reason rides the record (D4): the output
    // stayed unparseable after the repair retry, which is the
    // code the step would have failed with under enforce.
    expect(bundle.reconciliation.failureCode).toBe('AGENT_RECONCILIATION_OUTPUT_INVALID');
    // Nothing was judged, so no index lists are recorded — an
    // unjudged reconciliation must not read as an empty judgment
    // (対策1(a)).
    expect(bundle.reconciliation.keptIndexes).toBeUndefined();
    expect(bundle.reconciliation.droppedIndexes).toBeUndefined();
  });

  it('shadow: a provider failure records the provider code as the failure reason (D4)', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: false, code: 'PROVIDER_INVALID_RESPONSE' });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'shadow'),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      reconciliation: { failed?: boolean; failureCode?: string; candidateCount: number };
    };
    expect(bundle.reconciliation.failed).toBe(true);
    expect(bundle.reconciliation.failureCode).toBe('PROVIDER_INVALID_RESPONSE');
    expect(bundle.reconciliation.candidateCount).toBe(1);
  });

  it('shadow: candidates with no vetted findings record AGENT_RECONCILIATION_NO_FINDINGS (D4)', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({
      ok: true,
      text: JSON.stringify({ findings: [], dropped: [{ index: 0, reason: 'no-pair' }, { index: 1, reason: 'boilerplate' }] }),
    });
    // The degenerate-candidate bundle, so the deterministic
    // pickup (案B) cannot fill the judged list either.
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest, { content: ANALYZER_BUNDLE_DEGENERATE_CANDIDATE }),
      contextWithMode(store, executor, 'shadow'),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      reconciliation: { failed?: boolean; failureCode?: string; keptCount: number };
    };
    expect(bundle.reconciliation.failed).toBe(true);
    expect(bundle.reconciliation.failureCode).toBe('AGENT_RECONCILIATION_NO_FINDINGS');
    expect(bundle.reconciliation.keptCount).toBe(0);
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

  it('reconciler timing: an enforce success carries its dispatch timing (D7 countermeasure A)', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const timing = { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'succeeded' as const, durationMs: 321 };
    const executor: AgentModelExecutor = async () => ({ ok: true, text: VETTED_OUTPUT, timing });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(true);
    expect(result.modelCallTimings).toEqual([timing]);
  });

  it('reconciler timing: a shadow failure still carries the failed dispatch timing (D7 countermeasure A)', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const timing = { providerId: 'groq-free', outcome: 'failed' as const, errorCode: 'PROVIDER_INVALID_RESPONSE', durationMs: 42 };
    const executor: AgentModelExecutor = async () => ({ ok: false, code: 'PROVIDER_INVALID_RESPONSE', timing });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'shadow'),
    );
    // Shadow never fails the step; the timing rides the pass-through.
    expect(result.ok).toBe(true);
    expect(result.modelCallTimings).toEqual([timing]);
  });

  it('reconciler timing: an executor without timing evidence leaves the result untouched (D7 countermeasure A)', async () => {
    const { store, setDigest } = await storeWithFiles(RECONCILER_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: VETTED_OUTPUT });
    const result = await toolRegistry.attachment_reconciler.execute(
      reconcilerParams(setDigest),
      contextWithMode(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('modelCallTimings');
  });
});

describe('function inspection 2026-11-25: D2 deterministic pairing, D3 pair gate', () => {
  const value = (entity: string, attribute: string, raw: string, file: string): AgentDataValue => ({
    entity, attribute, value: raw, file, location: 'p.1',
  });
  const NO_STRUCTURE = { agreements: [], definitions: [] };

  it('canonicalizes written attribute labels onto the controlled vocabulary (D2)', () => {
    expect(canonicalAgentDataAttribute('金額')).toBe('金額');
    expect(canonicalAgentDataAttribute('対価')).toBe('金額');
    expect(canonicalAgentDataAttribute('对价')).toBe('金額');
    expect(canonicalAgentDataAttribute('持分')).toBe('比率・持分');
    expect(canonicalAgentDataAttribute('持股比例')).toBe('比率・持分');
    expect(canonicalAgentDataAttribute('比率・持分')).toBe('比率・持分');
    expect(canonicalAgentDataAttribute('资金来源')).toBe('資金源泉');
    expect(canonicalAgentDataAttribute('funding source')).toBe('資金源泉');
    expect(canonicalAgentDataAttribute('数量')).toBe('株数');
    expect(canonicalAgentDataAttribute('日付')).toBe('日付');
    // A label outside the vocabulary and its aliases never pairs.
    expect(canonicalAgentDataAttribute('承認状態')).toBeUndefined();
    expect(canonicalAgentDataAttribute('')).toBeUndefined();
  });

  it('reads funding-source values as compositions, across languages and wordings (D2)', () => {
    expect(canonicalAgentDataFundingKey('自有资金')).toBe('funding:self');
    expect(canonicalAgentDataFundingKey('自己資金のみ')).toBe('funding:self');
    expect(canonicalAgentDataFundingKey('self-funded only')).toBe('funding:self');
    expect(canonicalAgentDataFundingKey('自有資金及银行借款')).toBe('funding:bank+self');
    expect(canonicalAgentDataFundingKey('部分来源于自有资金及向银行的借款')).toBe('funding:bank+self');
    expect(canonicalAgentDataFundingKey('partly bank loans')).toBe('funding:bank');
    // A status disclosure states no funding composition.
    expect(canonicalAgentDataFundingKey('尚需取得上证合规性审查意见')).toBeUndefined();
  });

  it('raises all three verified M&A pairs from mixed free labels (D2 yardstick)', () => {
    const candidates = computeAgentDataValueMismatches([
      // R1 対価: the same attribute under two different writings.
      value('买方一', '対価', '146,660,323.00', 'announcement.txt'),
      value('买方一', '金額', '146,660,332.00', 'buyer1_report.txt'),
      // R2 持分: 45% vs 40% under two different writings.
      value('聚源盛业', '持分', '45%', 'announcement.txt'),
      value('聚源盛业', '持株比率', '40%', 'buyer1_report.txt'),
      // R3 資金源泉: the English forms the inspection fixed.
      value('买方一', '資金源泉', 'self-funded only', 'announcement.txt'),
      value('买方一', 'funding source', 'partly bank loans', 'buyer1_report.txt'),
    ], NO_STRUCTURE);
    expect(candidates).toHaveLength(3);
    const consideration = candidates.find((candidate) => candidate.entity === '买方一'
      && candidate.values.some((entry) => entry.normalizedValue === '146660323'));
    expect(consideration?.values.map((entry) => entry.normalizedValue)).toEqual(['146660323', '146660332']);
    const stake = candidates.find((candidate) => candidate.entity === '聚源盛业');
    expect(stake?.values.map((entry) => entry.normalizedValue)).toEqual(['45', '40']);
    const funding = candidates.find((candidate) => candidate.values.some((entry) => entry.value === 'self-funded only'));
    expect(funding?.values.map((entry) => entry.value)).toEqual(['self-funded only', 'partly bank loans']);
    expect(funding?.values.map((entry) => entry.normalizedValue)).toEqual(['funding:self', 'funding:bank']);
  });

  it('does not raise pairs the deterministic reading judges equal, nor pairs outside the vocabulary (D2)', () => {
    // The same funding composition written two ways agrees.
    expect(computeAgentDataValueMismatches([
      value('买方一', '資金源泉', '自有资金', 'announcement.txt'),
      value('买方一', '資金源泉', '自己資金のみ', 'buyer1_report.txt'),
    ], NO_STRUCTURE)).toEqual([]);
    // A unit decoration is not a different amount.
    expect(computeAgentDataValueMismatches([
      value('买方一', '金額', '146,660,323.00元', 'announcement.txt'),
      value('买方一', '金額', '146,660,323', 'buyer1_report.txt'),
    ], NO_STRUCTURE)).toEqual([]);
    // …but the decorated writings of the two R1 amounts still pair.
    const decorated = computeAgentDataValueMismatches([
      value('买方一', '金額', '146,660,323.00元', 'announcement.txt'),
      value('买方一', '金額', '146,660,332.00元', 'buyer1_report.txt'),
    ], NO_STRUCTURE);
    expect(decorated).toHaveLength(1);
    expect(decorated[0]?.values.map((entry) => entry.normalizedValue)).toEqual(['146660323', '146660332']);
    // Dates pair across writings, and agree across writings.
    const dates = computeAgentDataValueMismatches([
      value('买方一', '日付', '2024年3月31日', 'announcement.txt'),
      value('买方一', '日付', '2024/04/01', 'buyer1_report.txt'),
    ], NO_STRUCTURE);
    expect(dates).toHaveLength(1);
    expect(dates[0]?.values.map((entry) => entry.normalizedValue)).toEqual(['2024-03-31', '2024-04-01']);
    expect(computeAgentDataValueMismatches([
      value('买方一', '日付', '2024年3月31日', 'announcement.txt'),
      value('买方一', '日付', '2024-03-31', 'buyer1_report.txt'),
    ], NO_STRUCTURE)).toEqual([]);
    // A label outside the controlled vocabulary never pairs,
    // even with differing values on both sides.
    expect(computeAgentDataValueMismatches([
      value('买方一', '承認状態', '未了', 'announcement.txt'),
      value('买方一', '承認状態', '完了', 'buyer1_report.txt'),
    ], NO_STRUCTURE)).toEqual([]);
  });

  it('summarizes the value table in the canonical grouping (D2)', () => {
    const summary = summarizeAgentDataValueTable([
      value('买方一', '対価', '146,660,323.00', 'announcement.txt'),
      value('买方一', '金額', '146,660,332.00', 'buyer1_report.txt'),
      value('买方一', '承認状態', '未了', 'announcement.txt'),
    ], NO_STRUCTURE);
    expect(summary.entryCount).toBe(3);
    expect(summary.groupCount).toBe(1);
    expect(summary.groups[0]).toEqual({ entity: '买方一', attribute: '対価', entries: 2, distinctValues: 2 });
  });

  it('extracts the pair key of a citation deterministically (D3)', () => {
    expect(agentDataCitationPairKey('146,660,323.00元')).toBe('146660323');
    expect(agentDataCitationPairKey('対価 146,660,323.00 元')).toBe('146660323');
    expect(agentDataCitationPairKey('45%')).toBe('45');
    expect(agentDataCitationPairKey('自有资金')).toBe('funding:self');
    expect(agentDataCitationPairKey('尚需取得上证合规性审查意见')).toBeUndefined();
  });

  // The bundle behind the gate tests: the consideration pair and
  // a real funding pair stand in the table; the second original
  // finding is the production D3 mispair (a funding value glued
  // to an unrelated approval-status disclosure).
  const GATE_BUNDLE = JSON.stringify({
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
        claim: '資金源泉と承認手続きが不整合である',
        explanation: '資金源泉の開示と承認の状態が食い違う',
        evidence: '自有资金', file: 'announcement.txt', location: '資金源泉欄',
        evidenceB: '尚需取得上证合规性审查意见', fileB: 'announcement.txt', locationB: 'p.5',
      },
    ],
    values: [
      { entity: '买方一', attribute: '金額', value: '146,660,323.00', file: 'announcement.txt', location: 'p.2' },
      { entity: '买方一', attribute: '金額', value: '146,660,332.00', file: 'buyer1_report.txt', location: 'p.3' },
      { entity: '买方一', attribute: '資金源泉', value: '自有资金', file: 'announcement.txt', location: '資金源泉欄' },
      { entity: '买方一', attribute: '資金源泉', value: '部分来源于自有资金及向银行的借款', file: 'buyer1_report.txt', location: '12頁' },
    ],
    structure: { agreements: [], definitions: [] },
    candidates: [{
      entity: '买方一',
      attribute: '金額',
      values: [
        { value: '146,660,323.00', normalizedValue: '146660323', file: 'announcement.txt', location: 'p.2' },
        { value: '146,660,332.00', normalizedValue: '146660332', file: 'buyer1_report.txt', location: 'p.3' },
      ],
    }],
  });

  const GATE_BUNDLE_MATERIAL = {
    values: [
      value('买方一', '金額', '146,660,323.00', 'announcement.txt'),
      value('买方一', '金額', '146,660,332.00', 'buyer1_report.txt'),
      value('买方一', '資金源泉', '自有资金', 'announcement.txt'),
      value('买方一', '資金源泉', '部分来源于自有资金及向银行的借款', 'buyer1_report.txt'),
    ],
    structure: NO_STRUCTURE,
    candidates: [{
      entity: '买方一',
      attribute: '金額',
      values: [
        { value: '146,660,323.00', normalizedValue: '146660323', file: 'announcement.txt', location: 'p.2' },
        { value: '146,660,332.00', normalizedValue: '146660332', file: 'buyer1_report.txt', location: 'p.3' },
      ],
    }],
  };

  it('gates out a kept finding whose pair does not stand in the table (D3)', () => {
    const parsed = parseReconciliationOutput(JSON.stringify({
      findings: [
        {
          claim: '対価の金額が食い違う', explanation: '説明',
          evidence: '146,660,323.00元', file: 'announcement.txt', location: 'p.2',
          evidenceB: '146,660,332.00元', fileB: 'buyer1_report.txt', locationB: 'p.3',
          source: { kind: 'kept', index: 0 },
        },
        {
          claim: '資金源泉と承認手続きが不整合である', explanation: '説明',
          evidence: '自有资金', file: 'announcement.txt', location: '資金源泉欄',
          evidenceB: '尚需取得上证合规性审查意见', fileB: 'announcement.txt', locationB: 'p.5',
          source: { kind: 'kept', index: 1 },
        },
      ],
      dropped: [],
    }), 2, 1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const gated = applyAgentDataPairGate(parsed, GATE_BUNDLE_MATERIAL);
    expect(gated.findings.map((finding) => finding.claim)).toEqual(['対価の金額が食い違う']);
    expect(gated.keptIndexes).toEqual([0]);
    expect(gated.gatedOutKeptIndexes).toEqual([1]);
    expect(gated.dropped).toEqual([{ index: 1, reason: 'no-pair' }]);
    expect(gated.pickedUpCount).toBe(0);
  });

  it('gates out a candidate-built finding that misquotes its own candidate (D3)', () => {
    const bundle = {
      values: [] as AgentDataValue[],
      structure: NO_STRUCTURE,
      candidates: [{
        entity: '聚源盛业',
        attribute: '比率・持分',
        values: [
          { value: '45%', normalizedValue: '45', file: 'announcement.txt', location: 'p.2' },
          { value: '40%', normalizedValue: '40', file: 'buyer1_report.txt', location: 'p.4' },
        ],
      }],
    };
    const misquote = parseReconciliationOutput(JSON.stringify({
      findings: [{
        claim: '持分が食い違う', explanation: '説明',
        evidence: '50%', file: 'announcement.txt', location: 'p.2',
        evidenceB: '40%', fileB: 'buyer1_report.txt', locationB: 'p.4',
        source: { kind: 'candidate', index: 0 },
      }],
    }), 0, 1);
    expect(misquote.ok).toBe(true);
    if (!misquote.ok) return;
    const gatedMisquote = applyAgentDataPairGate(misquote, bundle);
    expect(gatedMisquote.findings).toEqual([]);
    expect(gatedMisquote.pickedUpCount).toBe(0);
    const faithful = parseReconciliationOutput(JSON.stringify({
      findings: [{
        claim: '持分が食い違う', explanation: '説明',
        evidence: '45%', file: 'announcement.txt', location: 'p.2',
        evidenceB: '40%', fileB: 'buyer1_report.txt', locationB: 'p.4',
        source: { kind: 'candidate', index: 0 },
      }],
    }), 0, 1);
    expect(faithful.ok).toBe(true);
    if (!faithful.ok) return;
    const gatedFaithful = applyAgentDataPairGate(faithful, bundle);
    expect(gatedFaithful.findings).toHaveLength(1);
    expect(gatedFaithful.pickedUpCount).toBe(1);
  });

  // The gate bundle with a candidate that cannot form an anchor
  // group (both values read as the one amount 146660323), so the
  // deterministic pickup (案B) synthesizes nothing from it and
  // the gate-emptying fail-closed path is exercised as before.
  const GATE_BUNDLE_DEGENERATE_CANDIDATE = JSON.stringify({
    ...(JSON.parse(GATE_BUNDLE) as Record<string, unknown>),
    candidates: [{
      entity: '买方一',
      attribute: '金額',
      values: [
        { value: '146,660,323.00', normalizedValue: '146660323', file: 'announcement.txt', location: 'p.2' },
        { value: '146,660,323', normalizedValue: '146660323', file: 'buyer1_report.txt', location: 'p.3' },
      ],
    }],
  });

  const GATE_FILES = [
    { name: 'announcement.txt', text: '公告本文。' },
    { name: 'buyer1_report.txt', text: '買主一報告本文。' },
  ];
  const gateParams = (setDigest: string, extra: Record<string, unknown> = {}) => ({
    attachmentSetId: SET_ID,
    setDigest,
    instruction: 'Audit the documents for inconsistencies and report each inconsistency with its explanation.',
    content: GATE_BUNDLE,
    ...extra,
  });
  const gateContext = (
    store: InMemoryAgentAttachmentStore,
    modelCall: AgentModelExecutor,
    mode: string,
  ): ToolExecutionContext => ({
    ...contextFor(store, modelCall),
    env: { ORIGIN_AGENT_FINDINGS_RECONCILIATION_ENABLED: mode },
  });
  const KEEPS_BOTH_OUTPUT = JSON.stringify({
    findings: [
      {
        claim: '対価の金額が食い違う', explanation: '公告と買主1報告で同一主体の対価が異なる',
        evidence: '146,660,323.00元', file: 'announcement.txt', location: 'p.2',
        evidenceB: '146,660,332.00元', fileB: 'buyer1_report.txt', locationB: 'p.3',
        source: { kind: 'kept', index: 0 },
      },
      {
        claim: '資金源泉と承認手続きが不整合である', explanation: '資金源泉の開示と承認の状態が食い違う',
        evidence: '自有资金', file: 'announcement.txt', location: '資金源泉欄',
        evidenceB: '尚需取得上证合规性审查意见', fileB: 'announcement.txt', locationB: 'p.5',
        source: { kind: 'kept', index: 1 },
      },
    ],
    dropped: [],
  });

  it('enforce: the mispair does not reach the deliverable, and the drop is recorded as no-pair (D3)', async () => {
    const { store, setDigest } = await storeWithFiles(GATE_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: KEEPS_BOTH_OUTPUT });
    const result = await toolRegistry.attachment_reconciler.execute(
      gateParams(setDigest),
      gateContext(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      findings: { claim: string; origin?: string }[];
      reconciliation: {
        keptCount: number; droppedCount: number; droppedReasons: Record<string, number>;
        keptIndexes?: number[]; droppedIndexes?: { index: number; reason: string }[];
      };
      content: string;
    };
    // The kept original publishes, the mispair does not. The
    // bundle's candidate names the very pair the kept original
    // states — same group, same two values — so the candidate
    // is covered by the model's own finding and the
    // deterministic pickup (案B) adds nothing: the pair
    // publishes exactly once.
    expect(bundle.findings.map((finding) => finding.claim)).toEqual([
      '対価の金額が食い違う',
    ]);
    expect(bundle.findings[0]?.origin).toBeUndefined();
    expect(bundle.content).not.toContain('資金源泉と承認手続きが不整合である');
    expect(bundle.reconciliation.keptCount).toBe(1);
    expect(bundle.reconciliation.droppedCount).toBe(1);
    expect(bundle.reconciliation.droppedReasons).toEqual({ 'no-pair': 1 });
    expect(bundle.reconciliation.keptIndexes).toEqual([0]);
    expect(bundle.reconciliation.droppedIndexes).toEqual([{ index: 1, reason: 'no-pair' }]);
  });

  it('enforce: fails closed when the gate empties the vetted list (D3)', async () => {
    const { store, setDigest } = await storeWithFiles(GATE_FILES);
    const executor: AgentModelExecutor = async () => ({
      ok: true,
      text: JSON.stringify({
        findings: [{
          claim: '資金源泉と承認手続きが不整合である', explanation: '説明',
          evidence: '自有资金', file: 'announcement.txt', location: '資金源泉欄',
          evidenceB: '尚需取得上证合规性审查意见', fileB: 'announcement.txt', locationB: 'p.5',
          source: { kind: 'kept', index: 1 },
        }],
        dropped: [{ index: 0, reason: 'other' }],
      }),
    });
    // The degenerate-candidate variant, so the deterministic
    // pickup (案B) cannot refill the emptied list either.
    const result = await toolRegistry.attachment_reconciler.execute(
      gateParams(setDigest, { content: GATE_BUNDLE_DEGENERATE_CANDIDATE }),
      gateContext(store, executor, 'enforce'),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_RECONCILIATION_NO_FINDINGS');
  });

  it('shadow: the gate shapes the recorded judgment but the deliverable still ships the originals (D3)', async () => {
    const { store, setDigest } = await storeWithFiles(GATE_FILES);
    const executor: AgentModelExecutor = async () => ({ ok: true, text: KEEPS_BOTH_OUTPUT });
    const result = await toolRegistry.attachment_reconciler.execute(
      gateParams(setDigest),
      gateContext(store, executor, 'shadow'),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      findings: { claim: string }[];
      reconciledFindings: { claim: string }[];
      reconciliation: {
        failed?: boolean; keptIndexes?: number[];
        droppedIndexes?: { index: number; reason: string }[];
      };
    };
    expect(bundle.findings.map((finding) => finding.claim)).toEqual([
      '対価の金額が食い違う', '資金源泉と承認手続きが不整合である',
    ]);
    // The recorded judgment is the gated list alone: the
    // bundle's candidate is covered by the kept original
    // stating the same pair, so the deterministic pickup (案B)
    // adds nothing, exactly as enforce publishes.
    expect(bundle.reconciledFindings.map((finding) => finding.claim)).toEqual([
      '対価の金額が食い違う',
    ]);
    expect(bundle.reconciliation.failed).toBeUndefined();
    expect(bundle.reconciliation.keptIndexes).toEqual([0]);
    expect(bundle.reconciliation.droppedIndexes).toEqual([{ index: 1, reason: 'no-pair' }]);
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

  it('attaches the computed bundle on the diagnostic channel when the required-columns gate refuses it (K-17, PR-β)', async () => {
    const { store, setDigest } = await storeWithTypedFiles(BASEL_FILES);
    // The production Basel failure shape again: faithful rows, no
    // derived columns. The gate still refuses — and now the rows it
    // refused ride the diagnostic channel, so a diagnosis can see
    // exactly which rows lacked the columns instead of re-deriving
    // them from the input.
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
    expect(result.artifact).toBeUndefined();
    const bundle = JSON.parse(result.diagnosticArtifact ?? '{}') as {
      kind: string;
      rows?: Array<Record<string, string>>;
    };
    expect(bundle.kind).toBe('data-analysis');
    expect(bundle.rows?.map((row) => row.Event_ID)).toEqual(['OR001', 'OR002']);
    expect(bundle.rows?.every((row) => !('Loss_Event_Category' in row))).toBe(true);
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

  it('names the three read-stage dropout rules in the audit contract (run-f0d306fe)', async () => {
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
    // A stake held inside an entity is reported under the
    // holder's name, a checkbox-selected disclosure counts as a
    // value, and the entity is the party's name, not a role word:
    // the three shapes the failed run's sources carried but the
    // value table never received.
    expect(instructions[0]).toContain('合伙份额・出資比率など主体の中での持分は、持分を持つ主体の名称をentityにして報告すること');
    expect(instructions[0]).toContain('チェックボックスで選択された開示（資金源泉の「√自有资金」など）も値として報告すること');
    expect(instructions[0]).toContain('entityは役割語（情報披露義務人など）でなく当事者の名称で書くこと');
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

describe('model call timing channel (D7 countermeasure A)', () => {
  const TIMING_OK = { providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'succeeded' as const, durationMs: 321 };

  it('analyzer: a successful step carries its dispatch timing', async () => {
    const { store, setDigest } = await storeWithFruits();
    const executor: AgentModelExecutor = async (input) => {
      const base = await classifyingExecutor(input);
      return base.ok ? { ...base, timing: { ...TIMING_OK } } : base;
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    expect(result.modelCallTimings).toEqual([TIMING_OK]);
  });

  it('analyzer: a transient retry appends one entry per dispatch, in dispatch order', async () => {
    const { store, setDigest } = await storeWithFruits();
    const sleeps: number[] = [];
    let calls = 0;
    const executor: AgentModelExecutor = async (input) => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          code: 'PROVIDER_UNAVAILABLE',
          timing: { providerId: 'cloudflare-workers-ai-free', outcome: 'failed' as const, errorCode: 'PROVIDER_UNAVAILABLE', durationMs: 100 },
        };
      }
      const base = await classifyingExecutor(input);
      return base.ok ? { ...base, timing: { ...TIMING_OK, durationMs: 200 } } : base;
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, executor, recordingSleep(sleeps)),
    );
    expect(result.ok).toBe(true);
    expect(sleeps).toEqual([15_000]);
    expect(result.modelCallTimings).toEqual([
      { providerId: 'cloudflare-workers-ai-free', outcome: 'failed', errorCode: 'PROVIDER_UNAVAILABLE', durationMs: 100 },
      { ...TIMING_OK, durationMs: 200 },
    ]);
  });

  it('analyzer: a provider failure carries its dispatch timing on the failure result', async () => {
    const { store, setDigest } = await storeWithFruits();
    const timing = { providerId: 'groq-free', outcome: 'failed' as const, errorCode: 'PROVIDER_INVALID_RESPONSE', durationMs: 42 };
    const executor: AgentModelExecutor = async () => ({ ok: false, code: 'PROVIDER_INVALID_RESPONSE', timing });
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, executor),
    );
    expect(result.ok).toBe(false);
    expect(result.modelCallTimings).toEqual([timing]);
  });

  it('analyzer: an executor without timing evidence leaves the result untouched', async () => {
    const { store, setDigest } = await storeWithFruits();
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, classifyingExecutor),
    );
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('modelCallTimings');
  });
});

describe('deterministic value seeds (C1/C2, diagnosis 2026-11-26)', () => {
  // Deterministic excerpts of the production M&A fixture: the
  // announcement's summary tables (label on one line, value on
  // the next — the fragmentation the model drops), the buyers'
  // pre/post holding tables, and the funding sentences. The
  // full four-document run is verified offline (scratch), these
  // excerpts pin the extractor's contract in CI.
  const ANNOUNCEMENT_EXCERPT = [
    '受让方1 名称',
    '杭州景祺电子信息合伙企业（有限合伙）',
    '转让股份数量（股）',
    '11,281,564',
    '转让股份比例（%）',
    '5.00',
    '转让价格（元/股）',
    '13.00',
    '协议转让对价',
    '146,660,332.00',
    '资金来源',
    '√自有资金',
    '受让方2 名称',
    '厦门联芯美企业管理合伙企业（有限合伙）',
    '转让股份数量（股）',
    '11,281,564',
    '转让股份比例（%）',
    '5.00',
    '协议转让对价',
    '146,660,323.00',
    '资金来源',
    '√自有资金',
    '聚源盛业投资（宁波）有限公司持有45%合伙份额',
  ].join('\n');

  const BUYER1_HOLDING_TABLE = [
    '本次权益变动前，信息披露义务人不持有上市公司股份。',
    '本次权益变动前后，信息披露义务人持有上市公司股份变动的情况如下：',
    '信息披露义务人',
    '本次权益变动前',
    '本次权益变动后',
    '持股数量',
    '（股）',
    '占上市公司',
    '总股本比例',
    '持股数量',
    '（股）',
    '占上市公司',
    '总股本比例',
    '杭州景祺',
    '0',
    '0%',
    '11,281,564',
    '5%',
  ].join('\n');

  const BUYER1_FUNDING = [
    '信息披露义务人：杭州景祺电子信息合伙企业（有限合伙）',
    '本次权益变动资金来源部分来源于信息披露义务人向银行的借款。',
    '聚源盛业投资（宁波）有限公司持有40%合伙份额',
  ].join('\n');

  const hasSeed = (
    seeds: AgentDataValue[],
    entity: string,
    attribute: string,
    value: string,
    scope?: string,
  ): boolean => seeds.some((seed) =>
    seed.entity === entity && seed.attribute === attribute && seed.value === value && (seed.scope ?? undefined) === scope,
  );

  it('seeds the announcement table: amounts, share counts and checked funding, but never the per-share price', () => {
    const seeds = extractAgentDataValueSeeds({ index: 0, fileName: 'announcement.txt', text: ANNOUNCEMENT_EXCERPT });
    expect(hasSeed(seeds, '杭州景祺电子信息合伙企业(有限合伙)', '金額', '146,660,332.00')).toBe(true);
    expect(hasSeed(seeds, '厦门联芯美企业管理合伙企业(有限合伙)', '金額', '146,660,323.00')).toBe(true);
    expect(hasSeed(seeds, '杭州景祺电子信息合伙企业(有限合伙)', '株数', '11,281,564')).toBe(true);
    expect(hasSeed(seeds, '杭州景祺电子信息合伙企业(有限合伙)', '資金源泉', '自有资金')).toBe(true);
    expect(hasSeed(seeds, '厦门联芯美企业管理合伙企业(有限合伙)', '資金源泉', '自有资金')).toBe(true);
    expect(hasSeed(seeds, '聚源盛业投资(宁波)有限公司', '比率・持分', '45%')).toBe(true);
    // 13.00 is the per-share price (元/股), not a total: seeding
    // it as 金額 would pair a unit price with the totals.
    expect(seeds.some((seed) => seed.value === '13.00')).toBe(false);
  });

  it('seeds a pre/post holding table with the scope each row states', () => {
    const seeds = extractAgentDataValueSeeds({ index: 4, fileName: 'buyer1_report.txt', text: BUYER1_HOLDING_TABLE });
    expect(hasSeed(seeds, '杭州景祺', '株数', '0', '交易前')).toBe(true);
    expect(hasSeed(seeds, '杭州景祺', '比率・持分', '0%', '交易前')).toBe(true);
    expect(hasSeed(seeds, '杭州景祺', '株数', '11,281,564', '交易后')).toBe(true);
    expect(hasSeed(seeds, '杭州景祺', '比率・持分', '5%', '交易后')).toBe(true);
    expect(seeds).toHaveLength(4);
  });

  it('seeds the funding sentence under the discloser, and the holding ratio on the line', () => {
    const seeds = extractAgentDataValueSeeds({ index: 5, fileName: 'buyer1_report.txt', text: BUYER1_FUNDING });
    expect(hasSeed(seeds, '杭州景祺电子信息合伙企业(有限合伙)', '資金源泉', '银行借款')).toBe(true);
    expect(hasSeed(seeds, '聚源盛业投资(宁波)有限公司', '比率・持分', '40%')).toBe(true);
  });

  it('never seeds a holder that is a fragment of a name', () => {
    const seeds = extractAgentDataValueSeeds({
      index: 0,
      fileName: 'announcement.txt',
      text: ['直接持有5%合伙份额', '集团股份有限公司持有100%股份'].join('\n'),
    });
    expect(seeds).toHaveLength(0);
  });

  it('C2 replay: the production phantom (buyer2 0% mis-attributed to 物美集团) no longer candidates', () => {
    const values: AgentDataValue[] = [
      { entity: '物美集团', attribute: '持股比例', value: '0%', file: 'buyer2_report.txt', location: 'Page 7' },
      { entity: '物美科技集团有限公司', attribute: '持股比例', value: '36.15%', file: 'seller_report.txt', location: 'Page 19' },
      // A control pair that must still candidate: the grouping
      // itself is intact, only the abbreviation ride is closed.
      { entity: '聚源盛业', attribute: '持股比例', value: '45%', file: 'announcement.txt', location: 'p.2' },
      { entity: '聚源盛业', attribute: '持股比例', value: '40%', file: 'buyer1_report.txt', location: 'p.4' },
    ];
    const structure = {
      agreements: [],
      definitions: [{ short: '物美集团', full: '物美科技集团有限公司', file: 'buyer2_report.txt', location: 'Page 4' }],
    };
    const mismatches = computeAgentDataValueMismatches(values, structure);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.entity).toBe('聚源盛业');
  });

  it('C2: the same pair with a stated, equal scope does candidate through the abbreviation', () => {
    const values: AgentDataValue[] = [
      { entity: '物美集团', attribute: '持股比例', value: '0%', file: 'buyer2_report.txt', location: 'Page 7', scope: '交易前' },
      { entity: '物美科技集团有限公司', attribute: '持股比例', value: '36.15%', file: 'seller_report.txt', location: 'Page 19', scope: '交易前' },
    ];
    const structure = {
      agreements: [],
      definitions: [{ short: '物美集团', full: '物美科技集团有限公司', file: 'buyer2_report.txt', location: 'Page 4' }],
    };
    const mismatches = computeAgentDataValueMismatches(values, structure);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.values.map((value) => value.normalizedValue).sort()).toEqual(['0', '36.15']);
  });

  it('seed merge corrects a model row of the same fact to the table row subject, and fills in its scope', () => {
    const structure = {
      agreements: [],
      definitions: [{ short: '杭州景祺', full: '杭州景祺电子信息合伙企业（有限合伙）', file: 'buyer1_report.txt', location: 'Page 4' }],
    };
    const merged = applyAgentDataValueSeeds(
      [{ entity: '杭州景祺', attribute: '比率・持分', value: '0%', file: 'buyer1_report.txt', location: 'Page 8' }],
      [{ entity: '杭州景祺电子信息合伙企业（有限合伙）', attribute: '比率・持分', value: '0%', file: 'buyer1_report.txt', location: 'チャンク 6・行 26', scope: '交易前' }],
      structure,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.entity).toBe('杭州景祺电子信息合伙企业（有限合伙）');
    expect(merged[0]?.scope).toBe('交易前');
  });

  it('seed merge never overwrites one holder with another holding the same value', () => {
    const merged = applyAgentDataValueSeeds(
      [{ entity: '杭州景祺电子信息合伙企业（有限合伙）', attribute: '資金源泉', value: '自有资金', file: 'announcement.txt', location: 'チャンク 1・行 57' }],
      [{ entity: '厦门联芯美企业管理合伙企业（有限合伙）', attribute: '資金源泉', value: '自有资金', file: 'announcement.txt', location: 'チャンク 1・行 93' }],
      { agreements: [], definitions: [] },
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((value) => value.entity).sort()).toEqual([
      '厦门联芯美企业管理合伙企业（有限合伙）',
      '杭州景祺电子信息合伙企业（有限合伙）',
    ]);
  });

  it('offline analyzer run: with the model returning nothing, the seeds alone raise the three real pairs', async () => {
    const files = [
      { name: 'announcement.txt', text: ANNOUNCEMENT_EXCERPT },
      { name: 'buyer1_report.txt', text: BUYER1_FUNDING },
      {
        name: 'buyer2_report.txt',
        text: [
          '乙方（受让方）：厦门联芯美企业管理合伙企业（有限合伙）',
          '股份转让中，乙方应当向甲方支付的股份转让价款总额为人民币146,660,332.00',
        ].join('\n'),
      },
    ];
    const { store, setDigest } = await storeWithFiles(files);
    const view = buildAgentAttachmentDataView(files);
    expect(view.totalChunks).toBe(3);
    const emptyExecutor: AgentModelExecutor = async () => ({
      ok: true,
      text: JSON.stringify({ findings: [], values: [], structure: { agreements: [], definitions: [] } }),
    });
    const analyzerParams = (offset: number, count: number, content?: string) => ({
      attachmentSetId: SET_ID,
      setDigest,
      instruction: '文書の不整合を監査してください',
      outputKind: 'findings',
      chunkOffset: offset,
      chunkCount: count,
      auditMode: true,
      ...(content ? { content } : {}),
    });
    const step1 = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(0, 2),
      contextFor(store, emptyExecutor),
    );
    expect(step1.ok).toBe(true);
    const step2 = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(2, 1, step1.artifact),
      contextFor(store, emptyExecutor),
    );
    expect(step2.ok).toBe(true);
    const bundle = JSON.parse(step2.artifact ?? '{}') as {
      candidates: { entity: string; attribute: string; values: { normalizedValue: string }[] }[];
    };
    const pair = (a: string, b: string): boolean => bundle.candidates.some((candidate) => {
      const normalized = candidate.values.map((value) => value.normalizedValue);
      return normalized.includes(a) && normalized.includes(b);
    });
    expect(pair('146660323', '146660332')).toBe(true);
    expect(pair('45', '40')).toBe(true);
    expect(bundle.candidates.some((candidate) => {
      const normalized = candidate.values.map((value) => value.normalizedValue);
      return normalized.includes('funding:self') && normalized.includes('funding:bank');
    })).toBe(true);
    expect(bundle.candidates.some((candidate) => {
      const normalized = candidate.values.map((value) => value.normalizedValue);
      return normalized.includes('0') && normalized.includes('36.15');
    })).toBe(false);
  });
});
const PROD_BUNDLE_8C49293C_JSON = "{\"kind\":\"data-analysis\",\"outputKind\":\"findings\",\"findings\":[{\"claim\":\"Inconsistent total consideration amounts for identical share transfers\",\"evidence\":\"转让价格（元/股）13.00\\n协议转让对价146,660,332.00\\n\\n转让价格（元/股）13.00\\n协议转让对价\\n价款支付方146,660,323.00\",\"file\":\"announcement.txt\",\"location\":\"Page 2\",\"explanation\":\"The same quantity of shares (11,281,564) at the same price (13.00) should yield the same total consideration, but the amounts differ by 9.00.\",\"evidenceB\":\"价款支付方146,660,323.00\",\"fileB\":\"announcement.txt\",\"locationB\":\"Page 2\"},{\"claim\":\"Contradiction between '受让方性质' and '其他组织或机构' fields\",\"evidence\":\"受让方性质 私募基金\",\"file\":\"announcement.txt\",\"location\":\"Page 5\",\"explanation\":\"The entity is classified as a private equity fund but also marked as 'other organization or institution', which may conflict with classification.\",\"evidenceB\":\"其他组织或机构√是\",\"fileB\":\"announcement.txt\",\"locationB\":\"Page 5\"},{\"claim\":\"Transferor entity name inconsistency\",\"evidence\":\"2026 年1 月13 日，物美集团与厦门联芯美签订了《股份转让协议》\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\",\"explanation\":\"The transferor is referred to as 物美集团 in the transaction summary but as 物美科技集团有限公司 in the agreement.\",\"evidenceB\":\"甲方（转让方）：物美科技集团有限公司\",\"fileB\":\"buyer2_report.txt\",\"locationB\":\"Page 8\"},{\"claim\":\"Recipient entity name inconsistency\",\"evidence\":\"物美集团与厦门联芯美签订了《股份转让协议》\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\",\"explanation\":\"The recipient is referred to as 厦门联芯美 in the transaction summary but as 厦门联芯美企业管理合伙企业（有限合伙） in the agreement.\",\"evidenceB\":\"乙方（受让方）：厦门联芯美企业管理合伙企业（有限合伙）\",\"fileB\":\"buyer2_report.txt\",\"locationB\":\"Page 8\"},{\"claim\":\"物美集团 reported share reduction inconsistent with transfer amount\",\"evidence\":\"物美集团 81,570,343 36.15% 59,007,215 26.15%\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\",\"explanation\":\"The table shows 物美集团’s shares reduced from 81,570,343 to 59,007,215, implying a transfer of 22,563,128 shares, but the agreement states only 11,281,564 shares were transferred.\",\"evidenceB\":\"杭州景祺以现金人民币146,660,332.00 元受让物美集团持有的新华百货无限售流通股11,281,564 股股份（占上市公司股份总数的5%）\",\"fileB\":\"seller_report.txt\",\"locationB\":\"Page 12\"},{\"claim\":\"Approval requirement vs. approval obtained mismatch\",\"evidence\":\"本次权益变动是否需取得批准 是 ☑ 否 □\",\"file\":\"seller_report.txt\",\"location\":\"Page 29\",\"explanation\":\"The report indicates that the transaction requires regulatory approval, but the subsequent page states that such approval has not been obtained, creating a contradictory statement.\",\"evidenceB\":\"是否已得到批准 是 □ 否 ☑\",\"fileB\":\"seller_report.txt\",\"locationB\":\"Page 30\"}],\"values\":[{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"Transfer price per share\",\"value\":\"13.00\",\"normalizedValue\":\"13.00\",\"file\":\"announcement.txt\",\"location\":\"Page 2\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"Total consideration\",\"value\":\"146,660,332.00\",\"normalizedValue\":\"146660332\",\"file\":\"announcement.txt\",\"location\":\"Page 2\"},{\"entity\":\"厦门联芯美企业管理合伙企业\",\"attribute\":\"Total consideration\",\"value\":\"146,660,323.00\",\"normalizedValue\":\"146660323\",\"file\":\"announcement.txt\",\"location\":\"Page 2\"},{\"entity\":\"杭州景祺电子信息合伙企业(有限合伙)\",\"attribute\":\"株数\",\"value\":\"11,281,564\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 44\"},{\"entity\":\"杭州景祺电子信息合伙企业(有限合伙)\",\"attribute\":\"比率・持分\",\"value\":\"5.00\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 46\"},{\"entity\":\"杭州景祺电子信息合伙企业(有限合伙)\",\"attribute\":\"金額\",\"value\":\"146,660,332.00\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 50\"},{\"entity\":\"杭州景祺电子信息合伙企业(有限合伙)\",\"attribute\":\"資金源泉\",\"value\":\"自有资金\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 57\"},{\"entity\":\"厦门联芯美企业管理合伙企业(有限合伙)\",\"attribute\":\"株数\",\"value\":\"11,281,564\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 75\"},{\"entity\":\"厦门联芯美企业管理合伙企业(有限合伙)\",\"attribute\":\"比率・持分\",\"value\":\"5.00\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 77\"},{\"entity\":\"厦门联芯美企业管理合伙企业(有限合伙)\",\"attribute\":\"金額\",\"value\":\"146,660,323.00\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 82\"},{\"entity\":\"厦门联芯美企业管理合伙企业(有限合伙)\",\"attribute\":\"資金源泉\",\"value\":\"自有资金\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 93\"},{\"entity\":\"北京京西硅谷科技有限公司\",\"attribute\":\"比率・持分\",\"value\":\"77.612%\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 195\"},{\"entity\":\"北京中胜华特科技有限公司\",\"attribute\":\"比率・持分\",\"value\":\"19.403%\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 196\"},{\"entity\":\"北京慕弘管理咨询有限公司\",\"attribute\":\"比率・持分\",\"value\":\"2.985%\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 197\"},{\"entity\":\"聚源盛业投资(宁波)有限公司\",\"attribute\":\"比率・持分\",\"value\":\"45%\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 235\"},{\"entity\":\"宁波芯空间盛芯创业投资合伙企业(有限合伙)\",\"attribute\":\"比率・持分\",\"value\":\"33.33333%\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 237\"},{\"entity\":\"上海芯齐投资中心(有限合伙)\",\"attribute\":\"比率・持分\",\"value\":\"26.66667%\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 238\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"受让方性质\",\"value\":\"私募基金\",\"normalizedValue\":\"Private Equity Fund\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"其他组织或机构\",\"value\":\"是\",\"normalizedValue\":\"Yes\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"企业类型\",\"value\":\"有限合伙企业\",\"normalizedValue\":\"Limited Partnership\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"统一社会信用代码\",\"value\":\"91350200MAK68L5M1J\",\"normalizedValue\":\"91350200MAK68L5M1J\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"注册资本/出资额\",\"value\":\"20000 万元\",\"normalizedValue\":\"200,000,000 RMB\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"实缴资本\",\"value\":\"20000 万元\",\"normalizedValue\":\"200,000,000 RMB\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"成立日期\",\"value\":\"2026/01/09\",\"normalizedValue\":\"2026-01-09\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"主要股东\",\"value\":\"厦门市中亿资产管理有限公司持有74%合伙份额；厦门市联和股权投资基金管理有限公司持有25%合伙份额；厦门联芯盛投资合伙企业（有限合伙）持有1%合伙份额。\",\"normalizedValue\":\"厦门市中亿资产管理有限公司:74%;厦门市联和股权投资基金管理有限公司:25%;厦门联芯盛投资合伙企业（有限合伙）:1%\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门市中亿资产管理有限公司\",\"attribute\":\"比率・持分\",\"value\":\"74%\",\"file\":\"announcement.txt\",\"location\":\"チャンク 2・行 42\"},{\"entity\":\"厦门市联和股权投资基金管理有限公司\",\"attribute\":\"比率・持分\",\"value\":\"25%\",\"file\":\"announcement.txt\",\"location\":\"チャンク 2・行 43\"},{\"entity\":\"厦门联芯盛投资合伙企业(有限合伙)\",\"attribute\":\"比率・持分\",\"value\":\"1%\",\"file\":\"announcement.txt\",\"location\":\"チャンク 2・行 45\"},{\"entity\":\"厦门联芯美企业管理合伙企业(有限合伙)\",\"attribute\":\"金額\",\"value\":\"146,660,332.00\",\"file\":\"announcement.txt\",\"location\":\"チャンク 3・行 43\"},{\"entity\":\"聚源盛业投资(宁波)有限公司\",\"attribute\":\"比率・持分\",\"value\":\"40%\",\"file\":\"buyer1_report.txt\",\"location\":\"チャンク 5・行 119\"},{\"entity\":\"宁波芯空间盛芯创业投资合伙企业(有限合伙)\",\"attribute\":\"比率・持分\",\"value\":\"33.33333%\",\"file\":\"buyer1_report.txt\",\"location\":\"チャンク 5・行 120\"},{\"entity\":\"上海芯齐投资中心(有限合伙)\",\"attribute\":\"比率・持分\",\"value\":\"26.66667%\",\"file\":\"buyer1_report.txt\",\"location\":\"チャンク 5・行 122\"},{\"entity\":\"杭州景祺\",\"attribute\":\"株数\",\"value\":\"0\",\"file\":\"buyer1_report.txt\",\"location\":\"チャンク 6・行 26\",\"scope\":\"交易前\"},{\"entity\":\"杭州景祺\",\"attribute\":\"比率・持分\",\"value\":\"0%\",\"file\":\"buyer1_report.txt\",\"location\":\"チャンク 6・行 26\",\"scope\":\"交易前\"},{\"entity\":\"杭州景祺\",\"attribute\":\"株数\",\"value\":\"11,281,564\",\"file\":\"buyer1_report.txt\",\"location\":\"チャンク 6・行 26\",\"scope\":\"交易后\"},{\"entity\":\"杭州景祺\",\"attribute\":\"比率・持分\",\"value\":\"5%\",\"file\":\"buyer1_report.txt\",\"location\":\"チャンク 6・行 26\",\"scope\":\"交易后\"},{\"entity\":\"杭州景祺电子信息合伙企业(有限合伙)\",\"attribute\":\"金額\",\"value\":\"146,660,332.00\",\"file\":\"buyer1_report.txt\",\"location\":\"チャンク 6・行 53\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"持股数量\",\"value\":\"11,281,564\",\"normalizedValue\":\"11281564\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"持股比例\",\"value\":\"5%\",\"normalizedValue\":\"5%\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"杭州景祺电子信息合伙企业(有限合伙)\",\"attribute\":\"资金来源\",\"value\":\"信息披露义务人向银行的借款\",\"normalizedValue\":\"Bank Loan\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 12\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否已充足披露资金来源\",\"value\":\"是\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否需取得批准\",\"value\":\"是\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 20\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否已取得批准\",\"value\":\"否\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 20\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否为上市公司第一大股东\",\"value\":\"是\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否为上市公司实际控制人\",\"value\":\"是\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"银川新华百货商业集团股份有限公司\",\"attribute\":\"股票代码\",\"value\":\"600785\",\"normalizedValue\":\"600785\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"银川新华百货商业集团股份有限公司\",\"attribute\":\"股票简称\",\"value\":\"新华百货\",\"normalizedValue\":\"新华百货\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"银川新华百货商业集团股份有限公司\",\"attribute\":\"上市公司所在地\",\"value\":\"宁夏回族自治区银川市\",\"normalizedValue\":\"宁夏回族自治区银川市\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"注册地\",\"value\":\"浙江省杭州市拱墅区上塘街道云顺弄255号1幢503室\",\"normalizedValue\":\"浙江省杭州市拱墅区上塘街道云顺弄255号1幢503室\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"厦门市中亿资产管理有限公司\",\"attribute\":\"比率・持分\",\"value\":\"74%\",\"file\":\"buyer2_report.txt\",\"location\":\"チャンク 8・行 118\"},{\"entity\":\"厦门市联和股权投资基金管理有限公司\",\"attribute\":\"比率・持分\",\"value\":\"25%\",\"file\":\"buyer2_report.txt\",\"location\":\"チャンク 8・行 119\"},{\"entity\":\"厦门联芯盛投资合伙企业(有限合伙)\",\"attribute\":\"比率・持分\",\"value\":\"1%\",\"file\":\"buyer2_report.txt\",\"location\":\"チャンク 8・行 120\"},{\"entity\":\"物美集团\",\"attribute\":\"transferor entity name\",\"value\":\"物美集团\",\"normalizedValue\":\"物美集团\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"transferor entity name\",\"value\":\"物美科技集团有限公司\",\"normalizedValue\":\"物美科技集团有限公司\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 8\"},{\"entity\":\"厦门联芯美\",\"attribute\":\"recipient entity name\",\"value\":\"厦门联芯美\",\"normalizedValue\":\"厦门联芯美\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"recipient entity name\",\"value\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"normalizedValue\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 8\"},{\"entity\":\"物美集团\",\"attribute\":\"shares transferred\",\"value\":\"11,281,564\",\"normalizedValue\":\"11281564\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"物美集团\",\"attribute\":\"percentage of total shares\",\"value\":\"5%\",\"normalizedValue\":\"5\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"物美集团\",\"attribute\":\"price per share\",\"value\":\"13.00\",\"normalizedValue\":\"13.00\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 8\"},{\"entity\":\"物美集团\",\"attribute\":\"total transfer price\",\"value\":\"146,660,332.00\",\"normalizedValue\":\"146660332\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 8\"},{\"entity\":\"2026-01-13\",\"attribute\":\"transaction date\",\"value\":\"2026 年1 月13 日\",\"normalizedValue\":\"2026-01-13\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"厦门联芯美\",\"attribute\":\"株数\",\"value\":\"0\",\"file\":\"buyer2_report.txt\",\"location\":\"チャンク 9・行 26\",\"scope\":\"交易前\"},{\"entity\":\"厦门联芯美\",\"attribute\":\"比率・持分\",\"value\":\"0%\",\"file\":\"buyer2_report.txt\",\"location\":\"チャンク 9・行 26\",\"scope\":\"交易前\"},{\"entity\":\"厦门联芯美\",\"attribute\":\"株数\",\"value\":\"11,281,564\",\"file\":\"buyer2_report.txt\",\"location\":\"チャンク 9・行 26\",\"scope\":\"交易后\"},{\"entity\":\"厦门联芯美\",\"attribute\":\"比率・持分\",\"value\":\"5%\",\"file\":\"buyer2_report.txt\",\"location\":\"チャンク 9・行 26\",\"scope\":\"交易后\"},{\"entity\":\"厦门联芯美企业管理合伙企业(有限合伙)\",\"attribute\":\"金額\",\"value\":\"146,660,332.00\",\"file\":\"buyer2_report.txt\",\"location\":\"チャンク 9・行 53\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"持股数量\",\"value\":\"11,281,564\",\"normalizedValue\":\"11281564\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"持股比例\",\"value\":\"5%\",\"normalizedValue\":\"5\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"厦门联芯美企业管理合伙企业(有限合伙)\",\"attribute\":\"资金来源\",\"value\":\"自有资金\",\"normalizedValue\":\"自有资金\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 11\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否为第一大股东\",\"value\":\"是\",\"normalizedValue\":\"是\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 17\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否为实际控制人\",\"value\":\"是\",\"normalizedValue\":\"是\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 17\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否已充分披露资金来源\",\"value\":\"是\",\"normalizedValue\":\"是\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否拟于未来12个月内继续增持\",\"value\":\"否\",\"normalizedValue\":\"否\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否已得到批准\",\"value\":\"否\",\"normalizedValue\":\"否\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"注册资本\",\"value\":\"80,000 万元\",\"normalizedValue\":\"800000000\",\"file\":\"seller_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"北京京西硅谷科技有限公司\",\"attribute\":\"持股比例\",\"value\":\"77.612%\",\"normalizedValue\":\"77.612\",\"file\":\"seller_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"北京中胜华特科技有限公司\",\"attribute\":\"持股比例\",\"value\":\"19.403%\",\"normalizedValue\":\"19.403\",\"file\":\"seller_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"北京慕弘管理咨询有限公司\",\"attribute\":\"持股比例\",\"value\":\"2.985%\",\"normalizedValue\":\"2.985\",\"file\":\"seller_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"物美津投（天津）商业管理有限公司\",\"attribute\":\"注册资本\",\"value\":\"100 万元\",\"normalizedValue\":\"1000000\",\"file\":\"seller_report.txt\",\"location\":\"Page 6\"},{\"entity\":\"物美津投（天津）商业管理有限公司\",\"attribute\":\"主要股东\",\"value\":\"物美科技集团有限公司持股100%\",\"normalizedValue\":\"100\",\"file\":\"seller_report.txt\",\"location\":\"Page 6\"},{\"entity\":\"北京绿色安全农产品物流信息中心有限公司\",\"attribute\":\"注册资本\",\"value\":\"400 万元\",\"normalizedValue\":\"4000000\",\"file\":\"seller_report.txt\",\"location\":\"Page 6\"},{\"entity\":\"北京绿色安全农产品物流信息中心有限公司\",\"attribute\":\"主要股东\",\"value\":\"物美科技集团有限公司持股100%\",\"normalizedValue\":\"100\",\"file\":\"seller_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"天津滨海新区物美津融商贸有限公司\",\"attribute\":\"持股比例\",\"value\":\"26.35%\",\"normalizedValue\":\"26.35\",\"file\":\"seller_report.txt\",\"location\":\"Page 9\"},{\"entity\":\"上海京遥贸易有限公司\",\"attribute\":\"持股比例\",\"value\":\"11.72%\",\"normalizedValue\":\"11.72\",\"file\":\"seller_report.txt\",\"location\":\"Page 9\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"比率・持分\",\"value\":\"100%\",\"file\":\"seller_report.txt\",\"location\":\"チャンク 12・行 72\"},{\"entity\":\"物美集团\",\"attribute\":\"持股数量\",\"value\":\"81,570,343\",\"normalizedValue\":\"81,570,343\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\"},{\"entity\":\"物美集团\",\"attribute\":\"持股比例\",\"value\":\"36.15%\",\"normalizedValue\":\"36.15%\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\",\"scope\":\"交易前\"},{\"entity\":\"物美集团\",\"attribute\":\"持股数量\",\"value\":\"59,007,215\",\"normalizedValue\":\"59,007,215\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\"},{\"entity\":\"物美集团\",\"attribute\":\"持股比例\",\"value\":\"26.15%\",\"normalizedValue\":\"26.15%\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\",\"scope\":\"交易后\"},{\"entity\":\"杭州景祺\",\"attribute\":\"持股数量\",\"value\":\"11,281,564\",\"normalizedValue\":\"11,281,564\",\"file\":\"seller_report.txt\",\"location\":\"Page 12\"},{\"entity\":\"杭州景祺\",\"attribute\":\"持股比例\",\"value\":\"5%\",\"normalizedValue\":\"5%\",\"file\":\"seller_report.txt\",\"location\":\"Page 12\"},{\"entity\":\"物美集团\",\"attribute\":\"株数\",\"value\":\"81,570,343\",\"file\":\"seller_report.txt\",\"location\":\"チャンク 13・行 28\",\"scope\":\"交易前\"},{\"entity\":\"物美集团\",\"attribute\":\"株数\",\"value\":\"59,007,215\",\"file\":\"seller_report.txt\",\"location\":\"チャンク 13・行 28\",\"scope\":\"交易后\"},{\"entity\":\"物美津投\",\"attribute\":\"株数\",\"value\":\"8,922,900\",\"file\":\"seller_report.txt\",\"location\":\"チャンク 13・行 33\",\"scope\":\"交易前\"},{\"entity\":\"物美津投\",\"attribute\":\"比率・持分\",\"value\":\"3.95%\",\"file\":\"seller_report.txt\",\"location\":\"チャンク 13・行 33\",\"scope\":\"交易前\"},{\"entity\":\"北京绿农\",\"attribute\":\"株数\",\"value\":\"4,545,951\",\"file\":\"seller_report.txt\",\"location\":\"チャンク 13・行 38\",\"scope\":\"交易前\"},{\"entity\":\"北京绿农\",\"attribute\":\"比率・持分\",\"value\":\"2.01%\",\"file\":\"seller_report.txt\",\"location\":\"チャンク 13・行 38\",\"scope\":\"交易前\"},{\"entity\":\"杭州景祺电子信息合伙企业(有限合伙)\",\"attribute\":\"金額\",\"value\":\"146,660,332.00\",\"file\":\"seller_report.txt\",\"location\":\"チャンク 13・行 69\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"shareCount\",\"value\":\"11,281,564 股\",\"normalizedValue\":\"11281564\",\"file\":\"seller_report.txt\",\"location\":\"Page 15-16\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"percentage\",\"value\":\"5%\",\"normalizedValue\":\"0.05\",\"file\":\"seller_report.txt\",\"location\":\"Page 15-16\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"pricePerShare\",\"value\":\"13.00 元/股\",\"normalizedValue\":\"13.00\",\"file\":\"seller_report.txt\",\"location\":\"Page 16\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"totalPrice\",\"value\":\"146,660,332.00 元\",\"normalizedValue\":\"146660332.00\",\"file\":\"seller_report.txt\",\"location\":\"Page 16\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"firstPayment\",\"value\":\"73,330,166.00 元\",\"normalizedValue\":\"73330166.00\",\"file\":\"seller_report.txt\",\"location\":\"Page 16-17\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"secondPayment\",\"value\":\"73,330,166.00 元\",\"normalizedValue\":\"73330166.00\",\"file\":\"seller_report.txt\",\"location\":\"Page 17\"},{\"entity\":\"厦门联芯美企业管理合伙企业(有限合伙)\",\"attribute\":\"金額\",\"value\":\"146,660,332.00\",\"file\":\"seller_report.txt\",\"location\":\"チャンク 14・行 43\"},{\"entity\":\"物美集团\",\"attribute\":\"持股数量\",\"value\":\"81,570,343 股\",\"normalizedValue\":\"81570343\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"物美集团\",\"attribute\":\"持股比例\",\"value\":\"36.15%\",\"normalizedValue\":\"0.3615\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"物美津投\",\"attribute\":\"持股数量\",\"value\":\"8,922,900 股\",\"normalizedValue\":\"8922900\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"物美津投\",\"attribute\":\"持股比例\",\"value\":\"3.95%\",\"normalizedValue\":\"0.0395\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"北京绿农\",\"attribute\":\"持股数量\",\"value\":\"4,545,951 股\",\"normalizedValue\":\"4545951\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"北京绿农\",\"attribute\":\"持股比例\",\"value\":\"2.01%\",\"normalizedValue\":\"0.0201\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"情報披露義務人\",\"attribute\":\"持股数量\",\"value\":\"95,039,194 股\",\"normalizedValue\":\"95039194\",\"file\":\"seller_report.txt\",\"location\":\"Page 28\"},{\"entity\":\"情報披露義務人\",\"attribute\":\"持股比例\",\"value\":\"42.12%\",\"normalizedValue\":\"0.4212\",\"file\":\"seller_report.txt\",\"location\":\"Page 28\"},{\"entity\":\"银川新华百货商业集团股份有限公司\",\"attribute\":\"是否需批准\",\"value\":\"是\",\"normalizedValue\":\"Yes\",\"file\":\"seller_report.txt\",\"location\":\"Page 29\"},{\"entity\":\"银川新华百货商业集团股份有限公司\",\"attribute\":\"是否已得到批准\",\"value\":\"否\",\"normalizedValue\":\"No\",\"file\":\"seller_report.txt\",\"location\":\"Page 30\"}],\"structure\":{\"agreements\":[{\"name\":\"股权转让协议\",\"parties\":[{\"name\":\"物美科技集团有限公司\",\"role\":\"Transferor\"},{\"name\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"role\":\"Transferee\"},{\"name\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"role\":\"Transferee\"}]},{\"name\":\"股份转让协议\",\"parties\":[{\"name\":\"物美集团\",\"role\":\"卖方\"},{\"name\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"role\":\"买方\"},{\"name\":\"物美科技集团有限公司\",\"role\":\"transferor\"},{\"name\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"role\":\"recipient\"},{\"name\":\"物美科技集团有限公司\",\"role\":\"甲方（转让方)\"},{\"name\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"role\":\"乙方（受让方)\"},{\"name\":\"厦门联芯美\",\"role\":\"乙方（受让方)\"},{\"name\":\"物美科技集团有限公司\",\"role\":\"甲方（转让方）\"},{\"name\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"role\":\"乙方（受让方）\"}]}],\"definitions\":[{\"short\":\"物美集团\",\"full\":\"物美科技集团有限公司\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 4\"},{\"short\":\"本次权益变动\",\"full\":\"物美集团将其持有的11,281,564 股A 股股票（占上市公司总股本的5%）协议转让给杭州景祺，杭州景祺对上市公司持股比例由0%增加至5%的事项\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 4\"},{\"short\":\"股份转让协议\",\"full\":\"物美集团与杭州景祺签署的《股份转让协议》\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 4\"},{\"short\":\"股份转让协议\",\"full\":\"股份转让协议\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 8\"}]},\"candidates\":[{\"entity\":\"杭州景祺电子信息合伙企业(有限合伙)\",\"attribute\":\"資金源泉\",\"values\":[{\"value\":\"自有资金\",\"normalizedValue\":\"funding:self\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 57\"},{\"value\":\"信息披露义务人向银行的借款\",\"normalizedValue\":\"funding:bank\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 12\"}]},{\"entity\":\"厦门联芯美企业管理合伙企业(有限合伙)\",\"attribute\":\"金額\",\"values\":[{\"value\":\"146,660,323.00\",\"normalizedValue\":\"146660323\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 82\"},{\"value\":\"146,660,332.00\",\"normalizedValue\":\"146660332\",\"file\":\"announcement.txt\",\"location\":\"チャンク 3・行 43\"}]},{\"entity\":\"聚源盛业投资(宁波)有限公司\",\"attribute\":\"比率・持分\",\"values\":[{\"value\":\"45%\",\"normalizedValue\":\"45\",\"file\":\"announcement.txt\",\"location\":\"チャンク 1・行 235\"},{\"value\":\"40%\",\"normalizedValue\":\"40\",\"file\":\"buyer1_report.txt\",\"location\":\"チャンク 5・行 119\"}]}],\"coverage\":{\"totalChunks\":17,\"processedChunks\":17},\"chunkRange\":{\"offset\":16,\"count\":1},\"content\":\"prior rendering\"}";
const PROD_BUNDLE_7185BC05_JSON = "{\"kind\":\"data-analysis\",\"outputKind\":\"findings\",\"findings\":[{\"claim\":\"Inconsistent identification of the share transfer recipient\",\"evidence\":\"受让方2 名称\\n厦门联芯美企业管理合伙企业（有限合伙）\",\"file\":\"announcement.txt\",\"location\":\"Page 5\",\"explanation\":\"The same transaction lists two different entities as the buyer – one on page 5 and another on page 6 – which cannot both be the sole assignee, indicating a material inconsistency.\",\"evidenceB\":\"乙方（受让方）：杭州景祺电子信息合伙企业（有限合伙）\",\"fileB\":\"announcement.txt\",\"locationB\":\"Page 6\"},{\"claim\":\"Information disclosure obligor claims to be the largest shareholder, but holds only 5% of shares\",\"evidence\":\"信息披露义务人是否为上市公司第一大股东 是\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\",\"explanation\":\"The claim that the obligor is the largest shareholder contradicts the reported shareholding of only 5%\",\"evidenceB\":\"持股比例：5%\",\"fileB\":\"buyer1_report.txt\",\"locationB\":\"Page 19\"},{\"claim\":\"Information disclosure obligor claims to be the actual controller, but holds only 5% of shares\",\"evidence\":\"信息披露义务人是否为上市公司实际控制人 是\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\",\"explanation\":\"The claim that the obligor is the actual controller contradicts the reported shareholding of only 5%\",\"evidenceB\":\"持股比例：5%\",\"fileB\":\"buyer1_report.txt\",\"locationB\":\"Page 19\"},{\"claim\":\"Entity name inconsistency for the transferor\",\"evidence\":\"物美集团与厦门联芯美签订了《股份转让协议》\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\",\"explanation\":\"The transferor is referred to as 物美集团 in the introductory paragraph, but later identified as 物美科技集团有限公司 in the agreement section, indicating a discrepancy in the entity name used for the same party.\",\"evidenceB\":\"甲方（转让方）：物美科技集团有限公司\",\"fileB\":\"buyer2_report.txt\",\"locationB\":\"Page 8\"},{\"claim\":\"Mismatch between reporting entity and disclosed company name\",\"evidence\":\"银川新华百货商业集团股份有限公司简式权益变动报告书\",\"file\":\"seller_report.txt\",\"location\":\"Page 5\",\"explanation\":\"The report is titled as belonging to 银川新华百货商业集团股份有限公司, but the disclosed information lists the information disclosure obligor as 物美科技集团有限公司, indicating a material inconsistency in the identity of the reporting entity.\",\"evidenceB\":\"公司名称\\n物美科技集团有限公司\",\"fileB\":\"seller_report.txt\",\"locationB\":\"Page 5\"},{\"claim\":\"Share count mismatch between agreement and reported holdings\",\"evidence\":\"杭州景祺以现金人民币146,660,332.00 元受让物美集团持有的新华百货无限售流通股11,281,564 股股份（占上市公司股份总数的5%）。\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\",\"explanation\":\"The agreement states 11,281,564 shares were transferred, but the change in holdings indicates 22,563,128 shares were transferred.\",\"evidenceB\":\"持股数量（股） 81,570,343 59,007,215 22,563,128\",\"fileB\":\"seller_report.txt\",\"locationB\":\"Page 11\"},{\"claim\":\"Approval requirement vs approval status conflict\",\"evidence\":\"本次权益变动是否需取得批准 是 ☑ ...\",\"file\":\"seller_report.txt\",\"location\":\"Page 29-30\",\"explanation\":\"The report states that the transaction requires approval, but also indicates that approval has not been obtained.\",\"evidenceB\":\"是否已得到批准 是 □ 否 ☑\"}],\"values\":[{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"受让方名称\",\"value\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"normalizedValue\":\"厦门联芯美企业管理合伙企业有限合伙\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"受让方名称\",\"value\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"normalizedValue\":\"杭州景祺电子信息合伙企业有限合伙\",\"file\":\"announcement.txt\",\"location\":\"Page 6\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"受让方性质\",\"value\":\"其他组织或机构\",\"normalizedValue\":\"Other organization\",\"file\":\"announcement.txt\",\"location\":\"Page 5\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"不减持期限\",\"value\":\"12 个月\",\"normalizedValue\":\"12 months\",\"file\":\"announcement.txt\",\"location\":\"Page 15\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"不减持期限\",\"value\":\"12 个月\",\"normalizedValue\":\"12 months\",\"file\":\"announcement.txt\",\"location\":\"Page 15\"},{\"entity\":\"银川新华百货商业集团股份有限公司\",\"attribute\":\"公告日期\",\"value\":\"2026年1月13日\",\"normalizedValue\":\"2026-01-13\",\"file\":\"announcement.txt\",\"location\":\"Page 16\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"持股数量\",\"value\":\"11,281,564 股\",\"normalizedValue\":\"11281564\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 8\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"持股比例\",\"value\":\"5%\",\"normalizedValue\":\"0.05\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 8\"},{\"entity\":\"股份转让\",\"attribute\":\"单价\",\"value\":\"13.00 元/股\",\"normalizedValue\":\"13.00\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 9\"},{\"entity\":\"股份转让\",\"attribute\":\"总价\",\"value\":\"146,660,332.00 元\",\"normalizedValue\":\"146660332\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 9\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"首期付款\",\"value\":\"73,330,166.00 元\",\"normalizedValue\":\"73330166\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 9\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"二期付款\",\"value\":\"73,330,166.00 元\",\"normalizedValue\":\"73330166\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 10\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"持股比例\",\"value\":\"5%\",\"normalizedValue\":\"5%\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"持股数量\",\"value\":\"11,281,564\",\"normalizedValue\":\"11281564\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否为上市公司第一大股东\",\"value\":\"是\",\"normalizedValue\":\"true\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否为上市公司实际控制人\",\"value\":\"是\",\"normalizedValue\":\"true\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"资金来源\",\"value\":\"银行借款\",\"normalizedValue\":\"bank loan\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否已充足披露资金来源\",\"value\":\"是\",\"normalizedValue\":\"true\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否在未来12个月内继续增持\",\"value\":\"否\",\"normalizedValue\":\"false\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否在二级市场买卖该上市公司股票\",\"value\":\"否\",\"normalizedValue\":\"false\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 20\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否需取得批准\",\"value\":\"是\",\"normalizedValue\":\"true\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 20\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"是否已得到批准\",\"value\":\"否\",\"normalizedValue\":\"false\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 20\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"出资额\",\"value\":\"20,000 万元\",\"normalizedValue\":\"2000000000元\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"持股比例（交易后）\",\"value\":\"5%\",\"normalizedValue\":\"0.05\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 4\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"持股比例（交易前）\",\"value\":\"0%\",\"normalizedValue\":\"0\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 4\"},{\"entity\":\"物美集团\",\"attribute\":\"转让股份数量\",\"value\":\"11,281,564 股\",\"normalizedValue\":\"11281564\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 4\"},{\"entity\":\"物美集团\",\"attribute\":\"持股比例（占总股本）\",\"value\":\"5%\",\"normalizedValue\":\"0.05\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 4\"},{\"entity\":\"厦门市中亿资产管理有限公司\",\"attribute\":\"合伙份额\",\"value\":\"74%\",\"normalizedValue\":\"0.74\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门市联和股权投资基金管理有限公司\",\"attribute\":\"合伙份额\",\"value\":\"25%\",\"normalizedValue\":\"0.25\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯盛投资合伙企业（有限合伙）\",\"attribute\":\"合伙份额\",\"value\":\"1%\",\"normalizedValue\":\"0.01\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"信息披露义务人\",\"value\":\"是\",\"normalizedValue\":\"true\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 1\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"签署日期\",\"value\":\"2026 年1 月13 日\",\"normalizedValue\":\"2026-01-13\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 1\"},{\"entity\":\"物美集团\",\"attribute\":\"持股数量\",\"value\":\"0\",\"normalizedValue\":\"0\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"物美集团\",\"attribute\":\"持股比例\",\"value\":\"0%\",\"normalizedValue\":\"0%\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"厦门联芯美\",\"attribute\":\"持股数量\",\"value\":\"11,281,564\",\"normalizedValue\":\"11281564\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"厦门联芯美\",\"attribute\":\"持股比例\",\"value\":\"5%\",\"normalizedValue\":\"5%\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"entity\":\"股份转让协议\",\"attribute\":\"转让价格/股\",\"value\":\"13.00 元/股\",\"normalizedValue\":\"13.00\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 8\"},{\"entity\":\"股份转让协议\",\"attribute\":\"总价款\",\"value\":\"146,660,332.00 元\",\"normalizedValue\":\"146660332\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 8\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"资金来源\",\"value\":\"自有资金\",\"normalizedValue\":\"自有资金\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 11\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"持股数量\",\"value\":\"11,281,564\",\"normalizedValue\":\"11281564\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"持股比例\",\"value\":\"5%\",\"normalizedValue\":\"5%\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否为第一大股东\",\"value\":\"是\",\"normalizedValue\":\"yes\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 17\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否为实际控制人\",\"value\":\"是\",\"normalizedValue\":\"yes\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 17\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否已充分披露资金来源\",\"value\":\"是\",\"normalizedValue\":\"yes\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否拟于未来12个月内继续增持\",\"value\":\"否\",\"normalizedValue\":\"no\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 18\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否在过去6个月买卖股票\",\"value\":\"否\",\"normalizedValue\":\"no\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否需取得批准\",\"value\":\"是\",\"normalizedValue\":\"yes\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"是否已得到批准\",\"value\":\"否\",\"normalizedValue\":\"no\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"签署日期\",\"value\":\"2026年1月13日\",\"normalizedValue\":\"2026-01-13\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 16\"},{\"entity\":\"银川新华百货商业集团股份有限公司\",\"attribute\":\"主体名\",\"value\":\"银川新华百货商业集团股份有限公司\",\"normalizedValue\":\"银川新华百货商业集团股份有限公司\",\"file\":\"seller_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"主体名\",\"value\":\"物美科技集团有限公司\",\"normalizedValue\":\"物美科技集团有限公司\",\"file\":\"seller_report.txt\",\"location\":\"Page 5\"},{\"entity\":\"物美集团\",\"attribute\":\"持股数量\",\"value\":\"81,570,343\",\"normalizedValue\":\"81,570,343\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\"},{\"entity\":\"物美集团\",\"attribute\":\"持股数量\",\"value\":\"59,007,215\",\"normalizedValue\":\"59,007,215\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\"},{\"entity\":\"物美集团\",\"attribute\":\"转让股份数量\",\"value\":\"11,281,564\",\"normalizedValue\":\"11,281,564\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\"},{\"entity\":\"物美集团\",\"attribute\":\"转让股份数量\",\"value\":\"22,563,128\",\"normalizedValue\":\"22,563,128\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\"},{\"entity\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"attribute\":\"受让股份数量\",\"value\":\"11,281,564\",\"normalizedValue\":\"11,281,564\",\"file\":\"seller_report.txt\",\"location\":\"Page 11\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"主体名\",\"value\":\"物美科技集团有限公司\",\"normalizedValue\":\"Wumei Technology Group Co., Ltd.\",\"file\":\"seller_report.txt\",\"location\":\"Page 15-16\"},{\"entity\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"attribute\":\"主体名\",\"value\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"normalizedValue\":\"Xiamen Lianxinmei Enterprise Management Partnership (Limited Partnership)\",\"file\":\"seller_report.txt\",\"location\":\"Page 15-16\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"持股数量\",\"value\":\"81,570,343\",\"normalizedValue\":\"81570343\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"持股比例\",\"value\":\"36.15%\",\"normalizedValue\":\"0.3615\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"物美津投（天津）商业管理有限公司\",\"attribute\":\"持股数量\",\"value\":\"8,922,900\",\"normalizedValue\":\"8922900\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"物美津投（天津）商业管理有限公司\",\"attribute\":\"持股比例\",\"value\":\"3.95%\",\"normalizedValue\":\"0.0395\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"北京绿色安全农产品物流信息中心有限公司\",\"attribute\":\"持股数量\",\"value\":\"4,545,951\",\"normalizedValue\":\"4545951\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"北京绿色安全农产品物流信息中心有限公司\",\"attribute\":\"持股比例\",\"value\":\"2.01%\",\"normalizedValue\":\"0.0201\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"持股数量（变动后）\",\"value\":\"72,476,066\",\"normalizedValue\":\"72476066\",\"file\":\"seller_report.txt\",\"location\":\"Page 28\"},{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"持股比例（变动后）\",\"value\":\"32.12%\",\"normalizedValue\":\"0.3212\",\"file\":\"seller_report.txt\",\"location\":\"Page 28\"},{\"entity\":\"银川新华百货商业集团股份有限公司\",\"attribute\":\"批准\",\"value\":\"是\",\"normalizedValue\":\"required\",\"file\":\"seller_report.txt\",\"location\":\"Page 29\"},{\"entity\":\"银川新华百货商业集团股份有限公司\",\"attribute\":\"批准\",\"value\":\"否\",\"normalizedValue\":\"not obtained\",\"file\":\"seller_report.txt\",\"location\":\"Page 30\"}],\"structure\":{\"agreements\":[{\"name\":\"股份转让协议\",\"parties\":[{\"name\":\"物美科技集团有限公司\",\"role\":\"转让方\"},{\"name\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"role\":\"受让方\"},{\"name\":\"物美科技集团有限公司\",\"role\":\"甲方（转让方）\"},{\"name\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"role\":\"乙方（受让方）\"},{\"name\":\"物美集团\",\"role\":\"转让方\"},{\"name\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"role\":\"受让方\"},{\"name\":\"厦门联芯美\",\"role\":\"受让方\"}]},{\"name\":\"本次协议转让\",\"parties\":[{\"name\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"role\":\"受让方\"},{\"name\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"role\":\"受让方\"}]},{\"name\":\"协议转让\",\"parties\":[{\"name\":\"物美科技集团有限公司\",\"role\":\"信息披露义务人\"},{\"name\":\"物美津投（天津）商业管理有限公司\",\"role\":\"一致行动人\"},{\"name\":\"北京绿色安全农产品物流信息中心有限公司\",\"role\":\"一致行动人\"}]}],\"definitions\":[{\"short\":\"甲方\",\"full\":\"物美科技集团有限公司\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 9\"},{\"short\":\"乙方\",\"full\":\"杭州景祺电子信息合伙企业（有限合伙）\",\"file\":\"buyer1_report.txt\",\"location\":\"Page 9\"},{\"short\":\"厦门联芯美\",\"full\":\"厦门联芯美企业管理合伙企业（有限合伙）\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 4\"},{\"short\":\"物美集团\",\"full\":\"物美科技集团有限公司\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 4\"}]},\"candidates\":[{\"entity\":\"物美科技集团有限公司\",\"attribute\":\"持股比例\",\"values\":[{\"value\":\"0%\",\"normalizedValue\":\"0\",\"file\":\"buyer2_report.txt\",\"location\":\"Page 7\"},{\"value\":\"36.15%\",\"normalizedValue\":\"36.15\",\"file\":\"seller_report.txt\",\"location\":\"Page 19\"}]}],\"coverage\":{\"totalChunks\":17,\"processedChunks\":17},\"chunkRange\":{\"offset\":16,\"count\":1},\"content\":\"prior rendering\"}";

describe('M&A gate follow-up: corrected anchor predicate, deterministic pickup, observability (案A・案B・案C, gate diagnosis 2026-11-26)', () => {
  // The two production analyzer bundles below are embedded
  // verbatim (the layer-1 sections the gate and the pickup read:
  // findings, values, structure, candidates, coverage,
  // chunkRange) from the recorded runs — 8c49293c (the run whose
  // reconciliation failed with candidateCount=3, keptCount=0)
  // and 7185bc05 (the earlier run whose seven findings were all
  // misreadings). The replays pin the fixes against the measured
  // material itself, not a paraphrase of it.
  type ProdBundleShape = {
    findings: {
      claim: string; explanation?: string; evidence: string; file: string; location: string;
      evidenceB?: string; fileB?: string; locationB?: string; origin?: 'deterministic-candidate';
    }[];
    values: AgentDataValue[];
    structure: {
      agreements: { name: string; parties: { name: string; role: string }[] }[];
      definitions: { short: string; full: string; file: string; location: string }[];
    };
    candidates: {
      entity: string; attribute: string;
      values: { value: string; normalizedValue: string; file: string; location: string }[];
    }[];
  };
  const prod8c = JSON.parse(PROD_BUNDLE_8C49293C_JSON) as ProdBundleShape;
  const prod7185 = JSON.parse(PROD_BUNDLE_7185BC05_JSON) as ProdBundleShape;

  it('案A: a first citation quoting BOTH values of the pair anchors — the production R1 shape', () => {
    const material = {
      values: [
        { entity: '买方一', attribute: '金額', value: '146,660,323.00', file: 'announcement.txt', location: 'p.2' },
        { entity: '买方一', attribute: '金額', value: '146,660,332.00', file: 'announcement.txt', location: 'p.3' },
      ] as AgentDataValue[],
      structure: { agreements: [], definitions: [] },
      candidates: [],
    };
    const gateOne = (evidence: string, evidenceB: string) => {
      const parsed = parseReconciliationOutput(JSON.stringify({
        findings: [{
          claim: '対価の金額が食い違う', explanation: '説明',
          evidence, file: 'announcement.txt', location: 'p.2',
          evidenceB, fileB: 'announcement.txt', locationB: 'p.2',
          source: { kind: 'kept', index: 0 },
        }],
        dropped: [],
      }), 1, 0);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error('parse failed');
      return applyAgentDataPairGate(parsed, material);
    };
    // Both amounts ride the first citation (what the analyzer
    // actually quoted for R1); the second citation repeats one
    // of them. The pre-fix difference-set predicate dropped
    // exactly this shape; the corrected predicate keeps it.
    expect(gateOne(
      '协议转让对价146,660,332.00 价款支付方146,660,323.00',
      '价款支付方146,660,323.00',
    ).keptIndexes).toEqual([0]);
    // A second citation quoting no group value still cannot
    // anchor: the pair is not shown.
    expect(gateOne(
      '协议转让对价146,660,332.00 价款支付方146,660,323.00',
      '协议转让单价13.00',
    ).keptIndexes).toEqual([]);
    // Both citations quoting the SAME one value is not a pair.
    expect(gateOne(
      '协议转让对价146,660,332.00',
      '协议转让对价146,660,332.00',
    ).keptIndexes).toEqual([]);
  });

  it('案A replay: the seven 7185bc05 misreadings still all gate out', () => {
    // The earlier run's analyzer findings, judged as kept
    // originals against their own bundle's table. Every one of
    // the seven pulls no anchor-group value with its first
    // citation (the gate diagnosis traced each), so the
    // corrected predicate — which only re-decides findings
    // whose citations DO pull group values — changes none of
    // their outcomes.
    const parsed = {
      ok: true as const,
      findings: prod7185.findings,
      sources: prod7185.findings.map((_, index) => ({ kind: 'kept' as const, index })),
      dropped: [] as { index: number; reason: string }[],
      keptCount: prod7185.findings.length,
      keptIndexes: prod7185.findings.map((_, index) => index),
      pickedUpCount: 0,
    };
    const gated = applyAgentDataPairGate(parsed, prod7185);
    expect(gated.findings).toEqual([]);
    expect(gated.keptIndexes).toEqual([]);
    expect(gated.gatedOutKeptIndexes).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('案B: a covered candidate is not synthesized; an uncovered one is, marked as deterministic', () => {
    const bundle = {
      values: [] as AgentDataValue[],
      structure: { agreements: [], definitions: [] },
      candidates: [{
        entity: '聚源盛业',
        attribute: '比率・持分',
        values: [
          { value: '45%', normalizedValue: '45', file: 'announcement.txt', location: 'p.2' },
          { value: '40%', normalizedValue: '40', file: 'buyer1_report.txt', location: 'p.4' },
        ],
      }],
    };
    const faithful = parseReconciliationOutput(JSON.stringify({
      findings: [{
        claim: '持分が食い違う', explanation: '説明',
        evidence: '45%', file: 'announcement.txt', location: 'p.2',
        evidenceB: '40%', fileB: 'buyer1_report.txt', locationB: 'p.4',
        source: { kind: 'candidate', index: 0 },
      }],
    }), 0, 1);
    expect(faithful.ok).toBe(true);
    if (!faithful.ok) return;
    const gatedFaithful = applyAgentDataPairGate(faithful, bundle);
    expect(gatedFaithful.pickedUpCount).toBe(1);
    // The model's own candidate finding survived: nothing to add.
    expect(synthesizeDeterministicCandidatePickups(faithful, gatedFaithful, bundle, false))
      .toEqual({ findings: [], pickedUpCount: 0 });
    // The model built nothing: the pickup synthesizes the
    // candidate's own pair, with its recorded sources, marked.
    const empty = parseReconciliationOutput(JSON.stringify({ findings: [], dropped: [] }), 0, 1);
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    const pickup = synthesizeDeterministicCandidatePickups(
      empty,
      applyAgentDataPairGate(empty, bundle),
      bundle,
      false,
    );
    expect(pickup.pickedUpCount).toBe(1);
    expect(pickup.findings[0]?.origin).toBe('deterministic-candidate');
    expect(pickup.findings[0]?.evidence).toBe('45%');
    expect(pickup.findings[0]?.evidenceB).toBe('40%');
    expect(pickup.findings[0]?.file).toBe('announcement.txt');
    expect(pickup.findings[0]?.fileB).toBe('buyer1_report.txt');
  });

  it('案B: a kept original stating the candidate pair covers it; a partial quote of a wider group does not', () => {
    const pairBundle = {
      values: [] as AgentDataValue[],
      structure: { agreements: [], definitions: [] },
      candidates: [{
        entity: '聚源盛业',
        attribute: '比率・持分',
        values: [
          { value: '45%', normalizedValue: '45', file: 'announcement.txt', location: 'p.2' },
          { value: '40%', normalizedValue: '40', file: 'buyer1_report.txt', location: 'p.4' },
        ],
      }],
    };
    const keptPair = parseReconciliationOutput(JSON.stringify({
      findings: [{
        claim: '持分が食い違う', explanation: '説明',
        evidence: '45%', file: 'announcement.txt', location: 'p.2',
        evidenceB: '40%', fileB: 'buyer1_report.txt', locationB: 'p.4',
        source: { kind: 'kept', index: 0 },
      }],
      dropped: [],
    }), 1, 1);
    expect(keptPair.ok).toBe(true);
    if (!keptPair.ok) return;
    const gatedKept = applyAgentDataPairGate(keptPair, pairBundle);
    expect(gatedKept.keptIndexes).toEqual([0]);
    expect(gatedKept.pickedUpCount).toBe(0);
    // The surviving original is not candidate-built, but it
    // anchors to the candidate's own group with exactly the
    // candidate's pair: covered, nothing synthesized — the
    // pair must not publish twice.
    expect(synthesizeDeterministicCandidatePickups(keptPair, gatedKept, pairBundle, false))
      .toEqual({ findings: [], pickedUpCount: 0 });

    // Strictness: against a THREE-value candidate group, a
    // kept original quoting only two of the values anchors but
    // does not cover — the pair it states is narrower than the
    // candidate's normalized value set — so the pickup still
    // synthesizes from the candidate.
    const wideBundle = {
      values: [] as AgentDataValue[],
      structure: { agreements: [], definitions: [] },
      candidates: [{
        entity: '聚源盛业',
        attribute: '比率・持分',
        values: [
          { value: '45%', normalizedValue: '45', file: 'announcement.txt', location: 'p.2' },
          { value: '40%', normalizedValue: '40', file: 'buyer1_report.txt', location: 'p.4' },
          { value: '50%', normalizedValue: '50', file: 'buyer2_report.txt', location: 'p.6' },
        ],
      }],
    };
    const gatedWide = applyAgentDataPairGate(keptPair, wideBundle);
    expect(gatedWide.keptIndexes).toEqual([0]);
    const widePickup = synthesizeDeterministicCandidatePickups(keptPair, gatedWide, wideBundle, false);
    expect(widePickup.pickedUpCount).toBe(1);
    expect(widePickup.findings[0]?.origin).toBe('deterministic-candidate');
    // A kept original quoting all three values covers the wide
    // candidate exactly.
    const keptAll = parseReconciliationOutput(JSON.stringify({
      findings: [{
        claim: '持分が食い違う', explanation: '説明',
        evidence: '45% 50%', file: 'announcement.txt', location: 'p.2',
        evidenceB: '40%', fileB: 'buyer1_report.txt', locationB: 'p.4',
        source: { kind: 'kept', index: 0 },
      }],
      dropped: [],
    }), 1, 1);
    expect(keptAll.ok).toBe(true);
    if (!keptAll.ok) return;
    expect(synthesizeDeterministicCandidatePickups(
      keptAll,
      applyAgentDataPairGate(keptAll, wideBundle),
      wideBundle,
      false,
    )).toEqual({ findings: [], pickedUpCount: 0 });
  });

  it('replay (production 8c49293c): R1 kept under 案A covers its candidate, R2・R3 picked up under 案B, exactly three findings, no fail-closed', async () => {
    const files = [
      { name: 'announcement.txt', text: '公告本文。' },
      { name: 'buyer1_report.txt', text: '買主一報告本文。' },
      { name: 'buyer2_report.txt', text: '買主二報告本文。' },
      { name: 'seller_report.txt', text: '売主報告本文。' },
    ];
    const { store, setDigest } = await storeWithFiles(files);
    // The model's output as the C0 diagnostic recorded it
    // (step10 bundle): five vetted findings, original 1 declared
    // dropped as 'other', no candidate findings — the most
    // likely decomposition (gate diagnosis §1.2). The vetted
    // findings re-emit the analyzer's own citations, as the
    // reconciler instruction requires.
    const modelOutput = JSON.stringify({
      findings: [0, 2, 3, 4, 5].map((index) => {
        const finding = prod8c.findings[index];
        if (!finding) throw new Error('fixture finding missing');
        return {
          claim: finding.claim,
          explanation: finding.explanation,
          evidence: finding.evidence,
          file: finding.file,
          location: finding.location,
          evidenceB: finding.evidenceB,
          fileB: finding.fileB,
          locationB: finding.locationB,
          source: { kind: 'kept', index },
        };
      }),
      dropped: [{ index: 1, reason: 'other' }],
    });
    const executor: AgentModelExecutor = async () => ({ ok: true, text: modelOutput });
    const result = await toolRegistry.attachment_reconciler.execute(
      {
        attachmentSetId: SET_ID,
        setDigest,
        instruction: 'Audit the documents for inconsistencies and report each inconsistency with its explanation.',
        content: PROD_BUNDLE_8C49293C_JSON,
      },
      {
        ...contextFor(store, executor),
        env: { ORIGIN_AGENT_FINDINGS_RECONCILIATION_ENABLED: 'enforce' },
      },
    );
    // Before the fixes this exact material failed closed with
    // AGENT_RECONCILIATION_NO_FINDINGS (kept 0, picked up 0).
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      findings: ProdBundleShape['findings'];
      reconciliation: {
        candidateCount: number; keptCount: number; droppedCount: number;
        droppedReasons: Record<string, number>; pickedUpCount: number;
        keptIndexes?: number[]; droppedIndexes?: { index: number; reason: string }[];
      };
    };
    expect(bundle.reconciliation.candidateCount).toBe(3);
    // 案A: R1 (original 0) survives the gate; the other four
    // vetted originals pull no group value and gate out, and
    // original 1 stays the model's own 'other' drop.
    expect(bundle.reconciliation.keptIndexes).toEqual([0]);
    // Five drops in total: the model's own 'other' plus the
    // four gate removals — one fewer than the production
    // record's six, because R1 is the one that now survives.
    expect(bundle.reconciliation.droppedCount).toBe(5);
    expect(bundle.reconciliation.droppedReasons).toEqual({ other: 1, 'no-pair': 4 });
    // 案B: the amount candidate (R1) is covered by the model's
    // surviving original — same group, exactly the same pair —
    // so only the funding (R3) and ratio (R2) candidates are
    // picked up deterministically, and no pair publishes twice:
    // the final list is exactly R1 (model) + R3 + R2 (marked).
    expect(bundle.reconciliation.pickedUpCount).toBe(2);
    expect(bundle.findings).toHaveLength(3);
    expect(bundle.findings[0]?.claim).toBe(prod8c.findings[0]?.claim);
    expect(bundle.findings[0]?.origin).toBeUndefined();
    const synthesized = bundle.findings.slice(1);
    expect(synthesized.every((finding) => finding.origin === 'deterministic-candidate')).toBe(true);
    // R3 (funding), R2 (ratio) — each synthesized from its
    // candidate's own two values, in candidate order.
    expect(synthesized.map((finding) => `${finding.evidence}||${finding.evidenceB}`)).toEqual([
      '自有资金||信息披露义务人向银行的借款',
      '45%||40%',
    ]);
  });
});

describe('rerun countermeasures 2026-11-27 (M-1 basis / M-3 page locations / B-1 discipline / B-2 business-line check)', () => {
  const emptyStructure = { agreements: [], definitions: [] };

  it('M-1: values stating different bases never pair (the production Finding-4 shape)', () => {
    // 物美's 100% is its stake IN a subsidiary; the 5% is the
    // transferred shares' share OF the target's total capital.
    // Same holder, same attribute label — different bases, so no
    // candidate. The unstated control pair below proves the
    // split comes from the bases, not the values.
    const candidates = computeAgentDataValueMismatches([
      { entity: '物美科技集团有限公司', attribute: '比率・持分', value: '100%', file: 'seller_report.txt', location: 'Page 6', basis: '物美津投（天津）商业管理有限公司' },
      { entity: '物美科技集团有限公司', attribute: '持股比例', value: '5%', file: 'seller_report.txt', location: 'Page 16', basis: '银川新华百货商业集团股份有限公司' },
    ], emptyStructure);
    expect(candidates).toHaveLength(0);
    const unstated = computeAgentDataValueMismatches([
      { entity: '物美科技集团有限公司', attribute: '比率・持分', value: '100%', file: 'seller_report.txt', location: 'Page 6' },
      { entity: '物美科技集团有限公司', attribute: '持股比例', value: '5%', file: 'seller_report.txt', location: 'Page 16' },
    ], emptyStructure);
    expect(unstated).toHaveLength(1);
  });

  it('M-1: same-basis values pair, the candidate records the basis, and R1/R3 shapes are unchanged', () => {
    const candidates = computeAgentDataValueMismatches([
      // R2 shape: both sides state the same basis.
      { entity: '聚源盛业投资（宁波）有限公司', attribute: '比率・持分', value: '45%', file: 'announcement.txt', location: 'Page 4', basis: '银川新华百货商业集团股份有限公司' },
      { entity: '聚源盛业投资（宁波）有限公司', attribute: '比率・持分', value: '40%', file: 'buyer1_report.txt', location: 'Page 5', basis: '银川新华百货商业集团股份有限公司' },
      // R1 shape: amounts, no basis stated.
      { entity: '厦门联芯美企业管理合伙企业（有限合伙）', attribute: '金額', value: '146,660,323.00', file: 'announcement.txt', location: 'Page 2' },
      { entity: '厦门联芯美企业管理合伙企业（有限合伙）', attribute: '金額', value: '146,660,332.00', file: 'announcement.txt', location: 'Page 11' },
      // R3 shape: funding sources, no basis stated.
      { entity: '杭州景祺电子信息合伙企业（有限合伙）', attribute: '資金源泉', value: '自有资金', file: 'announcement.txt', location: 'Page 2' },
      { entity: '杭州景祺电子信息合伙企业（有限合伙）', attribute: '資金源泉', value: '银行借款', file: 'buyer1_report.txt', location: 'Page 12' },
    ], emptyStructure);
    expect(candidates).toHaveLength(3);
    const ratio = candidates.find((candidate) => candidate.attribute === '比率・持分');
    expect(ratio?.basis).toBe('银川新华百货商业集团股份有限公司');
    expect(ratio?.values.map((entry) => entry.normalizedValue)).toEqual(['45', '40']);
  });

  it('M-1: parseAgentDataValues round-trips the basis and drops an empty one', () => {
    const parsed = parseAgentDataValues([
      { entity: '甲', attribute: '持股比例', value: '45%', file: 'f', location: 'l', basis: '乙公司' },
      { entity: '甲', attribute: '持股比例', value: '40%', file: 'f', location: 'l', basis: '  ' },
    ]);
    expect(parsed[0]?.basis).toBe('乙公司');
    expect(parsed[1]?.basis).toBeUndefined();
  });

  it('M-3: the final audit bundle carries page-form locations for values and candidates', async () => {
    const text = ['=== Page 1 ===', '甲の金額は100元である。', '=== Page 2 ===', '甲の金額は200元である。'].join('\n');
    const { store, setDigest } = await storeWithFiles([{ name: 'doc.txt', text }]);
    const executor: AgentModelExecutor = async () => ({
      ok: true,
      text: JSON.stringify({
        findings: [{
          claim: '金額がページ間で食い違う',
          explanation: '同一主体の同一属性で2つの金額が記載されている',
          evidence: '甲の金額は100元である。',
          file: 'doc.txt',
          location: 'チャンク 1・行 2',
          evidenceB: '甲の金額は200元である。',
          fileB: 'doc.txt',
          locationB: 'チャンク 1・行 4',
        }],
        values: [
          { entity: '甲', attribute: '金額', value: '100', file: 'doc.txt', location: 'チャンク 1・行 2' },
          { entity: '甲', attribute: '金額', value: '200', file: 'doc.txt', location: 'チャンク 1・行 4' },
        ],
        structure: { agreements: [], definitions: [] },
      }),
    });
    const result = await toolRegistry.attachment_analyzer.execute(
      {
        attachmentSetId: SET_ID, setDigest,
        instruction: 'Audit the documents for inconsistencies',
        outputKind: 'findings', chunkOffset: 0, chunkCount: 1, auditMode: true,
      },
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      values: { value: string; location: string }[];
      candidates: { values: { location: string }[] }[];
    };
    expect(bundle.values.map((entry) => entry.location)).toEqual(['Page 1', 'Page 2']);
    expect(bundle.candidates).toHaveLength(1);
    expect(bundle.candidates[0]?.values.map((entry) => entry.location)).toEqual(['Page 1', 'Page 2']);
  });

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
        name, mediaType, kind: 'text',
        byteSize: measured.byteSize, charCount: measured.charCount,
        sha256: measured.sha256, extractedText: text,
      });
    }
    const set = await store.getSet(SET_ID, OWNER);
    if (!set) throw new Error('fixture set missing');
    return { store, setDigest: computeAgentAttachmentSetDigest(set.files) };
  }

  const CLASSIFYING_SCHEMA = [
    'Event_ID,Loss_Event_Category,Business_Line,Loss_Amount_CNY',
    'EXAMPLE001,EL1,BL2,100000',
  ].join('\n');

  it('B-1: the rows instruction carries the classification discipline when the schema names classification columns', async () => {
    const { store, setDigest } = await storeWithTypedFiles([
      ['events.tsv', ['Event_ID\tAmount', 'OR001\t100'].join('\n'), 'text/tab-separated-values'],
      ['classified.schema.csv', CLASSIFYING_SCHEMA, 'text/csv'],
    ]);
    const instructions: string[] = [];
    const executor: AgentModelExecutor = async (input) => {
      instructions.push(input.instruction);
      if (input.userText.startsWith('【出典: events.tsv')) {
        return {
          ok: true,
          text: JSON.stringify({
            rows: [{ Event_ID: 'OR001', Loss_Event_Category: 'EL7', Business_Line: 'BL5', Loss_Amount_CNY: '100', Amount: '100' }],
          }),
        };
      }
      return { ok: true, text: JSON.stringify({ rows: [] }) };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 0, chunkCount: 2 }),
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    expect(instructions[0]).toContain('分類の判定規律');
    expect(instructions[0]).toContain('行為者で決めること');
    expect(instructions[0]).toContain('その対応に必ず従い');
  });

  it('B-1: a plain extraction schema carries no classification discipline', async () => {
    const { store, setDigest } = await storeWithTypedFiles([
      ['events.tsv', ['Event_ID\tAmount', 'OR001\t100'].join('\n'), 'text/tab-separated-values'],
      ['plain.schema.csv', ['Event_ID,Amount', 'EXAMPLE001,100'].join('\n'), 'text/csv'],
    ]);
    const instructions: string[] = [];
    const executor: AgentModelExecutor = async (input) => {
      instructions.push(input.instruction);
      if (input.userText.startsWith('【出典: events.tsv')) {
        return { ok: true, text: JSON.stringify({ rows: [{ Event_ID: 'OR001', Amount: '100' }] }) };
      }
      return { ok: true, text: JSON.stringify({ rows: [] }) };
    };
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 0, chunkCount: 2 }),
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    expect(instructions.every((instruction) => !instruction.includes('分類の判定規律'))).toBe(true);
  });

  it('B-2: the final rows bundle corrects a business line the set’s own mapping contradicts', async () => {
    const events = [
      ['Event_ID', 'Involved_Department', 'Loss_Amount_CNY'].join('\t'),
      ['OR001', '证券营业部', '100'].join('\t'),
      ['OR002', '信息技术部', '200'].join('\t'),
    ].join('\n');
    const mapping = [
      ['BL_Code', 'BL_Name_CN', 'Key_Departments'].join('\t'),
      ['BL6', '代理服务', '证券服务部'].join('\t'),
      ['BL8', '零售经纪', '经纪业务部, 证券营业部'].join('\t'),
    ].join('\n');
    const { store, setDigest } = await storeWithTypedFiles([
      ['events.tsv', events, 'text/tab-separated-values'],
      ['business_line_mapping.tsv', mapping, 'text/tab-separated-values'],
      ['classified.schema.csv', CLASSIFYING_SCHEMA, 'text/csv'],
    ]);
    const executor: AgentModelExecutor = async (input) => {
      if (input.userText.startsWith('【出典: events.tsv')) {
        return {
          ok: true,
          text: JSON.stringify({
            rows: [
              { Event_ID: 'OR001', Loss_Event_Category: 'EL7', Business_Line: 'BL6', Loss_Amount_CNY: '100' },
              { Event_ID: 'OR002', Loss_Event_Category: 'EL7', Business_Line: 'BL5', Loss_Amount_CNY: '200' },
            ],
          }),
        };
      }
      return { ok: true, text: JSON.stringify({ rows: [] }) };
    };
    // A step processes at most 2 chunks, so the 3-chunk set
    // chains: the second step completes the set and is where the
    // final-step check fires, over the rows the chain merged.
    const step1 = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 0, chunkCount: 2 }),
      contextFor(store, executor),
    );
    expect(step1.ok).toBe(true);
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest, { chunkOffset: 2, chunkCount: 1, content: step1.artifact }),
      contextFor(store, executor),
    );
    expect(result.ok).toBe(true);
    const bundle = JSON.parse(result.artifact ?? '{}') as {
      rows: Array<Record<string, string>>;
      businessLineCheck?: {
        corrections: { key: string; department: string; from: string; to: string }[];
        unmappedDepartments: string[];
      };
    };
    // 证券营业部 is BL8 by the set's mapping: corrected from the
    // model's BL6. 信息技术部 is not in the mapping: the model's
    // BL5 stands, and the department is reported unmapped.
    expect(bundle.rows.map((row) => row.Business_Line)).toEqual(['BL8', 'BL5']);
    expect(bundle.businessLineCheck?.corrections).toEqual([
      { key: 'OR001', department: '证券营业部', from: 'BL6', to: 'BL8' },
    ]);
    expect(bundle.businessLineCheck?.unmappedDepartments).toEqual(['信息技术部']);
  });
});
