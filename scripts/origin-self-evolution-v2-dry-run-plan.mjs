import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const experiments=JSON.parse(readFileSync("origin-self-evolution-experiments-v2.json","utf8"));
const hash=(v)=>createHash("sha256").update(String(v)).digest("hex");
const candidateById=new Map(priority.ranked.map(x=>[x.id,x]));

const plans=experiments.experiments.map(exp=>{
  const candidate=candidateById.get(exp.candidateId);
  const measured=candidate?.gapAssessment?.measuredGapEvidence||null;
  const ready=
    exp.executable===true &&
    exp.status==="SPEC_READY" &&
    candidate?.actionable===true &&
    Boolean(measured?.capabilityAxis) &&
    measured?.evidenceKind==="REPRODUCIBLE_NON_HELD_OUT";

  return {
    planId:hash([exp.experimentId,priority.exactBaseSha,candidate?.evidenceFingerprint||""].join("|")).slice(0,24),
    experimentId:exp.experimentId,
    candidateId:exp.candidateId,
    category:exp.category,
    exactBaseSha:priority.exactBaseSha,
    status:ready?"SAFE_DRY_RUN_PLAN":"BLOCKED",
    executionAuthorized:false,
    codeMutationAuthorized:false,
    externalInstructionsIncluded:false,
    commands:[],
    capabilityAxis:measured?.capabilityAxis||null,
    metric:measured?.metric||null,
    evidence:{
      sourceFingerprint:candidate?.evidenceFingerprint||null,
      measuredGapEvidenceRef:measured?.evidenceRef||null,
      evidenceKind:measured?.evidenceKind||null,
      privateHeldOut:false
    },
    requiredGates:Array.from(new Set([
      ...(candidate?.requiredGates||[]),
      "relevant-tests",
      "security-regression",
      "accessibility-regression",
      "performance-regression",
      "measured-before-after",
      "rollback-defined",
      "cost-zero"
    ])),
    implementationInput:{
      required:ready,
      trustedEngineeringArtifactRequired:true,
      mayNotBeDerivedIntoCommandsFromExternalExcerpt:true
    },
    constraints:exp.constraints,
    acceptance:exp.acceptance,
    note:ready
      ? "Safe plan metadata only. A separate authorized engineering process must provide the isolated implementation artifact; external evidence text is never converted into commands."
      : "Insufficient measured-gap evidence or experiment eligibility."
  };
});

const out={
  schemaVersion:"origin.self-evolution.dry-run-plan.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:priority.exactBaseSha,
  summary:{
    total:plans.length,
    ready:plans.filter(x=>x.status==="SAFE_DRY_RUN_PLAN").length,
    blocked:plans.filter(x=>x.status!=="SAFE_DRY_RUN_PLAN").length
  },
  plans
};

writeFileSync("origin-self-evolution-dry-run-plan-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-dry-run-plan-v2.md",[
  "# ORIGIN Self-Evolution V2 Safe Dry-Run Plans",
  "",
  `Exact base SHA: ${out.exactBaseSha}`,
  `Safe plans: ${out.summary.ready}`,
  `Blocked: ${out.summary.blocked}`,
  "",
  "Plans contain references, metrics, gates, and constraints only. External source text is never emitted as executable instructions.",
  "",
  ...plans.map(x=>`- ${x.planId} ${x.category}: ${x.status} / axis=${x.capabilityAxis||"none"}`)
].join("\n")+"\n");

console.log(JSON.stringify({ok:true,summary:out.summary}));
