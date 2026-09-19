import {
  createOriginAnswerQualityFrozenCorpus,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkCorpus.js";
import {
  selectOriginAnswerQualityBenchmarkQuotaShardForLanes,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkLaneShardSelector.js";
import {
  planOriginAnswerQualityBenchmarkQuotaShards,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkQuotaPlan.js";

const corpus = createOriginAnswerQualityFrozenCorpus();
const plan = planOriginAnswerQualityBenchmarkQuotaShards(corpus, 45);
if (plan.ok === false) {
  throw new Error(`AQ_RESEARCH_SHARD_PLAN_FAILED:${plan.code}`);
}

const selected = selectOriginAnswerQualityBenchmarkQuotaShardForLanes(
  corpus,
  plan.value,
  ["research"],
);
if (selected.ok === false) {
  throw new Error(selected.code);
}

process.stdout.write(String(selected.value.shardIndex));
