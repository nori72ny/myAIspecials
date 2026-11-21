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
outputKind: 'findings', chunkOffset: 0, chunkCount: 4,
},
contextFor(store, executor),
);
expect(result.ok).toBe(true);
const bundle = JSON.parse(result.artifact?? '{}') as {
coverage: { processedChunks: number};
findings: { file: string}[];
};
expect(bundle.coverage.processedChunks).toBe(4);
expect(bundle.findings.map((finding) => finding.file)).toEqual([
'cluster_state.txt', 'cluster_state.txt', 'deployment.yaml', 'failing_pod.log',
]);
expect(seenFrames).toEqual([
'【出典: cluster_state.txt（チャンク 1/4）】',
'【出典: cluster_state.txt（チャンク 2/4）】',
'【出典: deployment.yaml（チャンク 3/4）】',
'【出典: failing_pod.log（チャンク 4/4）】',
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
outputKind: 'findings', chunkOffset: 0, chunkCount: 4,
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
const step1 = await toolRegistry.attachment_analyzer.execute(
params({ chunkOffset: 0, chunkCount: 8}), contextFor(store, executor));
expect(step1.ok).toBe(true);
const step2 = await toolRegistry.attachment_analyzer.execute(
params({ chunkOffset: 8, chunkCount: 8, content: step1.artifact}), contextFor(store, executor));
expect(step2.ok).toBe(true);
const step3 = await toolRegistry.attachment_analyzer.execute(
params({ chunkOffset: 16, chunkCount: 1, content: step2.artifact}), contextFor(store, executor));
expect(step3.ok).toBe(true);
const bundle = JSON.parse(step3.artifact?? '{}') as {
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
const result = await toolRegistry.attachment_analyzer.execute(
{
attachmentSetId: SET_ID, setDigest,
instruction: '各断片から対象を抽出してください',
outputKind: 'rows', chunkOffset: 0, chunkCount: 4,
},
contextFor(store, emptyExecutor),
);
expect(result.ok).toBe(false);
expect(result.message).toContain('AGENT_DATA_COVERAGE_INSUFFICIENT');
});
});
