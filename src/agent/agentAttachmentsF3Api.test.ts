// @vitest-environment node
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import { InMemoryAgentAttachmentStore } from './agentAttachmentStoreMemory.fixture.js';
import type { AgentModelExecutor } from './agentModelCall.js';

/**
 * F3 (design §1.3): the browser flow's claim bridge. A browser-created
 * set binds to its upload token; the browser run it feeds binds to the
 * run's plan token. These tests drive the whole browser path — set
 * creation, upload, plan binding, browser approval, run creation,
 * advance — through the real router, advancer and tools, and pin the
 * bridge: presenting the set's upload token at run creation re-binds
 * the set to the run so execution can read it; without the token (or
 * with another set's token) nothing moves and execution fails closed.
 */

const SECRET = 'test-only-'.repeat(5);
const env = {
  ORIGIN_AGENT_APPROVAL_SECRET: SECRET,
  ORIGIN_AGENT_ATTACHMENTS_ENABLED: 'true',
  APP_URL: 'https://example.test',
} as NodeJS.ProcessEnv;
const offEnv = {
  ORIGIN_AGENT_APPROVAL_SECRET: SECRET,
  APP_URL: 'https://example.test',
} as NodeJS.ProcessEnv;
const ORIGIN = { Origin: 'https://example.test' };

const browserRunOwnerBinding = (planToken: string) => createHash('sha256').update(`origin.agent.runs.owner.browser.v1:${planToken}`).digest('hex');
const browserAttachmentOwnerBinding = (uploadToken: string) => createHash('sha256').update(`origin.agent.attachments.owner.browser.v1:${uploadToken}`).digest('hex');

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

/** Same deterministic provider stand-in as the F2 suite: classifies
 * each CSV row in the chunk text it is actually given. */
const classifyingExecutor: AgentModelExecutor = async ({ userText }) => {
  const lines = userText.split('\n').filter((line) => line.length > 0 && !line.startsWith('【出典:'));
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
}, testEnv: NodeJS.ProcessEnv = env) {
  const app = express();
  app.use('/api/agent/v3/attachment-sets', express.json({ limit: '8mb' }));
  app.use(express.json());
  app.use(createAgentOrchestratorV3Router(testEnv, makeConsumptionStore(), deps));
  return app;
}

type PlanBody = {
  runId: string;
  planToken: string;
  steps: Array<{ toolName: string; reasonCode: string; params: Record<string, unknown> }>;
  attachments?: { setId: string; fileCount: number; totalChars: number };
};

async function createBrowserSetWithFile(app: express.Express, name: string, contentText: string) {
  const created = await request(app).post('/api/agent/v3/attachment-sets')
    .set(ORIGIN)
    .send({});
  expect(created.status).toBe(201);
  const setId = created.body.attachmentSetId as string;
  const uploadToken = created.body.uploadToken as string;
  const added = await request(app).post(`/api/agent/v3/attachment-sets/${setId}/files`)
    .set('x-agent-attachment-token', uploadToken)
    .send({ name, mediaType: 'text/csv', contentText });
  expect(added.status).toBe(201);
  return { setId, uploadToken };
}

async function planAsBrowser(app: express.Express, goal: string, setId: string, uploadToken: string) {
  const plan = await request(app).post('/api/agent/v3/plan')
    .set(ORIGIN)
    .set('x-agent-attachment-token', uploadToken)
    .send({ goal, attachmentSetId: setId });
  expect(plan.status).toBe(201);
  return plan.body as PlanBody;
}

async function approveAndCreateAsBrowser(
  app: express.Express,
  plan: PlanBody,
  goal: string,
  uploadToken: string | null,
) {
  const approval = await request(app).post('/api/agent/v3/browser-approval')
    .set(ORIGIN)
    .send({ runId: plan.runId, planToken: plan.planToken, steps: plan.steps, confirm: true });
  expect(approval.status).toBe(201);
  let createRequest = request(app).post('/api/agent/v3/runs')
    .set(ORIGIN);
  if (uploadToken !== null) createRequest = createRequest.set('x-agent-attachment-token', uploadToken);
  const created = await createRequest.send({
    runId: plan.runId,
    goal,
    planToken: plan.planToken,
    approvalToken: approval.body.approvalToken,
    steps: plan.steps,
  });
  expect(created.status).toBe(201);
  return created;
}

