import { readFileSync, writeFileSync } from "node:fs";

const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const marker=`origin-self-evolution-v2:${priority.queueFingerprint}`;
const selected=priority.ranked.filter(x=>x.tier==="A" && ["P0","P1"].includes(x.priority));

const proposal={
  schemaVersion:"origin.self-evolution.issue-proposal.v2",
  generatedAt:new Date().toISOString(),
  marker,
  exactBaseSha:priority.exactBaseSha,
  baselineFingerprint:priority.baselineFingerprint,
  queueFingerprint:priority.queueFingerprint,
  candidateCount:selected.length,
  publishAuthorized:false,
  reason:"Workflow is intentionally read-only. External orchestration may review/deduplicate/publish this proposal without granting repository write permission to Self-Evolution.",
  candidates:selected.map(x=>({
    candidateId:x.id,
    priority:x.priority,
    category:x.category,
    source:x.source,
    evidenceTier:x.tier,
    priorityScore:x.priorityScore,
    lane:x.lane,
    actionable:x.actionable===true,
    evidenceStatus:x.actionable===true
      ? "IMPROVEMENT_EXPERIMENT_CANDIDATE"
      : x.gapAssessment?.gapKnown===true
        ? "SOLUTION_FIT_MEASUREMENT_REQUIRED"
        : "BASELINE_GAP_MEASUREMENT_REQUIRED",
    gapAssessment:x.gapAssessment||null,
    nextAction:x.actionable===true
      ? x.nextAction
      : x.gapAssessment?.requiredNextEvidence || x.nextAction
  }))
};

writeFileSync("origin-self-evolution-issue-proposal-v2.json",JSON.stringify(proposal,null,2)+"\n");
writeFileSync("origin-self-evolution-issue-proposal-v2.md",[
  "<!-- "+marker+" -->",
  "# ORIGIN Self-Evolution V2 — Improvement Queue Proposal",
  "",
  `Exact baseline SHA: ${proposal.exactBaseSha}`,
  `Baseline fingerprint: ${proposal.baselineFingerprint}`,
  `Queue fingerprint: ${proposal.queueFingerprint}`,
  "",
  "**Proposal only. This workflow has no GitHub Issue/code/merge/deploy write authority.**",
  "",
  ...selected.map(x=>[
    `## ${x.priority} — ${x.category} / ${x.source}`,
    `- candidate: ${x.id}`,
    `- evidence tier: ${x.tier}`,
    `- score: ${x.priorityScore}`,
    `- lane: ${x.lane}`,
    `- actionable: ${x.actionable===true}`,
    `- evidence status: ${x.actionable===true ? "IMPROVEMENT_EXPERIMENT_CANDIDATE" : x.gapAssessment?.gapKnown===true ? "SOLUTION_FIT_MEASUREMENT_REQUIRED" : "BASELINE_GAP_MEASUREMENT_REQUIRED"}`,
    `- next: ${x.actionable===true ? x.nextAction : x.gapAssessment?.requiredNextEvidence || x.nextAction}`
  ].join("\n"))
].join("\n")+"\n");

console.log(JSON.stringify({ok:true,packaged:true,candidateCount:selected.length,queueFingerprint:priority.queueFingerprint}));
