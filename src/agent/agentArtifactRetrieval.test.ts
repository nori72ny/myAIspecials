// @vitest-environment node
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { advanceAgentRun } from './agentRunAdvancer.js';
import { createAgentOrchestratorV3Router, type AgentRunConsumptionStore } from './agentOrchestratorV3.js';
import {
  computeAgentRunStepFingerprint,
  type AgentRunPlanStep,
  type PutAgentRunStepArtifactInput,
} from './agentRunRecord.js';
import { InMemoryAgentRunStore } from './agentRunStoreMemory.fixture.js';
import type { ToolName, ToolParams, ToolResult } from './toolRegistry.js';

/**
 * Artifact retrieval (design AGENT_ARTIFACT_RETRIEVAL_2026-11-23,
 * stages R-0/R-1): the final document step's artifact is persisted
 * with the completing progress write, and the F5-promised routes
 * return the run's artifacts — metadata only in the list, the stored
 * body verbatim in the entity route — under the runs authorization,
 * riding the step-artifact switch. The semantic matrix runs against
 * the in-memory store; the Postgres path is verified against a real
 * Postgres (PGlite) before this PR is reported.
 */

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const OPERATOR_BINDING = sha256('origin.agent.runs.owner.operator.v1');
const OTHER_BINDING = 'e'.repeat(64);
const SECRET = 'test-only-'.repeat(5);
const RUN_ID = 'run-artifact-retrieval-01';
const OTHER_RUN_ID = 'run-artifact-retrieval-02';
const DRIVER = 'driver-retrieval-1';
const T0 = 1_700_000_000_000;

const markdownEnvelope = JSON.stringify({
  kind: 'document',
  format: 'markdown',
  filename: 'audit_report.md',
  mimeType: 'text/markdown; charset=utf-8',
  bytes: Buffer.byteLength('## 所見 1\n\n本文です', 'utf8'),
  sha256: sha256('## 所見 1\n\n本文です'),
  verified: true,
  verification: ['non-empty', 'utf8-text'],
  content: '## 所見 1\n\n本文です',
});

const binaryEnvelope = JSON.stringify({
  kind: 'document',
  format: 'xlsx',
  filename: 'capital.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  bytes: 22_355,
  sha256: 'a'.repeat(64),
  verified: true,
  verification: ['non-empty', 'xlsx-package'],
});

const plan: AgentRunPlanStep[] = [
  { toolName: 'attachment_reader', params: { setId: 'set-1' }, dependsOn: [] },
  { toolName: 'attachment_analyzer', params: { chunkOffset: 0, chunkCount: 4 }, dependsOn: [0] },
  { toolName: 'document_generator', params: { contentFromStep: 1 }, dependsOn: [1] },
];

function artifactInput(stepIndex: number, artifact: string): PutAgentRunStepArtifactInput {
  return {
    stepIndex,
    stepFingerprint: computeAgentRunStepFingerprint(plan[stepIndex].toolName, plan[stepIndex].params),
    attempt: 1,
    artifact,
  };
}

async function seededStore(now: () => number, ownerBinding = OPERATOR_BINDING, runId = RUN_ID) {
  const store = new InMemoryAgentRunStore(now);
  const created = await store.create({
    runId,
    ownerBinding,
    goal: 'Audit the attachments and produce a report',
    status: 'queued',
    plan,
    planDigest: 'c'.repeat(64),
    expiresAt: now() + 3_600_000,
  }, now());
  expect(created?.status).toBe('queued');
  const lease = await store.claim(runId, DRIVER, 300);
  expect(lease?.driverId).toBe(DRIVER);
  return store;
}

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

function appFor(store: InMemoryAgentRunStore, envOverrides: NodeJS.ProcessEnv = {}) {
  const env = {
    ORIGIN_AGENT_APPROVAL_SECRET: SECRET,
    ORIGIN_AGENT_STEP_ARTIFACTS_ENABLED: 'true',
    ...envOverrides,
  } as NodeJS.ProcessEnv;
  const app = express();
  app.use(express.json());
  app.use(createAgentOrchestratorV3Router(env, makeConsumptionStore(), { runStore: store }));
  return app;
}

const asOperator = (req: request.Test) => req.set('Authorization', `Bearer ${SECRET}`);