describe('agent v3 attachment claim bridge (F3)', () => {
  it('bridges a browser set into the run at creation and completes with a data-bearing document', async () => {
    const runStore = new InMemoryAgentRunStore();
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor({ runStore, attachmentStore, modelCall: classifyingExecutor });
    const { setId, uploadToken } = await createBrowserSetWithFile(app, 'fruits.csv', FRUITS);
    const plan = await planAsBrowser(app, CLASSIFY_GOAL, setId, uploadToken);
    expect(plan.steps.map((step) => step.toolName)).toEqual(['attachment_reader', 'attachment_analyzer', 'document_generator']);
    expect(plan.attachments).toMatchObject({ setId, fileCount: 1, totalChars: FRUITS.length });

    const created = await approveAndCreateAsBrowser(app, plan, CLASSIFY_GOAL, uploadToken);
    expect(created.body.run.plan.map((step: { toolName: string }) => step.toolName))
      .toEqual(['attachment_reader', 'attachment_analyzer', 'document_generator']);

    // The bridge moved the set: claimed under the run's binding (its
    // lifetime now follows the run), and no longer visible under the
    // upload token's binding.
    const runBinding = browserRunOwnerBinding(plan.planToken);
    const claimed = await attachmentStore.getSet(setId, runBinding);
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedRunId).toBe(plan.runId);
    expect(claimed?.ownerBinding).toBe(runBinding);
    expect(await attachmentStore.getSet(setId, browserAttachmentOwnerBinding(uploadToken))).toBeNull();

    const advanced = await request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)
      .set(ORIGIN)
      .send({ planToken: plan.planToken });
    expect(advanced.status).toBe(200);
    expect(advanced.body.status).toBe('completed');
    expect(advanced.body.run.stepsState.map((step: { status: string }) => step.status))
      .toEqual(['completed', 'completed', 'completed']);
    const artifact = JSON.parse(advanced.body.artifact) as { kind?: string; content?: string };
    expect(artifact.kind).toBe('document');
    expect(artifact.content).toContain('A-3,ぶどう,300,高額');
    expect(artifact.content).toContain('A-1,りんご,120,通常');
  });

  it('without the upload token the set stays unclaimed and execution fails closed as unavailable', async () => {
    const runStore = new InMemoryAgentRunStore();
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor({ runStore, attachmentStore, modelCall: classifyingExecutor });
    const { setId, uploadToken } = await createBrowserSetWithFile(app, 'fruits.csv', FRUITS);
    const plan = await planAsBrowser(app, CLASSIFY_GOAL, setId, uploadToken);

    await approveAndCreateAsBrowser(app, plan, CLASSIFY_GOAL, null);

    // Nothing moved: the set is still open under its own binding and
    // invisible under the run's binding.
    const unclaimed = await attachmentStore.getSet(setId, browserAttachmentOwnerBinding(uploadToken));
    expect(unclaimed?.status).toBe('open');
    expect(await attachmentStore.getSet(setId, browserRunOwnerBinding(plan.planToken))).toBeNull();

    const advanced = await request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)
      .set(ORIGIN)
      .send({ planToken: plan.planToken });
    expect(advanced.status).toBe(422);
    expect(advanced.body.status).toBe('failed');
    expect(advanced.body.code).toBe('AGENT_ATTACHMENT_UNAVAILABLE');
    const failedStep = (advanced.body.run.stepsState as Array<{ status: string; errorCode?: string }>)
      .find((step) => step.status === 'failed');
    expect(failedStep?.errorCode).toBe('AGENT_ATTACHMENT_UNAVAILABLE');
  });

  it('does not bridge with a token that names a different set', async () => {
    const runStore = new InMemoryAgentRunStore();
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor({ runStore, attachmentStore, modelCall: classifyingExecutor });
    const first = await createBrowserSetWithFile(app, 'fruits.csv', FRUITS);
    const second = await createBrowserSetWithFile(app, 'other.csv', FRUITS);
    const plan = await planAsBrowser(app, CLASSIFY_GOAL, first.setId, first.uploadToken);

    // The run is created presenting the SECOND set's token: it proves
    // ownership of the wrong set, so neither set may move.
    await approveAndCreateAsBrowser(app, plan, CLASSIFY_GOAL, second.uploadToken);

    expect((await attachmentStore.getSet(first.setId, browserAttachmentOwnerBinding(first.uploadToken)))?.status).toBe('open');
    expect((await attachmentStore.getSet(second.setId, browserAttachmentOwnerBinding(second.uploadToken)))?.status).toBe('open');
    expect(await attachmentStore.getSet(first.setId, browserRunOwnerBinding(plan.planToken))).toBeNull();

    const advanced = await request(app).post(`/api/agent/v3/runs/${plan.runId}/advance`)
      .set(ORIGIN)
      .send({ planToken: plan.planToken });
    expect(advanced.status).toBe(422);
    expect(advanced.body.code).toBe('AGENT_ATTACHMENT_UNAVAILABLE');
  });

  it('reports attachmentsEnabled on /status only while the switch is on', async () => {
    const on = await request(appFor({
      runStore: new InMemoryAgentRunStore(),
      attachmentStore: new InMemoryAgentAttachmentStore(),
    })).get('/api/agent/v3/status');
    expect(on.status).toBe(200);
    expect(on.body.attachmentsEnabled).toBe(true);

    const off = await request(appFor({
      runStore: new InMemoryAgentRunStore(),
      attachmentStore: new InMemoryAgentAttachmentStore(),
    }, offEnv)).get('/api/agent/v3/status');
    expect(off.status).toBe(200);
    expect(off.body.attachmentsEnabled).toBe(false);
  });
});
