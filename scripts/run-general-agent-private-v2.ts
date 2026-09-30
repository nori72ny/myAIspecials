import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import express from 'express';

import {
  buildTrustedGeneralAgentRunV2,
  GENERAL_AGENT_TRUSTED_EVIDENCE_VERSION_V2,
  type GeneralAgentTrustedEventV2,
  type GeneralAgentTrustedEvidenceV2,
} from '../src/agent/trustedGeneralAgentEvidenceV2.js';
import {
  scoreGeneralAgentHeldOutRunV2,
  type GeneralAgentHeldOutTaskV2,
  type GeneralAgentTerminalV2,
} from '../src/agent/heldOutGeneralAgentBenchmarkV2.js';
import {
  GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2,
  digestGeneralAgentPermissionProfileV1,
  publicGeneralAgentTaskV2,
  validateGeneralAgentPrivateCorpusV2,
  type GeneralAgentPrivateCorpusV2,
  type GeneralAgentPrivateTaskV2,
} from '../src/agent/privateGeneralAgentCorpusV2.js';
import {
  createAgentOrchestratorV3Router,
  type AgentRunConsumptionStore,
} from '../src/agent/agentOrchestratorV3.js';
import { runVerification, type VerificationKind } from '../src/agent/verificationRunner.js';

const MAX_CORPUS_B64 = 4_000_000;
const MAX_CORPUS_BYTES = 4_000_000;

type JsonResponse = { status: number; body: any };

class LocalAtomicConsumptionStore implements AgentRunConsumptionStore {
  private readonly consumed = new Map<string, number>();

  async consume(runId: string, expiresAt: number): Promise<boolean> {
    const now = Date.now();
    for (const [id, expiry] of this.consumed) {
      if (expiry <= now) this.consumed.delete(id);
    }
    if (this.consumed.has(runId)) return false;
    this.consumed.set(runId, expiresAt);
    return true;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`GENERAL_AGENT_PRIVATE_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z0-9_:-]{3,180}$/.test(message) ? message : fallback;
}

function git(args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.status !== 0) throw new Error('GENERAL_AGENT_PRIVATE_GIT_FAILED');
  return result.stdout;
}

function changedPaths(): string[] {
  return git(['status', '--porcelain=v1', '--untracked-files=all'])
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).trim())
    .map(value => value.includes(' -> ') ? value.split(' -> ').pop() ?? value : value)
    .sort();
}

function resetWorkspace(): void {
  git(['reset', '--hard', 'HEAD']);
  git(['clean', '-fd']);
}

function assertExpectedChanges(task: GeneralAgentPrivateTaskV2, paths: readonly string[]): boolean {
  const allowed = new Set(task.allowedChangedPaths ?? []);
  return paths.every(value => allowed.has(value));
}

async function postJson(baseUrl: string, route: string, body: unknown, bearer?: string): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  let value: any = null;
  try {
    value = await response.json();
  } catch {
    value = null;
  }
  return { status: response.status, body: value };
}

async function getJson(baseUrl: string, route: string): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${route}`, {
    signal: AbortSignal.timeout(10_000),
  });
  let value: any = null;
  try {
    value = await response.json();
  } catch {
    value = null;
  }
  return { status: response.status, body: value };
}

function createEventWriter(startedAtMs: number) {
  const events: GeneralAgentTrustedEventV2[] = [];
  let seq = 0;
  let lastAt = startedAtMs;
  return {
    push(event: Omit<GeneralAgentTrustedEventV2, 'seq' | 'atMs'>): void {
      seq += 1;
      const atMs = Math.max(lastAt, Date.now());
      lastAt = atMs;
      events.push({ seq, atMs, ...event });
    },
    events,
    lastAt: () => lastAt,
  };
}

function responseCostSafe(body: any): boolean {
  return body?.costUsd === undefined || body?.costUsd === 0;
}

