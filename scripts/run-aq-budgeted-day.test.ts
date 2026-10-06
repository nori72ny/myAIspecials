// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateDailyBatch } from './validate-aq-daily-batch.mjs';
import { runBudgetedDay } from './run-aq-budgeted-day.js';
import { createOriginAnswerQualityFrozenCorpus } from '../src/lib/orchestration/OriginAnswerQualityBenchmarkCorpus.js';
import { planOriginAnswerQualityBenchmarkCaseShards } from '../src/lib/orchestration/OriginAnswerQualityBenchmarkQuotaPlan.js';
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'aq-checkpoint-')); roots.push(root);
  vi.stubEnv('ORIGIN_AQ_BASELINE_SHA', 'a'.repeat(40));
  vi.stubEnv('ORIGIN_AQ_CANDIDATE_SHA', 'b'.repeat(40));
  vi.stubEnv('AQ_STATE_DIR', path.join(root, 'state'));
  vi.stubEnv('AQ_NEW_SHARD_DIR', path.join(root, 'new'));
  return root;
}
async function succeed(env: NodeJS.ProcessEnv) {
  const plan = planOriginAnswerQualityBenchmarkCaseShards(createOriginAnswerQualityFrozenCorpus(), 45);
  if (!plan.ok) throw new Error('plan');
  const index = Number(env.ORIGIN_AQ_SHARD_INDEX);
  await writeFile(env.ORIGIN_AQ_OUTPUT_PATH!, JSON.stringify({ schemaVersion: 'origin.aq-local-shard-result.v1', ok: true, shard: {
    schemaVersion: 'origin.aq-official-shard-comparison.v1', shardDigest: 'sha256:'+'c'.repeat(64), shardIndex: index, baselineGitSha: env.ORIGIN_AQ_BASELINE_SHA, candidateGitSha: env.ORIGIN_AQ_CANDIDATE_SHA,
    plannedPairedRequestsMax: plan.value.shards[index].pairedRequestsMax,
    baselineRuntimeProviderRequests: 1, candidateRuntimeProviderRequests: 1, baselineEvaluatorRequests: 1, candidateEvaluatorRequests: 1,
  }}));
}
describe('AQ partial-day evidence survives a later failure', () => {
  it.each(['process-failure', 'invalid-result'])('preserves only validated successes after %s and resumes without replaying them', async failure => {
    const root = await setup(); let calls = 0;
    await expect(runBudgetedDay(async env => {
      if (calls++ === 0) return succeed(env);
      await writeFile(env.ORIGIN_AQ_OUTPUT_PATH!, failure === 'invalid-result' ? '{"ok":false}' : 'partial');
      if (failure === 'process-failure') throw new Error('secret-provider-output');
    })).rejects.toThrow();
    expect(calls).toBe(2);
    expect(await readdir(path.join(root, 'state'))).toEqual(['aq-official-shard-0.json']);
    expect(await readdir(path.join(root, 'new'))).toEqual(['aq-budgeted-day-summary.json', 'aq-official-shard-0.json']);
    const summary = JSON.parse(await readFile(path.join(root, 'new/aq-budgeted-day-summary.json'), 'utf8'));
    expect(summary).toMatchObject({ completedShardCount: 1, actualRequestsUsed: 4, interrupted: true, actualRequestsUsedIsLowerBound: true });
    expect(JSON.stringify(summary)).not.toContain('secret-provider-output');
    await expect(validateDailyBatch(path.join(root,'new'),'a'.repeat(40),'b'.repeat(40))).resolves.toMatchObject({interrupted:true});
    const resumed: number[] = [];
    await runBudgetedDay(async env => { resumed.push(Number(env.ORIGIN_AQ_SHARD_INDEX)); await succeed(env); });
    expect(resumed).toHaveLength(4);
    expect(resumed).not.toContain(0);
    expect(new Set(resumed).size).toBe(4);
    const next = JSON.parse(await readFile(path.join(root, 'new/aq-budgeted-day-summary.json'), 'utf8'));
    expect(next).toMatchObject({ completedShardCount: 5, interrupted: false, actualRequestsUsedIsLowerBound: false });
  });
  it('does not claim completion or create a successful shard when the first attempt fails', async () => {
    const root = await setup();
    await expect(runBudgetedDay(async () => { throw new Error('failed'); })).rejects.toThrow();
    expect(await readdir(path.join(root, 'state'))).toEqual([]);
    const summary = JSON.parse(await readFile(path.join(root, 'new/aq-budgeted-day-summary.json'), 'utf8'));
    expect(summary).toMatchObject({ executed: [], completedShardCount: 0, interrupted: true });
  });
});

 describe('AQ durable batch rejects mismatched or extra evidence', () => {
  it.each(['extra-file','mixed-sha','request-count','duplicate','failed-shard'])('rejects %s before upload', async corruption => {
    const root=await setup(); await runBudgetedDay(succeed); const directory=path.join(root,'new');
    const summaryPath=path.join(directory,'aq-budgeted-day-summary.json');
    const summary=JSON.parse(await readFile(summaryPath,'utf8'));
    await expect(validateDailyBatch(directory,'a'.repeat(40),'b'.repeat(40))).resolves.toMatchObject({interrupted:false});
    if(corruption==='extra-file') await writeFile(path.join(directory,'unexpected.txt'),'must not upload');
    if(corruption==='duplicate') {summary.executed[1]=summary.executed[0];await writeFile(summaryPath,JSON.stringify(summary));}
    if(['mixed-sha','request-count','failed-shard'].includes(corruption)) {
      const file=path.join(directory,`aq-official-shard-${summary.executed[0].shardIndex}.json`); const value=JSON.parse(await readFile(file,'utf8'));
      if(corruption==='mixed-sha') value.shard.candidateGitSha='d'.repeat(40);
      if(corruption==='request-count') value.shard.candidateRuntimeProviderRequests=45;
      if(corruption==='failed-shard') value.ok=false;
      await writeFile(file,JSON.stringify(value));
    }
    await expect(validateDailyBatch(directory,'a'.repeat(40),'b'.repeat(40))).rejects.toThrow('AQ_DAILY_BATCH_INVALID');
  });
});
