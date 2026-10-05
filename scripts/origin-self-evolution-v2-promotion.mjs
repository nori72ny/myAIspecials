import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const queue = JSON.parse(readFileSync("origin-self-evolution-candidates-v2.json","utf8"));
const verified = JSON.parse(readFileSync("origin-self-evolution-verification-v2.json","utf8"));
const hash=(v)=>createHash("sha256").update(String(v)).digest("hex");

const byCandidate = new Map(verified.verification.map(v=>[v.candidateId,v]));
const proposals = queue.candidates.map(candidate=>{
  const check=byCandidate.get(candidate.id);
  const ready=Boolean(check?.eligibleForSandbox);
  return {
    proposalId:hash(candidate.id+"|promotion|"+queue.sourceObservationSha).slice(0,20),
    candidateId:candidate.id,
    exactBaseSha:queue.sourceObservationSha,
    status:ready?"DRAFT_PR_PACKAGE_ONLY":"HOLD",
    automaticMerge:false,
    automaticDeploy:false,
    codeWriteAuthorized:false,
    ownerApprovalRequiredBeforePrivilegeExpansion:true,
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
    note:ready
      ? "May be packaged as a Draft PR proposal after a real isolated experiment proves improvement."
      : "Insufficient eligibility for promotion packaging."
  };
});

const out={
  schemaVersion:"origin.self-evolution.promotion.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:queue.sourceObservationSha,
  summary:{
    total:proposals.length,
    draftPackageOnly:proposals.filter(x=>x.status==="DRAFT_PR_PACKAGE_ONLY").length,
    hold:proposals.filter(x=>x.status==="HOLD").length
  },
  proposals
};

writeFileSync("origin-self-evolution-promotion-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-promotion-v2.md",[
"# ORIGIN Self-Evolution V2 Promotion Packages",
"",
`Exact base SHA: ${out.exactBaseSha}`,
`Draft-package candidates: ${out.summary.draftPackageOnly}`,
`Held: ${out.summary.hold}`,
"",
"Promotion packaging is not merge authority. Automatic merge/deploy remain disabled."
].join("\n")+"\n");
console.log(JSON.stringify({ok:true,summary:out.summary}));
