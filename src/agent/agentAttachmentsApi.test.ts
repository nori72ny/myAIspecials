// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import { InMemoryAgentAttachmentStore } from './agentAttachmentStoreMemory.fixture.js';
import { createOriginApp } from '../server/createOriginApp.js';

const SECRET = 'test-only-'.repeat(5);
const offEnv = { ORIGIN_AGENT_APPROVAL_SECRET: SECRET };
const onEnv = { ...offEnv, ORIGIN_AGENT_ATTACHMENTS_ENABLED: 'true' };
const browserEnv = { ...onEnv, APP_URL: 'https://example.test' };
const ORIGIN = { Origin: 'https://example.test' };
const MARKER = 'UNIQUE-ATTACHMENT-BODY-MARKER-7f3a';

function makeConsumptionStore() {
  const consumed = new Set<string>();
  const store: AgentRunConsumptionStore = {
    consume: vi.fn(async (runId: string) => {
      if (consumed.has(runId)) return false;
      consumed.add(runId);
      return true;
    }),
  };
  return { store, consumed };
}

/** Mirrors createOriginApp's mount order: the 8mb attachment parser
 * precedes the global JSON parser, which precedes the router. */
function appFor(
  testEnv: NodeJS.ProcessEnv,
  deps: { runStore?: InMemoryAgentRunStore; attachmentStore?: InMemoryAgentAttachmentStore } = {},
) {
  const { store: consumptionStore } = makeConsumptionStore();
  const app = express();
  app.use('/api/agent/v3/attachment-sets', express.json({ limit: '8mb' }));
  app.use(express.json());
  app.use(createAgentOrchestratorV3Router(testEnv, consumptionStore, {
    runStore: deps.runStore,
    attachmentStore: deps.attachmentStore,
  }));
  return app;
}

type CreatedSet = { attachmentSetId: string; uploadToken: string };

async function createSetAsOperator(app: express.Express): Promise<CreatedSet> {
  const created = await request(app).post('/api/agent/v3/attachment-sets')
    .set('Authorization', `Bearer ${SECRET}`)
    .send({});
  expect(created.status).toBe(201);
  expect(created.body.attachmentSetId).toMatch(/^att-/);
  expect(typeof created.body.uploadToken).toBe('string');
  return created.body as CreatedSet;
}

async function addFileAsOperator(app: express.Express, setId: string, name: string, contentText: string, mediaType = 'text/csv') {
  return request(app).post(`/api/agent/v3/attachment-sets/${setId}/files`)
    .set('Authorization', `Bearer ${SECRET}`)
    .send({ name, mediaType, contentText });
}

