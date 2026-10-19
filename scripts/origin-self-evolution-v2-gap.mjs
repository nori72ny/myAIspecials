import { readFileSync, writeFileSync } from "node:fs";

const queue=JSON.parse(readFileSync("origin-self-evolution-candidates-v2.json","utf8"));
const baseline=JSON.parse(readFileSync("origin-self-evolution-baseline-v2.json","utf8"));
const measurement=JSON.parse(readFileSync("origin-self-evolution-gap-measurement-v2.json","utf8"));
const measuredByCandidate=new Map(measurement.acceptedMeasurements.map(x=>[x.candidateId,x]));

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
  const measured=measuredByCandidate.get(candidate.id)||null;
  const measuredImprovementOpportunity=Boolean(measured);
  return {
    candidateId:candidate.id,
    category:candidate.category,
    exactBaseSha:queue.sourceObservationSha,
    capabilityAxes:candidate.capabilityAxes||[],
    requiredGates:candidate.requiredGates||[],
    ...gap,
    measuredGapEvidence:measured,
    solutionFitVerified:false,
    measuredImprovementOpportunity,
    actionability:measuredImprovementOpportunity
      ? "DRY_RUN_EXPERIMENT_MEASUREMENT_ELIGIBLE"
      : "BLOCKED_PENDING_MEASURED_GAP",
    requiredNextEvidence:measuredImprovementOpportunity
      ? "Run an isolated zero-cost dry-run to test whether this specific technique improves the measured ORIGIN gap without regression."
      : gap.gapKnown
        ? "Capture reproducible non-held-out evidence quantifying this known ORIGIN gap on a mapped capability axis."
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
