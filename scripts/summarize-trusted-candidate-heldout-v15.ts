import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { HeldOutCodingScoreV14 } from '../src/agent/heldOutCodingBenchmarkV14.js';
import { summarizeHeldOutFinalEvidenceV14 } from '../src/agent/heldOutCodingFinalQualificationV14.js';
import { parseAndBindHeldOutFinalPrivateCorpusGzipBase64V15 } from '../src/release/OriginHeldOutCandidateBindingV15.js';
import { deriveTrustedCandidateCodingQualificationV15 } from '../src/release/OriginHeldOutCandidateQualificationV15.js';

const MAX_SCORE_BYTES = 64 * 1024;
const MAX_SCAN_ENTRIES = 512;
const TERMINAL = new Set(['verified', 'blocked', 'failed', 'cancelled']);

function validScore(value: unknown): value is HeldOutCodingScoreV14 {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<HeldOutCodingScoreV14>;
  const axes = row.axes as HeldOutCodingScoreV14['axes'] | undefined;
  return typeof row.taskId === 'string'
    && typeof row.participant === 'string'
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

async function collect(root: string): Promise<string[]> {
  const pending = [root];
  const found: string[] = [];
  let scanned = 0;
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (++scanned > MAX_SCAN_ENTRIES) throw new Error('TRUSTED_CANDIDATE_ARTIFACT_SCAN_LIMIT');
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('TRUSTED_CANDIDATE_ARTIFACT_SYMLINK_BLOCKED');
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name === 'held-out-score.json') found.push(target);
    }
  }
  return found.sort();
}

async function readScore(file: string): Promise<HeldOutCodingScoreV14> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_SCORE_BYTES) throw new Error('TRUSTED_CANDIDATE_SCORE_SIZE_INVALID');
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw new Error('TRUSTED_CANDIDATE_SCORE_JSON_INVALID'); }
  if (!validScore(value)) throw new Error('TRUSTED_CANDIDATE_SCORE_INVALID');
  return value;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('TRUSTED_CANDIDATE_RUN_NOT_ONE_SHOT');
  const runId = process.env.GITHUB_RUN_ID ?? '';
  const candidateSha = (process.env.ORIGIN_CANDIDATE_SHA ?? '').toLowerCase();
  const encoded = process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64 ?? '';
  if (!/^[1-9][0-9]{0,19}$/.test(runId) || !/^[a-f0-9]{40}$/.test(candidateSha) || !encoded) {
    throw new Error('TRUSTED_CANDIDATE_SUMMARY_INPUT_INVALID');
  }
  const root = await fs.realpath(process.env.ORIGIN_HELDOUT_FINAL_ARTIFACT_ROOT ?? '');
  const binding = parseAndBindHeldOutFinalPrivateCorpusGzipBase64V15(encoded, candidateSha);
  delete process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64;

  const files = await collect(root);
  if (files.length !== binding.taskCount) throw new Error('TRUSTED_CANDIDATE_SCORE_COUNT_INVALID');
  const scores = [];
  for (const file of files) scores.push(await readScore(file));

  const finalEvidence = summarizeHeldOutFinalEvidenceV14(
    binding.rebound.publicCorpus,
    binding.rebound.provenance,
    scores,
  );
  const qualification = deriveTrustedCandidateCodingQualificationV15(finalEvidence, scores);
  const output = {
    schemaVersion: 'origin-trusted-candidate-heldout-final-v1',
    candidateSha,
    sourceCorpusDigest: binding.sourceCorpusDigest,
    candidateCorpusDigest: binding.candidateCorpusDigest,
    oneShotMarkerName: binding.oneShotMarkerName,
    workflowRunId: runId,
    workflowRunAttempt: 1,
    taskIds: binding.taskIds,
    evidence: finalEvidence,
    qualification,
  };

  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/trusted-candidate-heldout-final.json', JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({
    candidateSha,
    attempted: qualification.attempted,
    solved: qualification.solved,
    regressionCount: qualification.regressionCount,
    qualificationPassed: qualification.qualificationPassed,
    zeroCost: qualification.zeroCost,
  }) + '\n');
  if (!qualification.qualificationPassed) throw new Error('TRUSTED_CANDIDATE_CODING_NOT_QUALIFIED');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const code = /^[A-Z0-9_:-]+$/.test(message) ? message : 'TRUSTED_CANDIDATE_SUMMARY_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