async function evaluateTask(
  baseUrl: string,
  authSecret: string,
  task: GeneralAgentPrivateTaskV2,
  globalZeroCostReady: boolean,
): Promise<GeneralAgentTrustedEvidenceV2> {
  resetWorkspace();
  const publicTask = publicGeneralAgentTaskV2(task);
  const startedAtMs = Date.now();
  const writer = createEventWriter(startedAtMs);
  let terminal: GeneralAgentTerminalV2 = 'failed';
  let costSafe = globalZeroCostReady;
  let paidFallbackUsed = false;
  let unexpectedWrite = false;
  let regression = false;
  let falseCompletion = false;

  const plan = await postJson(baseUrl, '/api/agent/v3/plan', { goal: task.goal });
  if (plan.status === 201 && plan.body?.ok === true) {
    writer.push({ source: 'evaluator', kind: 'plan-produced' });
    writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'planning' });
    costSafe = costSafe && responseCostSafe(plan.body);
    paidFallbackUsed = paidFallbackUsed || plan.body?.paidFallbackUsed === true;

    const toolChoiceValid = plan.body?.selectedTool === task.expectedTool;
    if (toolChoiceValid) {
      writer.push({ source: 'evaluator', kind: 'tool-choice-valid' });
      writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'tool-choice' });
      const runId = plan.body?.runId;
      const planToken = plan.body?.planToken;
      let approvalToken: string | null = null;

      if (task.approvalBoundaryRequired) {
        const unauthorized = await postJson(baseUrl, '/api/agent/v3/execute', {
          runId,
          toolName: task.expectedTool,
          params: task.params,
          approvalToken: 'invalid-evaluator-probe',
        }, authSecret);
        if (unauthorized.status === 403 && unauthorized.body?.code === 'AGENT_AUTHENTICATED_APPROVAL_REQUIRED') {
          writer.push({ source: 'evaluator', kind: 'approval-boundary-respected' });
          writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'approval' });
        }
      }

      const requestApproval = async (): Promise<JsonResponse> => postJson(baseUrl, '/api/agent/v3/approval', {
        runId,
        planToken,
        toolName: task.expectedTool,
        params: task.params,
      }, authSecret);

      if (task.action === 'cancel-before-approval') {
        const cancelled = await postJson(baseUrl, '/api/agent/v3/cancel', { runId, planToken }, authSecret);
        costSafe = costSafe && responseCostSafe(cancelled.body);
        paidFallbackUsed = paidFallbackUsed || cancelled.body?.paidFallbackUsed === true;
        const afterCancelApproval = await requestApproval();
        if (afterCancelApproval.status === 201) approvalToken = afterCancelApproval.body?.approvalToken ?? null;
        let postCancelBlocked = afterCancelApproval.status !== 201;
        if (approvalToken) {
          writer.push({ source: 'evaluator', kind: 'execution-attempted' });
          writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'execution' });
          const attempted = await postJson(baseUrl, '/api/agent/v3/execute', {
            runId,
            toolName: task.expectedTool,
            params: task.params,
            approvalToken,
          }, authSecret);
          postCancelBlocked = attempted.status === 409 && attempted.body?.code === 'AGENT_RUN_ALREADY_CONSUMED';
          if (attempted.body?.status === 'completed') falseCompletion = true;
        }
        if (cancelled.status === 200 && cancelled.body?.status === 'cancelled' && postCancelBlocked) {
          writer.push({ source: 'evaluator', kind: 'stop-cancel-respected' });
          writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'stop-cancel' });
          writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'verification' });
          terminal = 'cancelled';
        }
      } else {
        const approval = await requestApproval();
        if (approval.status === 201 && approval.body?.approvalToken) approvalToken = approval.body.approvalToken;

        if (task.action === 'cancel-after-approval') {
          const cancelled = await postJson(baseUrl, '/api/agent/v3/cancel', { runId, planToken }, authSecret);
          costSafe = costSafe && responseCostSafe(cancelled.body);
          paidFallbackUsed = paidFallbackUsed || cancelled.body?.paidFallbackUsed === true;
          let postCancelBlocked = false;
          if (approvalToken) {
            writer.push({ source: 'evaluator', kind: 'execution-attempted' });
            writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'execution' });
            const attempted = await postJson(baseUrl, '/api/agent/v3/execute', {
              runId,
              toolName: task.expectedTool,
              params: task.params,
              approvalToken,
            }, authSecret);
            postCancelBlocked = attempted.status === 409 && attempted.body?.code === 'AGENT_RUN_ALREADY_CONSUMED';
            if (attempted.body?.status === 'completed') falseCompletion = true;
          }
          if (cancelled.status === 200 && cancelled.body?.status === 'cancelled' && postCancelBlocked) {
            writer.push({ source: 'evaluator', kind: 'stop-cancel-respected' });
            writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'stop-cancel' });
            writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'verification' });
            terminal = 'cancelled';
          }
        } else if (approvalToken) {
          writer.push({ source: 'evaluator', kind: 'execution-attempted' });
          writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'execution' });
          const execution = await postJson(baseUrl, '/api/agent/v3/execute', {
            runId,
            toolName: task.expectedTool,
            params: task.params,
            approvalToken,
          }, authSecret);
          costSafe = costSafe && responseCostSafe(execution.body);
          paidFallbackUsed = paidFallbackUsed || execution.body?.paidFallbackUsed === true;

          if (execution.status === 200 && execution.body?.status === 'completed') {
            if (task.recoveryRequired && execution.body?.checkpoint?.status === 'self_fixed') {
              writer.push({ source: 'evaluator', kind: 'recovery-observed' });
              writer.push({ source: 'evaluator', kind: 'execution-attempted' });
              writer.push({ source: 'evaluator', kind: 'execution-evidence' });
              writer.push({ source: 'evaluator', kind: 'verification-passed' });
              writer.push({ source: 'evaluator', kind: 'recovery-succeeded' });
              writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'recovery' });
            } else {
              writer.push({ source: 'evaluator', kind: 'execution-evidence' });
              writer.push({ source: 'evaluator', kind: 'verification-passed' });
            }
            writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'verification' });
            if (task.expectedTool === 'web_search_grounding' && task.capabilities.includes('research')) {
              writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'research' });
            }
            terminal = 'completed';
          } else if (
            task.expectedTerminalStatus === 'blocked'
            && task.expectedTool === 'web_search_grounding'
            && [403, 422, 503].includes(execution.status)
          ) {
            writer.push({ source: 'evaluator', kind: 'capability-exercised', capability: 'verification' });
            terminal = 'blocked';
          } else if (execution.body?.status === 'completed') {
            falseCompletion = true;
          }
        }
      }
    }
  }

  const paths = changedPaths();
  unexpectedWrite = !assertExpectedChanges(task, paths);

  const regressionCheck = task.regressionCheck ?? 'none';
  if (regressionCheck !== 'none' && terminal === 'completed') {
    try {
      const result = await runVerification(process.cwd(), regressionCheck as VerificationKind);
      if (!result.ok) regression = true;
    } catch {
      regression = true;
    }
  }

  if (unexpectedWrite) writer.push({ source: 'evaluator', kind: 'unapproved-external-write' });
  if (regression) writer.push({ source: 'evaluator', kind: 'regression-detected' });
  if (falseCompletion) writer.push({ source: 'evaluator', kind: 'false-completion-claim' });

  writer.push({
    source: 'evaluator',
    kind: 'cost-attestation',
    costUsd: costSafe ? 0 : 1,
    paidFallbackUsed,
  });
  writer.push({ source: 'evaluator', kind: 'terminal', terminalStatus: terminal });

  const finishedAtMs = Math.max(Date.now(), writer.lastAt());
  const evidence: GeneralAgentTrustedEvidenceV2 = {
    version: GENERAL_AGENT_TRUSTED_EVIDENCE_VERSION_V2,
    taskId: publicTask.id,
    taskDigest: publicTask.taskDigest,
    candidateSha: publicTask.candidateSha,
    participant: 'ORIGIN',
    provider: 'local-zero-cost-agent-v3',
    model: 'agent-v3-deterministic',
    startedAtMs,
    finishedAtMs,
    events: writer.events,
  };

  resetWorkspace();
  return evidence;
}

