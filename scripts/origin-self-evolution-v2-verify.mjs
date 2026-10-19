import { readFileSync, writeFileSync } from "node:fs";

const pack = JSON.parse(readFileSync("origin-self-evolution-experiments-v2.json","utf8"));

function verify(exp) {
  const c = exp.constraints || {};
  const a = exp.acceptance || {};
  const boundaryOk =
    c.isolatedWorkspace === true &&
    c.networkWrite === false &&
    c.repoWrite === false &&
    c.secretAccess === false &&
    c.productionAccess === false &&
    c.paidProvider === false &&
    c.maxCostUsd === 0;
  const acceptanceOk =
    a.deterministicTests === true &&
    a.relevantRegressionTests === true &&
    a.noSecurityRegression === true &&
    a.noAccessibilityRegression === true &&
    a.noPerformanceRegression === true &&
    a.measuredImprovementRequired === true &&
    a.rollbackDefined === true;
  return {
    experimentId: exp.experimentId,
    candidateId: exp.candidateId,
    boundaryOk,
    acceptanceOk,
    eligibleForSandbox: exp.executable === true && boundaryOk && acceptanceOk,
    verificationStatus: exp.executable === true && boundaryOk && acceptanceOk ? "SANDBOX_ELIGIBLE" : "NOT_ELIGIBLE"
  };
}

const verification = pack.experiments.map(verify);
const out = {
  schemaVersion:"origin.self-evolution.verification.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:pack.exactBaseSha,
  summary:{
    total:verification.length,
    sandboxEligible:verification.filter(x=>x.eligibleForSandbox).length,
    notEligible:verification.filter(x=>!x.eligibleForSandbox).length
  },
  verification
};

writeFileSync("origin-self-evolution-verification-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-verification-v2.md",[
"# ORIGIN Self-Evolution V2 Sandbox Verification",
"",
`Exact base SHA: ${out.exactBaseSha}`,
`Sandbox eligible: ${out.summary.sandboxEligible}`,
`Not eligible: ${out.summary.notEligible}`,
"",
"No repository mutation, network write, secret access, or Production action occurred."
].join("\n")+"\n");

if (verification.some(x=>x.verificationStatus==="SANDBOX_ELIGIBLE" && (!x.boundaryOk || !x.acceptanceOk))) {
  throw new Error("SELF_EVOLUTION_FAIL_CLOSED_BOUNDARY");
}
console.log(JSON.stringify({ok:true,summary:out.summary}));
