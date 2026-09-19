import {
  createOriginAnswerQualityFrozenCorpus,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkCorpus.js";
import {
  planOriginAnswerQualityBenchmarkQuotaShards,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkQuotaPlan.js";
import {
  resolveOriginAnswerQualityBenchmarkRequiredLanes,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkExecutionRouter.js";

const corpus = createOriginAnswerQualityFrozenCorpus();
const plan = planOriginAnswerQualityBenchmarkQuotaShards(corpus, 45);
if (plan.ok === false) {
  throw new Error(`AQ_RESEARCH_SHARD_PLAN_FAILED:${plan.code}`);
}

for (const shard of plan.value.shards) {
  const caseSet = new Set(shard.caseIds);
  const cases = corpus.cases.filter((item) => caseSet.has(item.caseId));
  const lanes = resolveOriginAnswerQualityBenchmarkRequiredLanes(cases);
  if (lanes.length === 1 && lanes[0] === "research") {
    process.stdout.write(String(shard.shardIndex));
    process.exit(0);
  }
}

throw new Error("AQ_RESEARCH_SHARD_NOT_FOUND");
