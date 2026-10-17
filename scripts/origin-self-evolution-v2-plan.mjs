import { readFileSync, writeFileSync } from "node:fs";

const input=JSON.parse(readFileSync("origin-self-evolution-v2.json","utf8"));
const integrity=JSON.parse(readFileSync("origin-self-evolution-source-integrity-v2.json","utf8"));
const capabilityMap=JSON.parse(readFileSync("config/origin-self-evolution-capabilities.json","utf8"));

const SENSITIVE_CATEGORIES=new Set(["security","provider","pricing","privacy","permissions","secrets"]);
const blocked=new Set(integrity.blockedEvidenceFingerprints||[]);

function route(hypothesis){
  const sensitive=SENSITIVE_CATEGORIES.has(hypothesis.category);
  const primary=hypothesis.tier==="A";
  if(sensitive&&!primary) return {lane:"RESEARCH_ONLY",reason:"Sensitive changes require Tier A primary evidence before implementation."};
  if(hypothesis.evidenceClass==="DISCOVERY_SIGNAL"||hypothesis.evidenceClass==="RESEARCH_SIGNAL"){
    return {lane:"CONFIRM_PRIMARY_EVIDENCE",reason:"Discovery/research evidence may challenge ORIGIN but cannot directly authorize implementation."};
  }
  return {lane:"BASELINE_COMPARISON",reason:"Primary evidence is available; compare against exact ORIGIN baseline before proposing an experiment."};
}

const eligibleHypotheses=integrity.safeForPlanning
  ? input.hypotheses.filter(h=>!blocked.has(h.evidenceFingerprint))
  : [];

const candidates=eligibleHypotheses.map(hypothesis=>{
  const capability=capabilityMap.categories?.[hypothesis.category]||{axes:["unmapped"],requiredGates:["exact-sha","manual-review"]};
  return {
    ...hypothesis,
    ...route(hypothesis),
    capabilityAxes:capability.axes,
    requiredGates:capability.requiredGates,
    automation:{
      codeWriteAllowed:false,
      mergeAllowed:false,
      productionDeployAllowed:false,
      ownerApprovalRequiredForSensitiveBoundary:true
    },
    experimentContract:{
      exactBaseSha:input.sha,
      isolateBranch:true,
      requireRollback:true,
      requireRelevantTests:true,
      requireNoRegression:true,
      requireMeasuredImprovement:true,
      maxCostUsd:0
    }
  };
});

const output={
  schemaVersion:"origin.self-evolution.candidates.v2",
  generatedAt:new Date().toISOString(),
  sourceObservationSha:input.sha,
  sourceIntegritySafe:integrity.safeForPlanning,
  blockedEvidenceCount:blocked.size,
  invariant:input.invariant,
  summary:{
    total:candidates.length,
    baselineComparison:candidates.filter(x=>x.lane==="BASELINE_COMPARISON").length,
    confirmPrimaryEvidence:candidates.filter(x=>x.lane==="CONFIRM_PRIMARY_EVIDENCE").length,
    researchOnly:candidates.filter(x=>x.lane==="RESEARCH_ONLY").length
  },
  candidates
};

writeFileSync("origin-self-evolution-candidates-v2.json",JSON.stringify(output,null,2)+"\n");
writeFileSync("origin-self-evolution-candidates-v2.md",[
  "# ORIGIN Self-Evolution V2 Candidate Queue",
  "",
  `Exact baseline SHA: ${input.sha}`,
  `Source integrity safe: ${integrity.safeForPlanning}`,
  `Blocked evidence: ${blocked.size}`,
  `Candidates: ${candidates.length}`,
  "",
  "No candidate is an update decision. Every candidate must first prove a measurable improvement over exact current ORIGIN.",
  "",
  ...candidates.map(c=>`- ${c.id} [${c.category}] ${c.lane} | axes=${c.capabilityAxes.join(",")} | gates=${c.requiredGates.join(",")}`)
].join("\n")+"\n");

console.log(JSON.stringify({ok:integrity.safeForPlanning,summary:output.summary}));
