import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const verified=JSON.parse(readFileSync("origin-self-evolution-verification-v2.json","utf8"));
const result=JSON.parse(readFileSync("origin-self-evolution-experiment-result-v2.json","utf8"));
const hash=(v)=>createHash("sha256").update(String(v)).digest("hex");

const byCandidate=new Map(verified.verification.map(v=>[v.candidateId,v]));
const proposals=priority.ranked.map(candidate=>{
  const check=byCandidate.get(candidate.id);
  const sandboxEligible=Boolean(check?.eligibleForSandbox);
  const measuredImprovement=
    result.accepted===true &&
    result.status==="MEASURED_IMPROVEMENT" &&
    result.exactBaseSha===priority.exactBaseSha &&
    result.candidateId===candidate.id &&
    result.experimentId===check?.experimentId;

  const status=measuredImprovement
    ? "DRAFT_PR_PROPOSAL_ONLY"
    : sandboxEligible
      ? "HOLD_PENDING_EXPERIMENT_RESULT"
      : "HOLD_NOT_ELIGIBLE";

  return {
    proposalId:hash(candidate.id+"|promotion|"+priority.exactBaseSha).slice(0,20),
    candidateId:candidate.id,
    exactBaseSha:priority.exactBaseSha,
    status,
    automaticMerge:false,
    automaticDeploy:false,
    codeWriteAuthorized:false,
    ownerApprovalRequiredBeforePrivilegeExpansion:true,
    measuredImprovementVerified:measuredImprovement,
    requiredEvidence:[
      "exact-base-sha",
      "isolated-experiment-output",
      "relevant-tests",
      "security-regression-check",
      "accessibility-regression-check",
      "performance-regression-check",
      "measured-before-after",
      "rollback-plan"
    ],
    note:measuredImprovement
      ? "A Draft PR proposal artifact may be produced. This is still not code-write, merge, or deployment authority."
      : sandboxEligible
        ? "Sandbox eligibility is not promotion evidence. A real isolated experiment result with measured before/after evidence is still required."
        : "Insufficient eligibility for promotion packaging."
  };
});

const out={
  schemaVersion:"origin.self-evolution.promotion.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:priority.exactBaseSha,
  experimentResultStatus:result.status,
  summary:{
    total:proposals.length,
    draftPrProposalOnly:proposals.filter(x=>x.status==="DRAFT_PR_PROPOSAL_ONLY").length,
    pendingExperimentResult:proposals.filter(x=>x.status==="HOLD_PENDING_EXPERIMENT_RESULT").length,
    holdNotEligible:proposals.filter(x=>x.status==="HOLD_NOT_ELIGIBLE").length
  },
  proposals
};

writeFileSync("origin-self-evolution-promotion-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-promotion-v2.md",[
  "# ORIGIN Self-Evolution V2 Promotion Packages",
  "",
  `Exact base SHA: ${out.exactBaseSha}`,
  `Experiment result: ${out.experimentResultStatus}`,
  `Draft-PR proposal only: ${out.summary.draftPrProposalOnly}`,
  `Pending real experiment result: ${out.summary.pendingExperimentResult}`,
  `Not eligible: ${out.summary.holdNotEligible}`,
  "",
  "Promotion packaging is not code-write, merge, or deployment authority. Missing evidence remains NOT_MEASURED."
].join("\n")+"\n");

console.log(JSON.stringify({ok:true,summary:out.summary}));
