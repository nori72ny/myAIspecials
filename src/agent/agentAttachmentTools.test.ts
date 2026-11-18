// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toolRegistry, type ToolExecutionContext } from './toolRegistry.js';
import { InMemoryAgentAttachmentStore } from './agentAttachmentStoreMemory.fixture.js';
import {
  computeAgentAttachmentSetDigest,
  validateAgentAttachmentFileText,
} from './agentAttachmentRecord.js';
import type { AgentModelExecutor } from './agentModelCall.js';

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

function contextFor(store: InMemoryAgentAttachmentStore, modelCall?: AgentModelExecutor): ToolExecutionContext {
  return {
    attachments: { store, ownerBinding: OWNER },
    ...(modelCall ? { modelCall } : {}),
  };
}

/** Deterministic stand-in at the provider port: classifies each CSV
 * row in the chunk it is actually given (amount >= 200 → 高額). */
const classifyingExecutor: AgentModelExecutor = async ({ userText }) => {
  const lines = userText.split('\n').filter((line) => line.length > 0);
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
      const lines = userText.split('\n').filter((line) => line.length > 0).slice(1, 3);
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

  it('allows exactly one repair retry, then fails AGENT_DATA_OUTPUT_INVALID', async () => {
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
    expect(result.message).toBe('AGENT_DATA_OUTPUT_INVALID');
    expect(calls).toBe(2);
  });

  it('propagates the provider failure code as the step failure', async () => {
    const { store, setDigest } = await storeWithFruits();
    const failingExecutor: AgentModelExecutor = async () => ({ ok: false, code: 'PROVIDER_TIMEOUT' });
    const result = await toolRegistry.attachment_analyzer.execute(
      analyzerParams(setDigest),
      contextFor(store, failingExecutor),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe('PROVIDER_TIMEOUT');
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
