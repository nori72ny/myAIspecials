import { readFileSync, writeFileSync } from "node:fs";

const baseline=JSON.parse(readFileSync("origin-self-evolution-baseline-v2.json","utf8"));
const verify=JSON.parse(readFileSync("origin-self-evolution-verification-v2.json","utf8"));
const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const integrity=JSON.parse(readFileSync("origin-self-evolution-source-integrity-v2.json","utf8"));

const freeze = process.env.ORIGIN_EVALUATION_FREEZE === "true";
const disabled = process.env.ORIGIN_SELF_EVOLUTION_DISABLED === "true";
const baselineFreshMs = Number(process.env.ORIGIN_BASELINE_MAX_AGE_MS || 6*60*60*1000);
const ageMs = Date.now() - Date.parse(baseline.generatedAt || "");
const baselineFresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= baselineFreshMs;

const decisions=verify.verification.map(v=>{
  const candidate=priority.ranked.find(c=>c.id===v.candidateId);
  const permitted=
    !disabled &&
    !freeze &&
    baseline.productionHealthy === true &&
    baselineFresh &&
    integrity.safeForExperiments === true &&
    v.eligibleForSandbox === true &&
    candidate?.actionable === true &&
    ["P0","P1"].includes(candidate.priority);

  let reason="AUTHORIZED_FOR_ISOLATED_DRY_RUN";
  if(disabled) reason="SELF_EVOLUTION_DISABLED";
  else if(freeze) reason="EVALUATION_FREEZE_ACTIVE";
  else if(!baseline.productionHealthy) reason="PRODUCTION_BASELINE_UNHEALTHY";
  else if(!baselineFresh) reason="BASELINE_STALE";
  else if(integrity.safeForExperiments !== true) reason="SOURCE_INTEGRITY_BLOCKED";
  else if(!v.eligibleForSandbox) reason="SANDBOX_NOT_ELIGIBLE";
  else if(candidate?.actionable !== true) reason="CANDIDATE_NOT_ACTIONABLE";
  else if(!["P0","P1"].includes(candidate?.priority)) reason="PRIORITY_TOO_LOW";

  return {
    experimentId:v.experimentId,
    candidateId:v.candidateId,
    authorized:permitted,
    reason,
    constraints:{
      isolatedDryRunOnly:true,
      repoWrite:false,
      networkWrite:false,
      secrets:false,
      production:false,
      automaticMerge:false,
      automaticDeploy:false,
      maxCostUsd:0
    }
  };
});

const out={
  schemaVersion:"origin.self-evolution.authorization.v2",
  generatedAt:new Date().toISOString(),
  baselineGeneratedAt:baseline.generatedAt,
  baselineFresh,
  baselineAgeMs:ageMs,
  sourceIntegritySafe:integrity.safeForExperiments === true,
  evaluationFreeze:freeze,
  disabled,
  summary:{
    total:decisions.length,
    authorized:decisions.filter(x=>x.authorized).length,
    blocked:decisions.filter(x=>!x.authorized).length
  },
  decisions
};

writeFileSync("origin-self-evolution-authorization-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-authorization-v2.md",[
  "# ORIGIN Self-Evolution V2 Authorization Gate",
  "",
  `Baseline fresh: ${baselineFresh}`,
  `Source integrity safe: ${out.sourceIntegritySafe}`,
  `Evaluation freeze: ${freeze}`,
  `Authorized isolated dry-runs: ${out.summary.authorized}`,
  `Blocked: ${out.summary.blocked}`,
  "",
  "Authorization here never grants repository write, merge, deployment, secret access, or Production access."
].join("\n")+"\n");

console.log(JSON.stringify({ok:true,summary:out.summary}));
