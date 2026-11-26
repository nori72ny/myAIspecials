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

/** The staged ALE K8s RCA goal, verbatim: its backtick-quoted
 * Deployment name `payment-api` became a file_reader path in the
 * production plan and blocked the run (2026-11-21). */
const K8S_GOAL = "添付ファイルが input です。成果物は指定されたファイル名・形式のファイルとして作成してください。パスの指定はファイル名の指定として読み替えてください。\n\n# Kubernetes Payment API Root-Cause Analysis\n\nYou are the on-call SRE for Northwind Payments. The `payment-api` Deployment in\nthe `prod` namespace started flapping after a routine chart-value change. The\nHPA reports memory utilization above target and dashboards show elevated 5xx errors.\n\n## Visible Inputs\n\nAll evidence files are in `input/`:\n\n- `cluster_state.txt`: captured kubectl pod, deployment, event, top, and HPA output.\n- `deployment.yaml`: currently applied Deployment and HPA YAML.\n- `failing_pod.log`: stdout from a crashing payment-api pod across two restart cycles.\n\n## Required Output\n\nWrite exactly one JSON file:\n\n```text\noutput/root_cause_analysis.json\n```\n\nThe JSON report must include these top-level keys:\n\n```text\nincident_metadata, root_causes, affected_resources, remediation_plan, summary\n```\n\n### Schema details\n\n**`incident_metadata`** — object with at least:\n- `safe_to_rollback` (boolean): whether rolling back to the previous ReplicaSet revision is safe.\n\n**`root_causes`** — array of objects, each with at least:\n- `type` (string): short classification label, e.g. `\"OOMKilled\"`, `\"liveness_probe_too_aggressive\"`, `\"missing_metrics_port_env\"`.\n- `severity` (string): one of `\"critical\"`, `\"high\"`, `\"medium\"`, `\"low\"`.\n- `description` (string): explanation of the root cause.\n- `evidence` (array of strings): each item must be a verbatim text string copied from one of the visible input files (not a file-name citation — the actual text that appears in the file).\n\n**`affected_resources`** — array of objects, each with `kind`, `name`, and `namespace`.\n\n**`remediation_plan`** — array of objects, each with at least an `action` (string).\n\n**`summary`** — string summarizing the incident and recommended path forward.\n\n### Guidelines\n\nIdentify root causes, list affected Kubernetes resources, propose prioritized\nremediation actions, and state whether rollback to the previous ReplicaSet is\nsafe. Do not invent metric values, commit SHAs, or resource names.";


/** The staged ALE M&A consistency-audit goal, verbatim: the
 * deterministic planner's research heuristic fired on the word
 * "search" in its staged-materials note and inserted a
 * web_search_grounding step (query = the whole goal text) into the
 * attachment-bound plan, so the driver refused approval in
 * production (2026-11-21, release bc1c1918). */
