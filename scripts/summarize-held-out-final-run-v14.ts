import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { HeldOutCodingScoreV14 } from '../src/agent/heldOutCodingBenchmarkV14.js';
import { parseHeldOutFinalPrivateCorpusGzipBase64V14 } from '../src/agent/heldOutCodingFinalPrivateCorpusV14.js';
import { summarizeHeldOutFinalEvidenceV14 } from '../src/agent/heldOutCodingFinalQualificationV14.js';

const MAX_SCORE_BYTES = 64 * 1024;
const MAX_SCAN_ENTRIES = 512;
const TERMINAL = new Set(['verified', 'blocked', 'failed', 'cancelled']);

function validScore(value: unknown): value is HeldOutCodingScoreV14 {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<HeldOutCodingScoreV14>;
  const axes = row.axes as HeldOutCodingScoreV14['axes'] | undefined;
  return typeof row.taskId === 'string'
    && row.taskId.length > 0
    && typeof row.participant === 'string'
    && row.participant.length > 0
    && Boolean(axes)
    && typeof axes?.heldOutIdentity === 'boolean'
    && typeof axes?.multiFileEditing === 'boolean'
    && typeof axes?.verification === 'boolean'
    && typeof axes?.failureRecovery === 'boolean'
    && typeof row.solved === 'boolean'
    && Array.isArray(row.regressions)
    && row.regressions.every(item => typeof item === 'string')
    && Number.isFinite(row.durationMs)
    && Number(row.durationMs) >= 0
    && Number.isFinite(row.costUsd)
    && Number(row.costUsd) >= 0
    && typeof row.terminalStatus === 'string'
    && TERMINAL.has(row.terminalStatus);
}

async function collectScoreFiles(root: string): Promise<string[]> {
  const pending = [root];
  const found: string[] = [];
  let scanned = 0;
  while (pending.length) {
    const current = pending.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      scanned += 1;
      if (scanned > MAX_SCAN_ENTRIES) throw new Error('HELD_OUT_FINAL_ARTIFACT_SCAN_LIMIT');
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('HELD_OUT_FINAL_ARTIFACT_SYMLINK_BLOCKED');
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name === 'held-out-score.json') found.push(target);
    }
  }
  return found.sort();
}

async function readScore(file: string): Promise<HeldOutCodingScoreV14> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_SCORE_BYTES) throw new Error('HELD_OUT_FINAL_SCORE_SIZE_INVALID');
  let parsed: unknown;
  try { parsed = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw new Error('HELD_OUT_FINAL_SCORE_JSON_INVALID'); }
  if (!validScore(parsed)) throw new Error('HELD_OUT_FINAL_SCORE_INVALID');
  return parsed;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('HELD_OUT_FINAL_RUN_NOT_ONE_SHOT');
  const runId = process.env.GITHUB_RUN_ID ?? '';
  if (!/^[1-9][0-9]{0,19}$/.test(runId)) throw new Error('HELD_OUT_FINAL_RUN_ID_INVALID');
  const encoded = process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64 ?? '';
  if (!encoded) throw new Error('HELD_OUT_FINAL_SECRET_REQUIRED');
  const artifactRoot = await fs.realpath(process.env.ORIGIN_HELDOUT_FINAL_ARTIFACT_ROOT ?? '');

  const prepared = parseHeldOutFinalPrivateCorpusGzipBase64V14(encoded);
  delete process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64;

  const files = await collectScoreFiles(artifactRoot);
  if (files.length < 1 || files.length > prepared.publicCorpus.tasks.length) throw new Error('HELD_OUT_FINAL_SCORE_FILE_COUNT_INVALID');
  const scores: HeldOutCodingScoreV14[] = [];
  for (const file of files) scores.push(await readScore(file));

  const evidence = summarizeHeldOutFinalEvidenceV14(prepared.publicCorpus, prepared.provenance, scores);
  const output = {
    qualification: prepared.publicCorpus.qualification,
    corpusId: prepared.publicCorpus.corpusId,
    corpusDigest: prepared.publicCorpus.corpusDigest,
    frozenBaseSha: prepared.publicCorpus.frozenBaseSha,
    taskIds: prepared.publicCorpus.tasks.map(task => task.id),
    workflowRunId: runId,
    workflowRunAttempt: 1,
    workflowSha: process.env.GITHUB_SHA ?? null,
    evidence,
  };

  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/held-out-final-evidence.json', `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({
    corpusId: output.corpusId,
    corpusDigest: output.corpusDigest,
    attempted: evidence.attempted,
    solved: evidence.solved,
    solveRate: evidence.solveRate,
    eligible: evidence.eligible,
    totalCostUsd: evidence.totalCostUsd,
  })}\n`);
  if (!evidence.eligible) throw new Error(`HELD_OUT_FINAL_EVIDENCE_INELIGIBLE:${evidence.reasons.join(',')}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const code = /^[A-Z0-9_:-]+(?:,[A-Za-z0-9_:-]+)*$/.test(message)
    ? message
    : 'HELD_OUT_FINAL_SUMMARY_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