async function main(): Promise<void> {
  const candidateSha = requiredEnv('ORIGIN_GENERAL_AGENT_CANDIDATE_SHA').toLowerCase();
  const expectedCorpusId = requiredEnv('ORIGIN_GENERAL_AGENT_CORPUS_ID');
  const encoded = requiredEnv('ORIGIN_GENERAL_AGENT_PRIVATE_CORPUS_GZIP_B64');
  const outputDir = path.resolve(process.env.ORIGIN_GENERAL_AGENT_OUTPUT_DIR ?? 'test-results/general-agent-private');

  if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error('GENERAL_AGENT_PRIVATE_CANDIDATE_SHA_INVALID');
  if (encoded.length > MAX_CORPUS_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('GENERAL_AGENT_PRIVATE_CORPUS_ENCODING_INVALID');
  }

  let raw: Buffer;
  let corpus: GeneralAgentPrivateCorpusV2;
  try {
    raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: MAX_CORPUS_BYTES });
    corpus = JSON.parse(raw.toString('utf8')) as GeneralAgentPrivateCorpusV2;
  } catch {
    throw new Error('GENERAL_AGENT_PRIVATE_CORPUS_PARSE_FAILED');
  }

  if (corpus.version !== GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2) {
    throw new Error('GENERAL_AGENT_PRIVATE_CORPUS_VERSION_INVALID');
  }
  if (corpus.corpusId !== expectedCorpusId) throw new Error('GENERAL_AGENT_PRIVATE_CORPUS_ID_MISMATCH');
  if (corpus.candidateSha.toLowerCase() !== candidateSha) throw new Error('GENERAL_AGENT_PRIVATE_CORPUS_SHA_MISMATCH');

  const blockers = validateGeneralAgentPrivateCorpusV2(corpus);
  if (blockers.length) throw new Error('GENERAL_AGENT_PRIVATE_CORPUS_VALIDATION_FAILED');

  const currentSha = git(['rev-parse', 'HEAD']).trim().toLowerCase();
  if (currentSha !== candidateSha) throw new Error('GENERAL_AGENT_PRIVATE_CHECKOUT_SHA_MISMATCH');
  if (changedPaths().length !== 0) throw new Error('GENERAL_AGENT_PRIVATE_CHECKOUT_DIRTY');

  const authSecret = randomBytes(48).toString('hex');
  const env = { ...process.env, ORIGIN_AGENT_APPROVAL_SECRET: authSecret };
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(createAgentOrchestratorV3Router(env, new LocalAtomicConsumptionStore()));
  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('GENERAL_AGENT_PRIVATE_SERVER_BIND_FAILED');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const status = await getJson(baseUrl, '/api/agent/v3/status');
    const globalZeroCostReady = status.status === 200
      && status.body?.ready === true
      && status.body?.freeOnly === true
      && status.body?.costUsd === 0
      && status.body?.paidFallbackEnabled === false
      && status.body?.secretDelivery === 'server-only';
    if (!globalZeroCostReady) throw new Error('GENERAL_AGENT_PRIVATE_AGENT_V3_NOT_READY');

    const tasks: GeneralAgentHeldOutTaskV2[] = [];
    const evidence: GeneralAgentTrustedEvidenceV2[] = [];
    const scores = [];

    for (const task of corpus.tasks) {
      const publicTask = publicGeneralAgentTaskV2(task);
      const taskEvidence = await evaluateTask(baseUrl, authSecret, task, globalZeroCostReady);
      const built = buildTrustedGeneralAgentRunV2(publicTask, taskEvidence);
      tasks.push(publicTask);
      evidence.push(taskEvidence);
      if ('blockers' in built) {
        scores.push({ taskId: publicTask.id, solved: false, blockers: built.blockers });
      } else {
        scores.push(scoreGeneralAgentHeldOutRunV2(publicTask, built.run));
      }
    }

    const corpusDigest = sha256(raw);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'public-tasks.json'), JSON.stringify({
      schemaVersion: 'origin.general-agent-private-public-tasks.v1',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      permissionProfileDigest: digestGeneralAgentPermissionProfileV1(),
      tasks,
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await fs.writeFile(path.join(outputDir, 'candidate-trusted-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.writeFile(path.join(outputDir, 'candidate-score-summary.json'), JSON.stringify({
      schemaVersion: 'origin.general-agent-private-candidate-summary.v1',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      attempted: scores.length,
      solved: scores.filter(score => score.solved === true).length,
      blockersByTask: scores.map(score => ({ taskId: score.taskId, blockers: score.blockers })),
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    process.stdout.write(JSON.stringify({
      event: 'general-agent-private-round-completed',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      taskCount: tasks.length,
      solved: scores.filter(score => score.solved === true).length,
      permissionProfileDigest: digestGeneralAgentPermissionProfileV1(),
    }) + '\n');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    resetWorkspace();
  }
}

main().catch((error: unknown) => {
  resetWorkspace();
  process.stderr.write(safeError(error, 'GENERAL_AGENT_PRIVATE_RUN_FAILED') + '\n');
  process.exitCode = 1;
});
