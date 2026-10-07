import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function validateDailyBatch(directory, baselineSha, candidateSha) {
  const fail = () => { throw new Error('AQ_DAILY_BATCH_INVALID'); };
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const summary = JSON.parse(await readFile(path.join(directory, 'aq-budgeted-day-summary.json'), 'utf8'));
  if (summary?.schemaVersion !== 'origin.aq-budgeted-day.v1'
    || !/^[a-f0-9]{40}$/.test(baselineSha) || !/^[a-f0-9]{40}$/.test(candidateSha)
    || baselineSha === candidateSha || summary.baselineSha !== baselineSha || summary.candidateSha !== candidateSha
    || summary.dailyProviderBudget !== 45 || summary.maxShardsPerDay !== 4
    || !integer(summary.actualRequestsUsed) || summary.actualRequestsUsed>45
    || typeof summary.interrupted !== 'boolean' || summary.actualRequestsUsedIsLowerBound !== summary.interrupted
    || summary.expectedShardCount !== 40 || !integer(summary.completedShardCount) || summary.completedShardCount>40
    || !Array.isArray(summary.executed) || summary.executed.length<1 || summary.executed.length>4) fail();
  const names = await readdir(directory);
  const expected = new Set(['aq-budgeted-day-summary.json']);
  let used = 0;
  for (const item of summary.executed) {
    if (!integer(item.shardIndex) || item.shardIndex>=40 || !integer(item.actualRequests)
      || !integer(item.plannedMax) || item.actualRequests>item.plannedMax) fail();
    const name = `aq-official-shard-${item.shardIndex}.json`;
    if (expected.has(name)) fail();
    expected.add(name);
    const value = JSON.parse(await readFile(path.join(directory,name),'utf8'));
    const shard = value?.shard;
    if (value?.schemaVersion !== 'origin.aq-local-shard-result.v1' || value.ok !== true
      || shard?.schemaVersion !== 'origin.aq-official-shard-comparison.v1'
      || !/^sha256:[a-f0-9]{64}$/.test(shard?.shardDigest ?? '')
      || shard.shardIndex !== item.shardIndex || shard.baselineGitSha !== baselineSha || shard.candidateGitSha !== candidateSha
      || shard.plannedPairedRequestsMax !== item.plannedMax) fail();
    const counts=[shard.baselineRuntimeProviderRequests,shard.candidateRuntimeProviderRequests,shard.baselineEvaluatorRequests,shard.candidateEvaluatorRequests];
    if (!counts.every(integer) || counts.reduce((a,b)=>a+b,0)!==item.actualRequests) fail();
    used += item.actualRequests;
  }
  if (used !== summary.actualRequestsUsed || names.length !== expected.size || names.some(name=>!expected.has(name))
    || summary.completedShardCount<summary.executed.length) fail();
  return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  validateDailyBatch(process.env.AQ_NEW_SHARD_DIR,process.env.BASELINE_SHA,process.env.CANDIDATE_SHA).catch(()=> {
    process.stderr.write('AQ_DAILY_BATCH_INVALID\n'); process.exitCode=1;
  });
}
