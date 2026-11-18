// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import { InMemoryAgentAttachmentStore } from './agentAttachmentStoreMemory.fixture.js';
import { createHash } from 'node:crypto';
import type { AgentModelExecutor } from './agentModelCall.js';

const OPERATOR_RUN_OWNER_BINDING = createHash('sha256').update('origin.agent.runs.owner.operator.v1').digest('hex');

const SECRET = 'test-only-'.repeat(5);
const env = {
  ORIGIN_AGENT_APPROVAL_SECRET: SECRET,
  ORIGIN_AGENT_ATTACHMENTS_ENABLED: 'true',
} as NodeJS.ProcessEnv;

const FRUITS = ['id,item,amount', 'A-1,りんご,120', 'A-2,みかん,80', 'A-3,ぶどう,300'].join('\n');
const CLASSIFY_GOAL = '各行を分類してレポートを作成してください';

function makeConsumptionStore(): AgentRunConsumptionStore {
  const consumed = new Set<string>();
  return {
    consume: vi.fn(async (runId: string) => {
      if (consumed.has(runId)) return false;
      consumed.add(runId);
      return true;
    }),
  };
}

/** Deterministic stand-in at the provider port: classifies each CSV
 * row in the chunk text it is actually given (amount >= 200 → 高額).
 * The pipeline around it — router, planner augmentation, advancer,
 * tools, coverage verification — is the real production code. */
const classifyingExecutor: AgentModelExecutor = async ({ userText }) => {
  const lines = userText.split('\n').filter((line) => line.length > 0);
  const rows = lines.slice(1).map((line) => {
    const [id, item, amount] = line.split(',');
    return { id, item, amount, category: Number(amount) >= 200 ? '高額' : '通常' };
  });
  return { ok: true, text: JSON.stringify({ rows }) };
};

function appFor(deps: {
  runStore: InMemoryAgentRunStore;
  attachmentStore: InMemoryAgentAttachmentStore;
  modelCall?: AgentModelExecutor;
}) {
  const app = express();
  app.use('/api/agent/v3/attachment-sets', express.json({ limit: '8mb' }));
  app.use(express.json());
  app.use(createAgentOrchestratorV3Router(env, makeConsumptionStore(), deps));
  return app;
}

async function createSetWithFile(app: express.Express, name: string, contentText: string): Promise<string> {
  const created = await request(app).post('/api/agent/v3/attachment-sets')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({});
  expect(created.status).toBe(201);
  const setId = created.body.attachmentSetId as string;
  const added = await request(app).post(`/api/agent/v3/attachment-sets/${setId}/files`)
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ name, mediaType: 'text/csv', contentText });
  expect(added.status).toBe(201);
  return setId;
}

type PlanBody = {
  runId: string;
  planToken: string;
  steps: Array<{ toolName: string; reasonCode: string; params: Record<string, unknown> }>;
};

async function planWithAttachment(app: express.Express, goal: string, setId: string) {
  const plan = await request(app).post('/api/agent/v3/plan')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ goal, attachmentSetId: setId });
  return plan;
}

async function approveAndCreate(app: express.Express, plan: PlanBody, goal: string) {
  const approval = await request(app).post('/api/agent/v3/approval')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps });
  expect(approval.status).toBe(201);
  const created = await request(app).post('/api/agent/v3/runs')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ runId: plan.runId, goal, planToken: plan.planToken, approvalToken: approval.body.approvalToken, steps: plan.steps });
  return created;
}