describe('agent v3 attachment sets API', () => {
  it('answers 503 on every attachment surface while the switch is off', async () => {
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor(offEnv, { attachmentStore });
    const setId = 'att-12345678-abcd-4ef0-9abc-def012345678';

    const created = await request(app).post('/api/agent/v3/attachment-sets')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(created.status).toBe(503);
    expect(created.body.code).toBe('AGENT_ATTACHMENTS_DISABLED');

    const added = await addFileAsOperator(app, setId, 'a.csv', 'x');
    expect(added.status).toBe(503);
    expect(added.body.code).toBe('AGENT_ATTACHMENTS_DISABLED');

    const fetched = await request(app).get(`/api/agent/v3/attachment-sets/${setId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(fetched.status).toBe(503);
    expect(fetched.body.code).toBe('AGENT_ATTACHMENTS_DISABLED');

    const deleted = await request(app).delete(`/api/agent/v3/attachment-sets/${setId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(deleted.status).toBe(503);

    const plan = await request(app).post('/api/agent/v3/plan')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ goal: 'Create a sales report.', attachmentSetId: setId });
    expect(plan.status).toBe(503);
    expect(plan.body.code).toBe('AGENT_ATTACHMENTS_DISABLED');
  });

  it('answers 503 when the switch is on but no attachment store is configured', async () => {
    const app = appFor(onEnv);
    const created = await request(app).post('/api/agent/v3/attachment-sets')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(created.status).toBe(503);
    expect(created.body.code).toBe('AGENT_ATTACHMENT_STORE_UNAVAILABLE');

    const plan = await request(app).post('/api/agent/v3/plan')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ goal: 'Create a sales report.', attachmentSetId: 'att-12345678-abcd-4ef0-9abc-def012345678' });
    expect(plan.status).toBe(503);
    expect(plan.body.code).toBe('AGENT_ATTACHMENT_STORE_UNAVAILABLE');
  });

  it('runs the operator flow end to end: create, add, get, plan binding, approval, run, delete', async () => {
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const runStore = new InMemoryAgentRunStore();
    const app = appFor(onEnv, { runStore, attachmentStore });

    const { attachmentSetId } = await createSetAsOperator(app);
    const first = await addFileAsOperator(app, attachmentSetId, 'sales.csv', `date,item\n2026-10-01,${MARKER}`);
    expect(first.status).toBe(201);
    expect(first.body.file).toMatchObject({ idx: 0, name: 'sales.csv', kind: 'text' });
    const second = await addFileAsOperator(app, attachmentSetId, 'notes.txt', '補足メモ', 'text/plain');
    expect(second.status).toBe(201);
    expect(second.body.file.idx).toBe(1);
    expect(second.body.fileCount).toBe(2);
    const setDigest = second.body.setDigest as string;
    expect(setDigest).toMatch(/^[0-9a-f]{64}$/);

    const fetched = await request(app).get(`/api/agent/v3/attachment-sets/${attachmentSetId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.attachmentSet.setDigest).toBe(setDigest);
    expect(fetched.body.attachmentSet.files).toHaveLength(2);
    // Metadata responses never carry a file body, an owner binding or
    // the upload token digest.
    expect(JSON.stringify(fetched.body)).not.toContain(MARKER);
    expect(JSON.stringify(fetched.body)).not.toContain('ownerBinding');
    expect(JSON.stringify(fetched.body)).not.toContain('uploadTokenDigest');

    const plan = await request(app).post('/api/agent/v3/plan')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ goal: 'Create a sales report.', attachmentSetId });
    expect(plan.status).toBe(201);
    expect(plan.body.attachments).toMatchObject({ setId: attachmentSetId, setDigest, fileCount: 2 });
    expect(plan.body.steps[0].params.attachmentSetId).toBe(attachmentSetId);
    expect(plan.body.steps[0].params.setDigest).toBe(setDigest);
    expect(JSON.stringify(plan.body)).not.toContain(MARKER);

    const approval = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.body.runId, planToken: plan.body.planToken, steps: plan.body.steps });
    expect(approval.status).toBe(201);

    const run = await request(app).post('/api/agent/v3/runs')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({
        runId: plan.body.runId,
        goal: 'Create a sales report.',
        planToken: plan.body.planToken,
        approvalToken: approval.body.approvalToken,
        steps: plan.body.steps,
      });
    expect(run.status).toBe(201);
    // The durable plan snapshot carries the binding, so the approved
    // record itself names the exact set contents it was approved for.
    expect(run.body.run.plan[0].params.attachmentSetId).toBe(attachmentSetId);
    expect(run.body.run.plan[0].params.setDigest).toBe(setDigest);

    const deleted = await request(app).delete(`/api/agent/v3/attachment-sets/${attachmentSetId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    const afterDelete = await request(app).get(`/api/agent/v3/attachment-sets/${attachmentSetId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(afterDelete.status).toBe(404);
    expect(afterDelete.body.code).toBe('AGENT_ATTACHMENT_SET_NOT_FOUND');
  });

  it('keeps plans without an attachment byte-identical whether the feature is on or off', async () => {
    const offApp = appFor(offEnv, { attachmentStore: new InMemoryAgentAttachmentStore() });
    const onApp = appFor(onEnv, { attachmentStore: new InMemoryAgentAttachmentStore() });
    const offPlan = await request(offApp).post('/api/agent/v3/plan').send({ goal: 'Create a sales report.' });
    const onPlan = await request(onApp).post('/api/agent/v3/plan').send({ goal: 'Create a sales report.' });
    expect(offPlan.status).toBe(201);
    expect(onPlan.status).toBe(201);
    expect(JSON.stringify(onPlan.body.steps)).toBe(JSON.stringify(offPlan.body.steps));
    expect(JSON.stringify(onPlan.body.params)).toBe(JSON.stringify(offPlan.body.params));
    expect(onPlan.body.attachments).toBeUndefined();
  });

  it('binds the digest chain: editing the bound digest fails approval, and adding a file changes the digest', async () => {
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor(onEnv, { attachmentStore });
    const { attachmentSetId } = await createSetAsOperator(app);
    await addFileAsOperator(app, attachmentSetId, 'a.csv', 'one');

    const plan = await request(app).post('/api/agent/v3/plan')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ goal: 'Create a sales report.', attachmentSetId });
    expect(plan.status).toBe(201);
    const firstDigest = plan.body.steps[0].params.setDigest as string;

    const tamperedSteps = plan.body.steps.map((step: { params: Record<string, unknown> }) => ({
      ...step,
      params: { ...step.params, setDigest: '0'.repeat(64) },
    }));
    const approval = await request(app).post('/api/agent/v3/approval')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ runId: plan.body.runId, planToken: plan.body.planToken, steps: tamperedSteps });
    expect(approval.status).toBe(403);
    expect(approval.body.code).toBe('AGENT_PLAN_PARAMS_MISMATCH');

    await addFileAsOperator(app, attachmentSetId, 'b.csv', 'two');
    const replanned = await request(app).post('/api/agent/v3/plan')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ goal: 'Create a sales report.', attachmentSetId });
    expect(replanned.status).toBe(201);
    expect(replanned.body.steps[0].params.setDigest).not.toBe(firstDigest);
  });

  it('supports the browser token flow and keeps browser sets invisible to the operator binding', async () => {
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor(browserEnv, { attachmentStore });

    const created = await request(app).post('/api/agent/v3/attachment-sets')
      .set(ORIGIN)
      .send({});
    expect(created.status).toBe(201);
    const { attachmentSetId, uploadToken } = created.body as CreatedSet;

    const added = await request(app).post(`/api/agent/v3/attachment-sets/${attachmentSetId}/files`)
      .set('x-agent-attachment-token', uploadToken)
      .send({ name: 'memo.txt', mediaType: 'text/plain', contentText: 'ブラウザからの添付' });
    expect(added.status).toBe(201);

    const fetched = await request(app).get(`/api/agent/v3/attachment-sets/${attachmentSetId}`)
      .set('x-agent-attachment-token', uploadToken);
    expect(fetched.status).toBe(200);
    expect(fetched.body.attachmentSet.fileCount).toBe(1);

    // The operator binding cannot see a browser-owned set, and the
    // browser token cannot see an operator-owned set either.
    const operatorPeek = await request(app).get(`/api/agent/v3/attachment-sets/${attachmentSetId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(operatorPeek.status).toBe(404);

    const deleted = await request(app).delete(`/api/agent/v3/attachment-sets/${attachmentSetId}`)
      .set('x-agent-attachment-token', uploadToken);
    expect(deleted.status).toBe(200);
    const afterDelete = await request(app).get(`/api/agent/v3/attachment-sets/${attachmentSetId}`)
      .set('x-agent-attachment-token', uploadToken);
    expect(afterDelete.status).toBe(404);
  });

  it('rejects unauthenticated, malformed and cross-set requests', async () => {
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor(onEnv, { attachmentStore });

    const unauthenticated = await request(app).post('/api/agent/v3/attachment-sets').send({});
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe('AGENT_AUTHENTICATION_REQUIRED');

    const { attachmentSetId, uploadToken } = await createSetAsOperator(app);
    const other = await createSetAsOperator(app);

    const badToken = await request(app).post(`/api/agent/v3/attachment-sets/${attachmentSetId}/files`)
      .set('x-agent-attachment-token', 'garbage.token')
      .send({ name: 'a.txt', contentText: 'x' });
    expect(badToken.status).toBe(403);
    expect(badToken.body.code).toBe('AGENT_ATTACHMENT_TOKEN_INVALID');

    const crossSet = await request(app).post(`/api/agent/v3/attachment-sets/${other.attachmentSetId}/files`)
      .set('x-agent-attachment-token', uploadToken)
      .send({ name: 'a.txt', contentText: 'x' });
    expect(crossSet.status).toBe(404);
    expect(crossSet.body.code).toBe('AGENT_ATTACHMENT_SET_NOT_FOUND');

    const malformed = await request(app).get('/api/agent/v3/attachment-sets/not-a-set')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('AGENT_ATTACHMENT_SET_ID_INVALID');

    const missing = await request(app).get('/api/agent/v3/attachment-sets/att-00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(missing.status).toBe(404);
  });

  it('rejects oversize, secret-bearing, unsupported and misnamed files with the numbers attached', async () => {
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor(onEnv, { attachmentStore });
    const { attachmentSetId } = await createSetAsOperator(app);

    const oversize = await addFileAsOperator(app, attachmentSetId, 'big.txt', 'a'.repeat(200_001), 'text/plain');
    expect(oversize.status).toBe(413);
    expect(oversize.body).toMatchObject({ code: 'AGENT_ATTACHMENT_FILE_TOO_LARGE', fileName: 'big.txt', charCount: 200_001, limit: 200_000 });

    const secret = await addFileAsOperator(app, attachmentSetId, 'config.txt', 'password = "hunter2"', 'text/plain');
    expect(secret.status).toBe(422);
    expect(secret.body.code).toBe('AGENT_ATTACHMENT_SECRET_CONTENT_BLOCKED');
    expect(JSON.stringify(secret.body)).not.toContain('hunter2');

    const binary = await addFileAsOperator(app, attachmentSetId, 'data.bin', 'raw', 'application/octet-stream');
    expect(binary.status).toBe(415);
    expect(binary.body.code).toBe('AGENT_ATTACHMENT_KIND_UNSUPPORTED');

    const spreadsheet = await addFileAsOperator(app, attachmentSetId, 'book.xlsx', 'raw', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(spreadsheet.status).toBe(415);

    const misnamed = await addFileAsOperator(app, attachmentSetId, 'dir/file.txt', 'x', 'text/plain');
    expect(misnamed.status).toBe(400);
    expect(misnamed.body.code).toBe('AGENT_ATTACHMENT_FILE_INVALID');

    // None of the rejected files landed in the set.
    const fetched = await request(app).get(`/api/agent/v3/attachment-sets/${attachmentSetId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(fetched.body.attachmentSet.fileCount).toBe(0);
  });

  it('rejects the file that would push the set past its total, with the totals attached', async () => {
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor(onEnv, { attachmentStore });
    const { attachmentSetId } = await createSetAsOperator(app);
    expect((await addFileAsOperator(app, attachmentSetId, 'p1.txt', 'a'.repeat(200_000), 'text/plain')).status).toBe(201);
    expect((await addFileAsOperator(app, attachmentSetId, 'p2.txt', 'b'.repeat(200_000), 'text/plain')).status).toBe(201);
    const overflow = await addFileAsOperator(app, attachmentSetId, 'p3.txt', 'c'.repeat(100_001), 'text/plain');
    expect(overflow.status).toBe(413);
    expect(overflow.body).toMatchObject({ code: 'AGENT_ATTACHMENT_SET_TOO_LARGE', fileName: 'p3.txt', totalChars: 500_001, limit: 500_000 });
  });

  it('refuses to bind an empty set into a plan', async () => {
    const attachmentStore = new InMemoryAgentAttachmentStore();
    const app = appFor(onEnv, { attachmentStore });
    const { attachmentSetId } = await createSetAsOperator(app);
    const plan = await request(app).post('/api/agent/v3/plan')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ goal: 'Create a sales report.', attachmentSetId });
    expect(plan.status).toBe(422);
    expect(plan.body.code).toBe('AGENT_ATTACHMENT_SET_EMPTY');
  });

  it('treats an expired set as absent', async () => {
    let current = Date.now();
    const attachmentStore = new InMemoryAgentAttachmentStore(() => current);
    const app = appFor(onEnv, { attachmentStore });
    const { attachmentSetId } = await createSetAsOperator(app);
    await addFileAsOperator(app, attachmentSetId, 'a.txt', 'short-lived');
    current += 24 * 60 * 60 * 1000 + 60_000;
    const fetched = await request(app).get(`/api/agent/v3/attachment-sets/${attachmentSetId}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(fetched.status).toBe(404);
    expect(fetched.body.code).toBe('AGENT_ATTACHMENT_SET_NOT_FOUND');
  });

  it('reaches the attachment handlers through the real app assembly', async () => {
    const app = createOriginApp({ ...onEnv });
    // No database URL is configured, so the store is absent — but the
    // request must reach the handler (503 store-unavailable), not die
    // at the global 64kb JSON boundary (413) or the catch-all 404.
    const created = await request(app).post('/api/agent/v3/attachment-sets')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(created.status).toBe(503);
    expect(created.body.code).toBe('AGENT_ATTACHMENT_STORE_UNAVAILABLE');

    const bigBody = await request(app).post('/api/agent/v3/attachment-sets/att-12345678-abcd-4ef0-9abc-def012345678/files')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ name: 'big.txt', mediaType: 'text/plain', contentText: 'a'.repeat(100_000) });
    expect(bigBody.status).toBe(503);
    expect(bigBody.body.code).toBe('AGENT_ATTACHMENT_STORE_UNAVAILABLE');
  });
});