describe('artifact retrieval routes (R-1)', () => {
  it('lists metadata only, with the deliverable distinguished and entity presence explicit', async () => {
    const store = await seededStore(() => T0);
    await store.updateProgress(RUN_ID, DRIVER, {
      artifacts: [artifactInput(0, 'extracted attachment text'), artifactInput(2, markdownEnvelope)],
    });
    const res = await asOperator(request(appFor(store)).get(`/api/agent/v3/runs/${RUN_ID}/artifacts`));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.artifacts).toHaveLength(2);
    const [reader, deliverable] = res.body.artifacts;
    // A non-envelope intermediate: no declared metadata, but the
    // stored body itself is the retrievable entity.
    expect(reader).toMatchObject({
      stepIndex: 0, kind: 'intermediate', format: null, filename: null,
      bytes: null, sha256: null, verified: null, hasContent: true,
      artifactBytes: Buffer.byteLength('extracted attachment text', 'utf8'),
      artifactSha256: sha256('extracted attachment text'),
    });
    expect(deliverable).toMatchObject({
      stepIndex: 2, kind: 'deliverable', format: 'markdown', filename: 'audit_report.md',
      mimeType: 'text/markdown; charset=utf-8',
      bytes: Buffer.byteLength('## 所見 1\n\n本文です', 'utf8'),
      sha256: sha256('## 所見 1\n\n本文です'),
      verified: true, hasContent: true,
      artifactBytes: Buffer.byteLength(markdownEnvelope, 'utf8'),
      artifactSha256: sha256(markdownEnvelope),
    });
    // The list never carries a body.
    expect(JSON.stringify(res.body)).not.toContain('本文です');
    expect(JSON.stringify(res.body)).not.toContain('extracted attachment text');
  });

  it('marks a binary deliverable envelope as carrying no retrievable entity yet', async () => {
    const store = await seededStore(() => T0);
    await store.updateProgress(RUN_ID, DRIVER, { artifacts: [artifactInput(2, binaryEnvelope)] });
    const res = await asOperator(request(appFor(store)).get(`/api/agent/v3/runs/${RUN_ID}/artifacts`));
    expect(res.status).toBe(200);
    expect(res.body.artifacts).toHaveLength(1);
    expect(res.body.artifacts[0]).toMatchObject({
      stepIndex: 2, kind: 'deliverable', format: 'xlsx', verified: true, hasContent: false,
    });
  });

  it('returns the stored body verbatim from the entity route', async () => {
    const store = await seededStore(() => T0);
    await store.updateProgress(RUN_ID, DRIVER, {
      artifacts: [artifactInput(0, 'extracted attachment text'), artifactInput(2, markdownEnvelope)],
    });
    const app = appFor(store);
    const envelopeRes = await asOperator(request(app).get(`/api/agent/v3/runs/${RUN_ID}/artifacts/2`));
    expect(envelopeRes.status).toBe(200);
    expect(envelopeRes.headers['content-type']).toContain('application/json');
    expect(envelopeRes.text).toBe(markdownEnvelope);
    const textRes = await asOperator(request(app).get(`/api/agent/v3/runs/${RUN_ID}/artifacts/0`));
    expect(textRes.status).toBe(200);
    expect(textRes.headers['content-type']).toContain('text/plain');
    expect(textRes.text).toBe('extracted attachment text');
  });

  it('answers 404 for a step with no saved artifact and 400 for a malformed step index', async () => {
    const store = await seededStore(() => T0);
    await store.updateProgress(RUN_ID, DRIVER, { artifacts: [artifactInput(2, markdownEnvelope)] });
    const app = appFor(store);
    const missing = await asOperator(request(app).get(`/api/agent/v3/runs/${RUN_ID}/artifacts/1`));
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('AGENT_RUN_ARTIFACT_NOT_FOUND');
    const malformed = await asOperator(request(app).get(`/api/agent/v3/runs/${RUN_ID}/artifacts/abc`));
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('AGENT_RUN_ARTIFACT_INPUT_INVALID');
    const tooLarge = await asOperator(request(app).get(`/api/agent/v3/runs/${RUN_ID}/artifacts/20`));
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.code).toBe('AGENT_RUN_ARTIFACT_INPUT_INVALID');
  });

  it('hides another owner\'s run behind the same 404 as a missing run', async () => {
    const store = await seededStore(() => T0, OTHER_BINDING, OTHER_RUN_ID);
    await store.updateProgress(OTHER_RUN_ID, DRIVER, { artifacts: [artifactInput(2, markdownEnvelope)] });
    const app = appFor(store);
    const list = await asOperator(request(app).get(`/api/agent/v3/runs/${OTHER_RUN_ID}/artifacts`));
    expect(list.status).toBe(404);
    expect(list.body.code).toBe('AGENT_RUN_NOT_FOUND');
    const entity = await asOperator(request(app).get(`/api/agent/v3/runs/${OTHER_RUN_ID}/artifacts/2`));
    expect(entity.status).toBe(404);
    expect(entity.body.code).toBe('AGENT_RUN_NOT_FOUND');
  });

  it('requires authentication', async () => {
    const store = await seededStore(() => T0);
    const res = await request(appFor(store)).get(`/api/agent/v3/runs/${RUN_ID}/artifacts`);
    expect(res.status).toBe(401);
  });

  it('answers 404 on both routes while the step-artifact switch is off', async () => {
    const store = await seededStore(() => T0);
    await store.updateProgress(RUN_ID, DRIVER, { artifacts: [artifactInput(2, markdownEnvelope)] });
    const app = appFor(store, { ORIGIN_AGENT_STEP_ARTIFACTS_ENABLED: 'false' });
    const list = await asOperator(request(app).get(`/api/agent/v3/runs/${RUN_ID}/artifacts`));
    expect(list.status).toBe(404);
    const entity = await asOperator(request(app).get(`/api/agent/v3/runs/${RUN_ID}/artifacts/2`));
    expect(entity.status).toBe(404);
  });

  it('stops serving artifacts once their retention passes', async () => {
    let current = T0;
    const store = await seededStore(() => current);
    await store.updateProgress(RUN_ID, DRIVER, { artifacts: [artifactInput(2, markdownEnvelope)] });
    current += 3_600_001;
    // Artifact rows carry a copy of their run's expiry, so past
    // retention the run itself reads as gone (both stores filter on
    // it) and the artifacts are invisible with it.
    const res = await asOperator(request(appFor(store)).get(`/api/agent/v3/runs/${RUN_ID}/artifacts`));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('AGENT_RUN_NOT_FOUND');
    const entity = await asOperator(request(appFor(store)).get(`/api/agent/v3/runs/${RUN_ID}/artifacts/2`));
    expect(entity.status).toBe(404);
  });
});