describe('agent v3 attachment plan augmentation (F2)', () => {
  it('plans reader → analyzer → data-grounded document for a classification goal', async () => {
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    const plan = await planWithAttachment(app, CLASSIFY_GOAL, setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody & { attachments?: { totalChars: number } };
    expect(body.steps.map((step) => step.toolName)).toEqual(['attachment_reader', 'attachment_analyzer', 'document_generator']);
    expect(body.steps[0].reasonCode).toBe('attachment-input');
    expect(body.steps[1].reasonCode).toBe('attachment-analysis');
    expect(body.steps[1].params.outputKind).toBe('rows');
    expect(body.steps[1].params.chunkOffset).toBe(0);
    expect(body.steps[1].params.chunkCount).toBe(1);
    expect(body.steps[1].params.instruction).toBe(CLASSIFY_GOAL);
    // The generative step is re-grounded: no fabricated content, the
    // template fallback disabled, content bound to the analyzer step.
    expect(body.steps[2].params.dataGrounded).toBe(true);
    expect(body.steps[2].params.contentFromStep).toBe(1);
    expect(body.steps[2].params).not.toHaveProperty('content');
    expect(body.attachments?.totalChars).toBe(FRUITS.length);
  });

  it('leaves a downstream file_writer chained to the document artifact, not the analyzer', async () => {
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    // The CSV wording makes the planner append a file_writer after the
    // document; augmentation grounds only the FIRST generative step.
    const plan = await planWithAttachment(app, 'このCSVの各行を分類してレポートを作成してください', setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    expect(body.steps.map((step) => step.toolName)).toEqual(['attachment_reader', 'attachment_analyzer', 'document_generator', 'file_writer']);
    expect(body.steps[2].params.dataGrounded).toBe(true);
    expect(body.steps[3].params.contentFromPreviousArtifact).toBe(true);
    expect(body.steps[3].params).not.toHaveProperty('contentFromStep');
  });

  it('splits the analyzer at 8 chunks and chains the continuation', async () => {
    const lines = ['id,item,amount'];
    // ~41 chars per row → ~85 rows per 3,500-char chunk → 1,200 rows ≈ 15 chunks.
    for (let i = 0; i < 1200; i += 1) lines.push(`R-${String(i).padStart(4, '0')},${'x'.repeat(28)}${i % 10},${(i % 9) * 50}`);
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'big.csv', lines.join('\n'));
    const plan = await planWithAttachment(app, CLASSIFY_GOAL, setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    const analyzers = body.steps.filter((step) => step.toolName === 'attachment_analyzer');
    expect(analyzers.length).toBe(2);
    expect(analyzers[0].params.chunkOffset).toBe(0);
    expect(analyzers[0].params.chunkCount).toBe(8);
    expect(analyzers[1].params.chunkOffset).toBe(8);
    expect(analyzers[1].params.chunkCount).toBeGreaterThan(0);
    expect(analyzers[1].params.chunkCount).toBeLessThanOrEqual(8);
    expect(analyzers[1].params.contentFromStep).toBe(1);
    const document = body.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.contentFromStep).toBe(2);
    expect(document?.params.dataGrounded).toBe(true);
  });

  it('refuses a set needing more than 48 chunks at plan time', async () => {
    const lines = ['id,item,amount'];
    // ~41 chars per row → 4,500 rows ≈ 53 chunks > the 48-chunk ceiling.
    for (let i = 0; i < 4500; i += 1) lines.push(`R-${String(i).padStart(4, '0')},${'x'.repeat(28)}${i % 10},${(i % 9) * 50}`);
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'huge.csv', lines.join('\n'));
    const plan = await planWithAttachment(app, CLASSIFY_GOAL, setId);
    expect(plan.status).toBe(422);
    expect(plan.body.code).toBe('AGENT_ATTACHMENT_TOO_LARGE');
    expect(plan.body.chunkCount).toBeGreaterThan(48);
    expect(plan.body.limit).toBe(48);
  });

  it('grounds file_writer on the analyzer and drops its fabricated sample content', async () => {
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    const plan = await planWithAttachment(app, '添付CSVを分類して簡単なCSV一覧を作って', setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    expect(body.steps.map((step) => step.toolName)).toEqual(['attachment_reader', 'attachment_analyzer', 'file_writer']);
    const writer = body.steps[body.steps.length - 1];
    expect(typeof writer.params.path).toBe('string');
    expect(writer.params.contentFromStep).toBe(1);
    expect(writer.params).not.toHaveProperty('content');
    expect(writer.params).not.toHaveProperty('contentFromPreviousArtifact');
  });

  it('keeps a no-generative-step plan ending in the analyzer bundle (J1a)', async () => {
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    // A research-only goal has no generative step: the analyzers close
    // the plan and their bundle is the run's final artifact.
    const plan = await planWithAttachment(app, 'このCSVの内容について調べてください', setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    expect(body.steps.map((step) => step.toolName)).toEqual(['attachment_reader', 'web_search_grounding', 'attachment_analyzer']);
  });
});

describe('agent v3 attachment run execution (F2)', () => {
  it('claims the set on run creation and completes with a data-bearing document', async () => {
    const runStore = new InMemoryAgentRunStore();
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor({ runStore, attachmentStore, modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    const plan = await planWithAttachment(app, CLASSIFY_GOAL, setId);
    expect(plan.status).toBe(201);
    const planBody = plan.body as PlanBody;

    const created = await approveAndCreate(app, planBody, CLASSIFY_GOAL);
    expect(created.status).toBe(201);
    expect(created.body.run.plan.map((step: { toolName: string }) => step.toolName))
      .toEqual(['attachment_reader', 'attachment_analyzer', 'document_generator']);
    expect(created.body.run.plan[2].inputFrom).toBe(1);

    // The run claimed the set (design J2): lifetime now follows the run.
    const claimed = await attachmentStore.getSet(setId, OPERATOR_RUN_OWNER_BINDING);
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedRunId).toBe(planBody.runId);

    const advanced = await request(app).post(`/api/agent/v3/runs/${planBody.runId}/advance`)
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(advanced.status).toBe(200);
    expect(advanced.body.status).toBe('completed');
    expect(advanced.body.run.stepsState.map((step: { status: string }) => step.status))
      .toEqual(['completed', 'completed', 'completed']);
    // The final artifact is the composed document, and it carries the
    // real classified values from the attachment — not template data.
    const artifact = JSON.parse(advanced.body.artifact) as { kind?: string; content?: string };
    expect(artifact.kind).toBe('document');
    expect(artifact.content).toContain('A-3,ぶどう,300,高額');
    expect(artifact.content).toContain('A-1,りんご,120,通常');
    expect(artifact.content).not.toContain('北関東');
  });

  it('fails the run honestly when the model output cannot cover the input', async () => {
    const droppingExecutor: AgentModelExecutor = async () => ({ ok: true, text: JSON.stringify({ rows: [] }) });
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: droppingExecutor });
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    const plan = await planWithAttachment(app, CLASSIFY_GOAL, setId);
    const planBody = plan.body as PlanBody;
    const created = await approveAndCreate(app, planBody, CLASSIFY_GOAL);
    expect(created.status).toBe(201);
    const advanced = await request(app).post(`/api/agent/v3/runs/${planBody.runId}/advance`)
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    // The advance endpoint answers 422 with the failure code when the
    // run fails (its long-standing convention).
    expect(advanced.status).toBe(422);
    expect(advanced.body.status).toBe('failed');
    expect(advanced.body.code).toBe('AGENT_DATA_COVERAGE_INSUFFICIENT');
    const failedStep = (advanced.body.run.stepsState as Array<{ status: string; errorCode?: string }>)
      .find((step) => step.status === 'failed');
    expect(failedStep?.errorCode).toBe('AGENT_DATA_COVERAGE_INSUFFICIENT');
  });
});
