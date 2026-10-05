import { readFileSync, writeFileSync } from "node:fs";

const queue=JSON.parse(readFileSync("origin-self-evolution-candidates-v2.json","utf8"));
const baseline=JSON.parse(readFileSync("origin-self-evolution-baseline-v2.json","utf8"));

function knownRuntimeGap(candidate){
  if(candidate.category==="image-multimodal"){
    const raster=baseline.production?.raster;
    if(raster?.ok!==true || raster?.body?.ready!==true){
      return {
        gapKnown:true,
        gapStatus:"KNOWN_RUNTIME_GAP",
        evidencePath:"production.raster",
        note:"Production raster capability is not ready, but this does not prove the external observation is a valid solution."
      };
    }
  }
  return {
    gapKnown:false,
    gapStatus:"NOT_MEASURED",
    evidencePath:null,
    note:"No deterministic baseline evidence proves a capability gap for this observation."
  };
}

const assessments=queue.candidates.map(candidate=>{
  const gap=knownRuntimeGap(candidate);
  return {
    candidateId:candidate.id,
    category:candidate.category,
    exactBaseSha:queue.sourceObservationSha,
    capabilityAxes:candidate.capabilityAxes||[],
    requiredGates:candidate.requiredGates||[],
    ...gap,
    solutionFitVerified:false,
    measuredImprovementOpportunity:false,
    actionability:"BLOCKED_PENDING_MEASURED_GAP_AND_SOLUTION_FIT",
    requiredNextEvidence:gap.gapKnown
      ? "Measure whether this specific proposed technique improves the known ORIGIN gap without regression."
      : "Measure ORIGIN on the mapped capability axes before claiming a gap."
  };
});

const out={
  schemaVersion:"origin.self-evolution.gap-assessment.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:queue.sourceObservationSha,
  baselineFingerprint:baseline.fingerprint,
  summary:{
    total:assessments.length,
    knownRuntimeGap:assessments.filter(x=>x.gapKnown).length,
    measuredOpportunity:assessments.filter(x=>x.measuredImprovementOpportunity).length,
    blocked:assessments.filter(x=>!x.measuredImprovementOpportunity).length
  },
  assessments
};

writeFileSync("origin-self-evolution-gap-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-gap-v2.md",[
  "# ORIGIN Self-Evolution V2 Gap Assessment",
  "",
  `Exact base SHA: ${out.exactBaseSha}`,
  `Known runtime gaps: ${out.summary.knownRuntimeGap}`,
  `Measured improvement opportunities: ${out.summary.measuredOpportunity}`,
  `Blocked pending measurement: ${out.summary.blocked}`,
  "",
  "External novelty is not a gap. A known ORIGIN limitation is not proof that a specific external technique improves it.",
  "",
  ...assessments.map(x=>`- ${x.candidateId} ${x.category}: ${x.gapStatus} / solutionFitVerified=${x.solutionFitVerified}`)
].join("\n")+"\n");

console.log(JSON.stringify({ok:true,summary:out.summary}));
