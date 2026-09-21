import {
  createOriginAnswerQualityFrozenCorpus,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkCorpus.js";
import type {
  OriginAnswerQualityBenchmarkExecutionLane,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkExecutionRouter.js";
import {
  selectOriginAnswerQualityBenchmarkQuotaShardForLanes,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkLaneShardSelector.js";
import {
  planOriginAnswerQualityBenchmarkQuotaShards,
} from "../src/lib/orchestration/OriginAnswerQualityBenchmarkQuotaPlan.js";

const lane = process.argv[2]?.trim() as OriginAnswerQualityBenchmarkExecutionLane | undefined;
if (!lane || !["research", "chat", "coding", "artifact"].includes(lane)) {
  throw new Error("AQ_LANE_SHARD_SELECTOR_LANE_INVALID");
}

const corpus = createOriginAnswerQualityFrozenCorpus();
const plan = planOriginAnswerQualityBenchmarkQuotaShards(corpus, 45);
if (plan.ok === false) {
  throw new Error(`AQ_LANE_SHARD_PLAN_FAILED:${plan.code}`);
}

const selected = selectOriginAnswerQualityBenchmarkQuotaShardForLanes(
  corpus,
  plan.value,
  [lane],
);
if (selected.ok === false) {
  throw new Error(selected.code);
}

process.stdout.write(String(selected.value.shardIndex));
