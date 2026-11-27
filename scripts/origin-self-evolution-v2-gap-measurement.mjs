import { readFileSync, writeFileSync } from "node:fs";
import { readBoundedRunnerTempFile } from "./origin-self-evolution-v2-runner-temp.mjs";

const rawInput=String(process.env.ORIGIN_SELF_EVOLUTION_GAP_MEASUREMENT_PATH||"");
const runnerTemp=String(process.env.RUNNER_TEMP||"");
const queue=JSON.parse(readFileSync("origin-self-evolution-candidates-v2.json","utf8"));
const byCandidate=new Map(queue.candidates.map(c=>[c.id,c]));

function empty(status,reason){
  return {
    schemaVersion:"origin.self-evolution.gap-measurement-evaluation.v2",
    generatedAt:new Date().toISOString(),
    exactBaseSha:queue.sourceObservationSha,
    status,
    reason,
    acceptedMeasurements:[]
  };
}

let out;
const inputRead=readBoundedRunnerTempFile(rawInput,runnerTemp,65536);
if(!rawInput){
  out=empty("NOT_MEASURED","GAP_MEASUREMENT_INPUT_MISSING");
}else if(inputRead.code==="NOT_FOUND"){
  out=empty("NOT_MEASURED","GAP_MEASUREMENT_INPUT_NOT_FOUND");
}else if(inputRead.code==="TOO_LARGE"){
  out=empty("REJECTED","GAP_MEASUREMENT_INPUT_TOO_LARGE");
}else if(inputRead.code==="REALPATH_UNSAFE"){
  out=empty("REJECTED","GAP_MEASUREMENT_INPUT_REALPATH_UNSAFE");
}else if(inputRead.code==="CHANGED_DURING_READ"){
  out=empty("REJECTED","GAP_MEASUREMENT_INPUT_CHANGED_DURING_READ");
}else if(inputRead.ok!==true){
  out=empty("REJECTED","GAP_MEASUREMENT_INPUT_PATH_UNSAFE");
}else{
  let input;
  try{ input=JSON.parse(inputRead.bytes.toString("utf8")); }catch{ input=null; }

  if(!input || input.schemaVersion!=="origin.self-evolution.gap-measurement.v2" || input.exactBaseSha!==queue.sourceObservationSha || !Array.isArray(input.measurements)){
    out=empty("REJECTED","GAP_MEASUREMENT_BINDING_INVALID");
  }else{
    const accepted=[];
    for(const m of input.measurements.slice(0,50)){
      const candidate=byCandidate.get(m?.candidateId);
      const metric=m?.metric||{};
      const originScore=Number(metric.originScore);
      const referenceScore=Number(metric.referenceScore);
      const minGap=Number(metric.minGap);
      const direction=metric.direction;
      const finite=[originScore,referenceScore,minGap].every(Number.isFinite);
      const axis=String(m?.capabilityAxis||"");
      const axisOk=Boolean(candidate?.capabilityAxes?.includes(axis));
      const evidenceOk=
        m?.evidenceKind==="REPRODUCIBLE_NON_HELD_OUT" &&
        m?.privateHeldOut===false &&
        typeof m?.evidenceRef==="string" &&
        m.evidenceRef.length>=8 &&
        m.evidenceRef.length<=512;
      const bindingOk=
        Boolean(candidate) &&
        m?.exactBaseSha===queue.sourceObservationSha &&
        axisOk &&
        finite &&
        minGap>0 &&
        ["higher_is_better","lower_is_better"].includes(direction);
      const measuredGap=finite
        ? direction==="lower_is_better" ? originScore-referenceScore : referenceScore-originScore
        : Number.NaN;
      if(bindingOk && evidenceOk && measuredGap>=minGap && measuredGap>0){
        accepted.push({
          candidateId:m.candidateId,
          capabilityAxis:axis,
          evidenceKind:m.evidenceKind,
          evidenceRef:m.evidenceRef,
          metric:{
            name:String(metric.name||"unnamed"),
            direction,
            originScore,
            referenceScore,
            minGap,
            measuredGap
          }
        });
      }
    }
    out={
      schemaVersion:"origin.self-evolution.gap-measurement-evaluation.v2",
      generatedAt:new Date().toISOString(),
      exactBaseSha:queue.sourceObservationSha,
      status:accepted.length>0?"MEASURED_GAP":"NOT_MEASURED",
      reason:accepted.length>0?"REPRODUCIBLE_GAP_EVIDENCE_ACCEPTED":"NO_VALID_MEASURED_GAP",
      acceptedMeasurements:accepted
    };
  }
}

writeFileSync("origin-self-evolution-gap-measurement-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-gap-measurement-v2.md",[
  "# ORIGIN Self-Evolution V2 Gap Measurement",
  "",
  `Status: ${out.status}`,
  `Reason: ${out.reason}`,
  `Exact base SHA: ${out.exactBaseSha}`,
  `Accepted measurements: ${out.acceptedMeasurements.length}`,
  "",
  "Only reproducible non-held-out evidence bound to the exact base SHA can open a dry-run measurement opportunity."
].join("\n")+"\n");
console.log(JSON.stringify({ok:true,status:out.status,accepted:out.acceptedMeasurements.length}));