const MA_GOAL = "添付ファイルが input です。成果物は指定されたファイル名・形式のファイルとして作成してください。パスの指定はファイル名の指定として読み替えてください。\n\n# Task Brief\n\nReview four Chinese regulatory filings about the same share-transfer transaction and write an English inconsistency audit.\n\nDeliver exactly one file:\n\n- `output/audit_report.md`\n\nReport requirements:\n\n1. Write in English.\n2. Identify every material inconsistency you can support from the documents.\n3. For each finding, include:\n   - a short English title;\n   - a brief explanation of the conflict;\n   - the original Chinese text that proves the issue;\n   - a location marker with document name and page number.\n4. Do not invent issues that the documents do not support.\n\nAvailable staged materials:\n\n- `input/source_documents/` contains the original PDFs.\n- `input/extracted_text/` contains page-labeled UTF-8 text extracted from the PDFs for easier search.\n- `input/document_manifest.json` maps the canonical filenames to the original Chinese filenames.\n- `software/python` launches the baseline VM Python interpreter if scripting is helpful.\n\nSuggested output structure:\n\n```markdown\n# Share Transfer Disclosure Consistency Review\n\n## Finding 1: <title>\n- Documents: ...\n- Why it is inconsistent: ...\n- Evidence:\n  - `Document X, Page Y`: `<Chinese text>`\n  - `Document Z, Page W`: `<Chinese text>`\n```\n";

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

  it('drops a downstream file_writer from the augmented plan', async () => {
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    // The CSV wording makes the planner append a file_writer after the
    // document; augmentation removes writer steps outright (their only
    // target is the server's own repository — read-only in production,
    // and not the delivery path), so the grounded document closes the
    // plan and is the deliverable.
    const plan = await planWithAttachment(app, 'このCSVの各行を分類してレポートを作成してください', setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    expect(body.steps.map((step) => step.toolName)).toEqual(['attachment_reader', 'attachment_analyzer', 'document_generator']);
    expect(body.steps[2].params.dataGrounded).toBe(true);
    expect(body.steps.some((step) => step.toolName === 'file_writer')).toBe(false);
  });

  it('splits the analyzer at 2 chunks and chains the continuations', async () => {
    const lines = ['id,item,amount'];
    // ~41 chars per row. The primary-table estimated-output
    // budget (Basel 案A revised) prices each row at ~32 output
    // tokens, so a chunk packs 37 rows → 1,200 rows = 33 chunks
    // → 17 analyzer steps at the 2-chunk segment size. (The
    // character cap alone would pack ~85 rows per chunk — 15
    // chunks — whose per-chunk output runs to ~2,550 actual
    // tokens, over the completion budget the output budget
    // exists to protect.)
    for (let i = 0; i < 1200; i += 1) lines.push(`R-${String(i).padStart(4, '0')},${'x'.repeat(28)}${i % 10},${(i % 9) * 50}`);
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'big.csv', lines.join('\n'));
    const plan = await planWithAttachment(app, CLASSIFY_GOAL, setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    const analyzers = body.steps.filter((step) => step.toolName === 'attachment_analyzer');
    expect(analyzers.length).toBe(17);
    expect(analyzers[0].params.chunkOffset).toBe(0);
    expect(analyzers[0].params.chunkCount).toBe(2);
    expect(analyzers[1].params.chunkOffset).toBe(2);
    expect(analyzers[1].params.chunkCount).toBeGreaterThan(0);
    expect(analyzers[1].params.chunkCount).toBeLessThanOrEqual(2);
    expect(analyzers[1].params.contentFromStep).toBe(1);
    const document = body.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.contentFromStep).toBe(17);
    expect(document?.params.dataGrounded).toBe(true);
  });

  it('refuses a set needing more than 48 chunks at plan time', async () => {
    const lines = ['id,item,amount'];
    // ~41 chars per row → 4,500 rows ≈ 122 chunks at the
    // estimated-output packing (37 rows per chunk) > the
    // 48-chunk ceiling.
    for (let i = 0; i < 4500; i += 1) lines.push(`R-${String(i).padStart(4, '0')},${'x'.repeat(28)}${i % 10},${(i % 9) * 50}`);
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'huge.csv', lines.join('\n'));
    const plan = await planWithAttachment(app, CLASSIFY_GOAL, setId);
    expect(plan.status).toBe(422);
    expect(plan.body.code).toBe('AGENT_ATTACHMENT_TOO_LARGE');
    expect(plan.body.chunkCount).toBeGreaterThan(48);
    expect(plan.body.limit).toBe(48);
    expect(plan.body.limitKind).toBe('chunks');
  });

  it('plans, approves and creates a run for a 25+ chunk set whose plan needs 16 steps', async () => {
    const lines = ['id,item,amount'];
    // Same row shape as the chunk-split test (37 rows per chunk
    // at the estimated-output packing): 960 rows land at 26
    // chunks → 13 analyzers at the 2-chunk segment size. The
    // base plan's file_writer no longer survives augmentation,
    // so the augmented plan needs reader + 13 analyzers + 2
    // surviving base steps = 16 steps — refused outright by the
    // old flat ceiling of 6 (the production M&A refusal shape:
    // mid-size set, several analyzers on top of the goal's base
    // steps). The row count is calibrated to the output-budget
    // packing: the 2,100 rows this fixture used under the
    // character-only packing (~81 rows per chunk) now make 57
    // chunks and are refused by the 48-chunk ceiling — and that
    // old packing's per-chunk output itself exceeded the
    // completion budget, which is what the budget rule fixes.
    for (let i = 0; i < 960; i += 1) lines.push(`R-${String(i).padStart(4, '0')},${'x'.repeat(28)}${i % 10},${(i % 9) * 50}`);
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'big.csv', lines.join('\n'));
    const goal = 'このCSVの各行を分類してレポートを作成し、テストで検証してください';
    const plan = await planWithAttachment(app, goal, setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    const analyzers = body.steps.filter((step) => step.toolName === 'attachment_analyzer');
    expect(analyzers).toHaveLength(13);
    expect(body.steps).toHaveLength(16);
    // The raised ceiling is coherent across the flow: approval and
    // run creation accept the same 16 steps /plan issued.
    const created = await approveAndCreate(app, body, goal);
    expect(created.status).toBe(201);
  });

  it('keeps goal-text tokens out of file paths in an attachment-bound plan (K8s shape)', async () => {
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const createdSet = await request(app).post('/api/agent/v3/attachment-sets')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(createdSet.status).toBe(201);
    const setId = createdSet.body.attachmentSetId as string;
    const files: Array<[string, string]> = [
      ['cluster_state.txt', 'deployment.apps/payment-api 2/3 replicas available\npod/payment-api-7d9f 0/1 CrashLoopBackOff'],
      ['deployment.yaml', 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: payment-api'],
      ['failing_pod.log', 'payment-api starting\nFATAL: out of memory, exiting'],
    ];
    for (const [name, contentText] of files) {
      const added = await request(app).post(`/api/agent/v3/attachment-sets/${setId}/files`)
        .set('Authorization', `Bearer ${SECRET}`)
        .send({ name, mediaType: 'text/plain', contentText });
      expect(added.status).toBe(201);
    }
    const plan = await planWithAttachment(app, K8S_GOAL, setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    // Production's plan for this goal carried a file_reader step whose
    // path was the Deployment name; the step blocked the run at
    // execution. The reader is gone, and the file_writer step is
    // removed outright (attempt 3): in production it wrote into the
    // read-only deployment bundle and failed the run.
    expect(body.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'attachment_analyzer',
      'attachment_analyzer',
      'document_generator',
    ]);
    for (const step of body.steps) {
      expect(step.params.path).not.toBe('payment-api');
    }
    expect(body.steps.some((step) => step.toolName === 'file_writer')).toBe(false);
    const document = body.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.dataGrounded).toBe(true);
    // The goal specifies its deliverable (output/root_cause_analysis.json
    // with five required top-level keys): the plan carries the spec so
    // the document step assembles that JSON file instead of a
    // title-derived markdown document (ALE wave 1 scored the markdown
    // file 0). The analyzer reports the structured sections the
    // assembly reads.
    const analyzer = body.steps.find((step) => step.toolName === 'attachment_analyzer');
    expect(analyzer?.params.structuredJsonKeys).toEqual([
      'incident_metadata', 'root_causes', 'affected_resources', 'remediation_plan', 'summary',
    ]);
    expect(document?.params.format).toBe('json');
    expect(document?.params.outputFilename).toBe('root_cause_analysis.json');
    expect(document?.params.jsonTopLevelKeys).toEqual([
      'incident_metadata', 'root_causes', 'affected_resources', 'remediation_plan', 'summary',
    ]);
  });

  it('keeps heuristic research steps out of an attachment-bound plan (M&A shape)', async () => {
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const createdSet = await request(app).post('/api/agent/v3/attachment-sets')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({});
    expect(createdSet.status).toBe(201);
    const setId = createdSet.body.attachmentSetId as string;
    const files: Array<[string, string]> = [
      ['announcement.txt', 'Share transfer announcement. The price is RMB 10.00 per share.'],
      ['seller_report.txt', 'Seller report. The price is RMB 10.50 per share.'],
    ];
    for (const [name, contentText] of files) {
      const added = await request(app).post(`/api/agent/v3/attachment-sets/${setId}/files`)
        .set('Authorization', `Bearer ${SECRET}`)
        .send({ name, mediaType: 'text/plain', contentText });
      expect(added.status).toBe(201);
    }
    const plan = await planWithAttachment(app, MA_GOAL, setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    // Production's plan for this goal carried a web_search_grounding
    // step whose query was the entire goal text — inserted only
    // because the staged-materials note says "for easier search".
    // The audit is closed over the attached documents, so the step
    // is confined out; the rest of the plan shape is unchanged (the
    // writer step is likewise removed, per the attempt-3 fix).
    expect(body.steps.some((step) => step.toolName === 'web_search_grounding')).toBe(false);
    expect(body.steps.map((step) => step.toolName)).toEqual([
      'attachment_reader',
      'attachment_analyzer',
      'document_generator',
    ]);
    // The goal specifies its deliverable as output/audit_report.md:
    // the document step carries that file name so the artifact is
    // not a title-derived name.
    const document = body.steps.find((step) => step.toolName === 'document_generator');
    expect(document?.params.outputFilename).toBe('audit_report.md');
    expect(document?.params.format).toBe('markdown');
  });

  it('keeps a writer-only goal free of any file_writer step (analyzer bundle is the deliverable)', async () => {
    const app = appFor({ runStore: new InMemoryAgentRunStore(), attachmentStore: new InMemoryAgentAttachmentStore(), modelCall: classifyingExecutor });
    const setId = await createSetWithFile(app, 'fruits.csv', FRUITS);
    // This goal's base plan is writer-only (no document step): the
    // planner's file_writer carried fabricated sample CSV content.
    // Augmentation removes the writer step, so the fabricated content
    // can never be written anywhere and the analyzer bundle closes
    // the plan as the deliverable (design J1(a)).
    const plan = await planWithAttachment(app, '添付CSVを分類して簡単なCSV一覧を作って', setId);
    expect(plan.status).toBe(201);
    const body = plan.body as PlanBody;
    expect(body.steps.map((step) => step.toolName)).toEqual(['attachment_reader', 'attachment_analyzer']);
    expect(body.steps.some((step) => step.toolName === 'file_writer')).toBe(false);
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