describe('deliverable persistence round trip (R-1)', () => {
  it('saves the final document with the completing advance and serves it through the routes', async () => {
    const clock = T0;
    const store = new InMemoryAgentRunStore(() => clock);
    const chainPlan: AgentRunPlanStep[] = [
      { toolName: 'file_reader', params: { path: 'notes.txt' }, dependsOn: [] },
      { toolName: 'document_generator', params: { contentFromStep: 0 }, dependsOn: [0] },
    ];
    const created = await store.create({
      runId: RUN_ID,
      ownerBinding: OPERATOR_BINDING,
      goal: 'Read the notes and produce the report',
      status: 'queued',
      plan: chainPlan,
      planDigest: 'c'.repeat(64),
      stepsState: chainPlan.map((_, index) => ({ id: `task-${index + 1}`, status: 'queued' as const, attempts: 0 })),
      expiresAt: clock + 3_600_000,
    }, clock);
    expect(created?.status).toBe('queued');
    const runTool = vi.fn(async (name: ToolName, _input: ToolParams): Promise<ToolResult> => {
      if (name === 'file_reader') return { ok: true, tool: name, artifact: 'FILE TEXT', message: 'ok' };
      if (name === 'document_generator') return { ok: true, tool: name, artifact: markdownEnvelope, message: 'ok' };
      return { ok: true, tool: name, artifact: `artifact:${name}`, message: 'ok' };
    });
    const outcome = await advanceAgentRun(
      {
        runStore: store,
        consumptionStore: makeConsumptionStore(),
        runTool,
        verifyArtifact: async (artifact: string) => ({ ok: true, artifact, attempts: 0 }),
        verifyCompletion: async () => ({ ok: true }),
        now: () => clock,
        stepArtifactsEnabled: true,
      },
      created!,
      'driver-round-trip',
      { budgetMs: 60_000, leaseSeconds: 300 },
    );
    expect(outcome.kind).toBe('completed');
    const saved = await store.listStepArtifacts(RUN_ID);
    expect(saved.map((row) => row.stepIndex)).toEqual([0, 1]);

    const app = appFor(store);
    const list = await asOperator(request(app).get(`/api/agent/v3/runs/${RUN_ID}/artifacts`));
    expect(list.status).toBe(200);
    expect(list.body.artifacts.map((entry: { stepIndex: number; kind: string }) => [entry.stepIndex, entry.kind]))
      .toEqual([[0, 'intermediate'], [1, 'deliverable']]);
    const entity = await asOperator(request(app).get(`/api/agent/v3/runs/${RUN_ID}/artifacts/1`));
    expect(entity.status).toBe(200);
    expect(entity.text).toBe(markdownEnvelope);
    const parsed = JSON.parse(entity.text) as { content: string; sha256: string; bytes: number };
    expect(sha256(parsed.content)).toBe(parsed.sha256);
    expect(Buffer.byteLength(parsed.content, 'utf8')).toBe(parsed.bytes);
  });
});
