import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import {
  GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2,
  digestGeneralAgentPermissionProfileV1,
  digestGeneralAgentPrivateTaskV2,
  type GeneralAgentPrivateCorpusV2,
  type GeneralAgentPrivateTaskV2,
} from '../src/agent/privateGeneralAgentCorpusV2.js';
import { GENERAL_AGENT_HELD_OUT_VERSION_V2 } from '../src/agent/heldOutGeneralAgentBenchmarkV2.js';

const execute = promisify(execFile);

function baseTask(index: number, candidateSha: string): Omit<GeneralAgentPrivateTaskV2, 'taskDigest'> {
  const recovery = index < 3;
  const approval = index < 2;
  const stop = index >= 3 && index < 5;
  const research = index === 5;
  const tool = recovery
    ? 'code_interpreter'
    : stop
      ? 'document_generator'
      : research
        ? 'web_search_grounding'
        : 'repository_explorer';
  const capabilities = new Set<GeneralAgentPrivateTaskV2['capabilities'][number]>([
    'planning',
    'tool-choice',
    'verification',
    'execution',
  ]);
  if (research) capabilities.add('research');
  if (recovery) capabilities.add('recovery');
  if (approval) capabilities.add('approval');
  if (stop) capabilities.add('stop-cancel');

  return {
    version: GENERAL_AGENT_HELD_OUT_VERSION_V2,
    id: `internal-live-agent-${String(index + 1).padStart(2, '0')}`,
    candidateSha,
    timeBudgetMs: 120_000,
    capabilities: [...capabilities],
    expectedTerminalStatus: stop ? 'cancelled' : 'completed',
    recoveryRequired: recovery,
    approvalBoundaryRequired: approval,
    stopCancelRequired: stop,
    goal: recovery
      ? 'Analyze this malformed code snippet and return a repaired local artifact.'
      : stop
        ? 'Create a local document artifact and stop when cancelled.'
        : research
          ? 'Research a current public topic using the available grounded search tool.'
          : 'Inspect the repository structure without external network access.',
    expectedTool: tool,
    params: recovery
      ? { code: 'function demo(){' }
      : stop
        ? { content: 'internal synthetic evaluator content' }
        : research
          ? { query: 'AIエージェントに関する最新情報を複数ソースで調査してください。' }
          : {},
    action: stop ? 'cancel-after-approval' : 'execute',
    allowedChangedPaths: [],
    regressionCheck: 'none',
  };
}

function task(index: number, candidateSha: string): GeneralAgentPrivateTaskV2 {
  const value = baseTask(index, candidateSha);
  return { ...value, taskDigest: digestGeneralAgentPrivateTaskV2(value) };
}

async function main(): Promise<void> {
  const { stdout: shaStdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
  const candidateSha = shaStdout.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error('INTERNAL_AGENT_CANDIDATE_SHA_INVALID');

  const { stdout: statusStdout } = await execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: process.cwd() });
  if (statusStdout.trim()) throw new Error('INTERNAL_AGENT_CHECKOUT_DIRTY_BEFORE_RUN');

  const corpus: GeneralAgentPrivateCorpusV2 = {
    version: GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2,
    corpusId: `internal-synthetic-live-${candidateSha.slice(0, 12)}`,
    candidateSha,
    permissionProfileDigest: digestGeneralAgentPermissionProfileV1(),
    tasks: Array.from({ length: 12 }, (_, index) => task(index, candidateSha)),
  };
  const encoded = gzipSync(Buffer.from(JSON.stringify(corpus), 'utf8'), { level: 9 }).toString('base64');
  const outputDir = await mkdtemp(path.join(tmpdir(), 'origin-agent-live-eval-'));

  try {
    const { stdout, stderr } = await execute(
      process.execPath,
      ['--import', 'tsx', 'scripts/run-general-agent-private-v2.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ORIGIN_GENERAL_AGENT_CANDIDATE_SHA: candidateSha,
          ORIGIN_GENERAL_AGENT_CORPUS_ID: corpus.corpusId,
          ORIGIN_GENERAL_AGENT_PRIVATE_CORPUS_GZIP_B64: encoded,
          ORIGIN_GENERAL_AGENT_OUTPUT_DIR: outputDir,
        },
        timeout: 180_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    if (stderr.trim()) throw new Error('INTERNAL_AGENT_RUNNER_STDERR_NONEMPTY');

    const summary = JSON.parse(await readFile(path.join(outputDir, 'candidate-score-summary.json'), 'utf8')) as {
      candidateSha: string;
      attempted: number;
      solved: number;
      blockersByTask: Array<{ taskId: string; blockers: string[] }>;
    };
    const evidence = JSON.parse(await readFile(path.join(outputDir, 'candidate-trusted-evidence.json'), 'utf8')) as Array<{
      events: Array<Record<string, unknown>>;
    }>;

    if (summary.candidateSha !== candidateSha || summary.attempted !== 12 || evidence.length !== 12) {
      throw new Error('INTERNAL_AGENT_EVIDENCE_INCOMPLETE');
    }
    for (const row of evidence) {
      const cost = row.events.find(event => event.kind === 'cost-attestation') as
        | { costUsd?: number; paidFallbackUsed?: boolean }
        | undefined;
      if (!cost || cost.costUsd !== 0 || cost.paidFallbackUsed !== false) {
        throw new Error('INTERNAL_AGENT_ZERO_COST_BOUNDARY_FAILED');
      }
    }

    const terminal = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as {
      event?: string;
      taskCount?: number;
      solved?: number;
    };
    if (
      terminal.event !== 'general-agent-private-round-completed'
      || terminal.taskCount !== 12
      || terminal.solved !== summary.solved
    ) throw new Error('INTERNAL_AGENT_TERMINAL_EVIDENCE_INVALID');

    process.stdout.write(JSON.stringify({
      evaluation: 'GENERAL_AGENT_INTERNAL_SYNTHETIC_LIVE_V2',
      candidateSha,
      attempted: summary.attempted,
      solved: summary.solved,
      solveRate: summary.solved / summary.attempted,
      zeroCostSafe: true,
      blockersByTask: summary.blockersByTask,
      limitation: 'Visible synthetic internal benchmark; not final sealed/private or external comparative qualification.',
    }) + '\n');
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : 'INTERNAL_AGENT_EVALUATION_FAILED') + '\n');
  process.exitCode = 1;
});
