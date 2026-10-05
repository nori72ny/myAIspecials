import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const queue = JSON.parse(readFileSync("origin-self-evolution-candidates-v2.json","utf8"));
const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");

function experimentFor(candidate) {
  const sensitive = ["security","provider","pricing","privacy","permissions","secrets"].includes(candidate.category);
  const executable = candidate.lane === "BASELINE_COMPARISON" && !sensitive;
  return {
    experimentId: sha256(candidate.id + "|" + queue.sourceObservationSha).slice(0,20),
    candidateId: candidate.id,
    category: candidate.category,
    exactBaseSha: queue.sourceObservationSha,
    status: executable ? "SPEC_READY" : "BLOCKED_PENDING_EVIDENCE",
    executable,
    constraints: {
      isolatedWorkspace: true,
      networkWrite: false,
      repoWrite: false,
      secretAccess: false,
      productionAccess: false,
      paidProvider: false,
      maxCostUsd: 0
    },
    acceptance: {
      deterministicTests: true,
      relevantRegressionTests: true,
      noSecurityRegression: true,
      noAccessibilityRegression: true,
      noPerformanceRegression: true,
      measuredImprovementRequired: true,
      rollbackDefined: true
    },
    reason: executable
      ? "Primary non-sensitive evidence may proceed to a dry-run experiment specification."
      : "Candidate is not eligible for autonomous experimentation."
  };
}

const experiments = queue.candidates.map(experimentFor);
const out = {
  schemaVersion:"origin.self-evolution.experiments.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:queue.sourceObservationSha,
  summary:{
    total:experiments.length,
    specReady:experiments.filter(x=>x.status==="SPEC_READY").length,
    blocked:experiments.filter(x=>x.status!=="SPEC_READY").length
  },
  experiments
};
writeFileSync("origin-self-evolution-experiments-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-experiments-v2.md",[
"# ORIGIN Self-Evolution V2 Experiment Specs",
"",
`Exact base SHA: ${out.exactBaseSha}`,
`Spec ready: ${out.summary.specReady}`,
`Blocked: ${out.summary.blocked}`,
"",
"These are experiment contracts only. They do not modify the repository or Production.",
...experiments.map(x=>`- ${x.experimentId} ${x.category}: ${x.status} — ${x.reason}`)
].join("\n")+"\n");
console.log(JSON.stringify({ok:true,summary:out.summary}));
