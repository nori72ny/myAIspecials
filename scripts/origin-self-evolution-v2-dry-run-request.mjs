import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const authorization=JSON.parse(readFileSync("origin-self-evolution-authorization-v2.json","utf8"));
const experiments=JSON.parse(readFileSync("origin-self-evolution-experiments-v2.json","utf8"));
const registry=JSON.parse(readFileSync("config/origin-self-evolution-adapters.json","utf8"));

const hash=(v)=>createHash("sha256").update(String(v)).digest("hex");
const byCandidate=new Map(priority.ranked.map(x=>[x.id,x]));
const expByCandidate=new Map(experiments.experiments.map(x=>[x.candidateId,x]));

function selectAdapter(candidate){
  const matches=registry.adapters.filter(adapter=>
    adapter.allowedCategories.includes(candidate.category) &&
    adapter.capabilityAxes.some(axis=>(candidate.capabilityAxes||[]).includes(axis))
  );
  return matches.length===1?matches[0]:null;
}

const requests=authorization.decisions.map(decision=>{
  const candidate=byCandidate.get(decision.candidateId);
  const experiment=expByCandidate.get(decision.candidateId);
  const adapter=candidate?selectAdapter(candidate):null;
  const ready=
    decision.authorized===true &&
    experiment?.executable===true &&
    adapter &&
    adapter.networkWrite===false &&
    adapter.repoWrite===false &&
    adapter.productionAccess===false &&
    adapter.secrets===false &&
    adapter.paidProvider===false &&
    adapter.maxCostUsd===0;

  let reason="READY_FOR_INTERNAL_DRY_RUN";
  if(decision.authorized!==true) reason=decision.reason||"NOT_AUTHORIZED";
  else if(experiment?.executable!==true) reason="EXPERIMENT_SPEC_NOT_EXECUTABLE";
  else if(!adapter) reason="NO_UNIQUE_ALLOWLISTED_ADAPTER";
  else if(!ready) reason="ADAPTER_BOUNDARY_INVALID";

  return {
    requestId:hash([priority.exactBaseSha,decision.experimentId,adapter?.id||"none"].join("|")).slice(0,24),
    exactBaseSha:priority.exactBaseSha,
    candidateId:decision.candidateId,
    experimentId:decision.experimentId,
    status:ready?"READY_FOR_INTERNAL_DRY_RUN":"NOT_RUN",
    reason,
    adapterId:adapter?.id||null,
    commandClass:adapter?.commandClass||null,
    externalCommand:null,
    constraints:{
      allowlistedAdapterOnly:true,
      networkWrite:false,
      repoWrite:false,
      productionAccess:false,
      secrets:false,
      paidProvider:false,
      maxCostUsd:0
    }
  };
});

const out={
  schemaVersion:"origin.self-evolution.dry-run-requests.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:priority.exactBaseSha,
  evaluationFreeze:authorization.evaluationFreeze,
  summary:{
    total:requests.length,
    ready:requests.filter(x=>x.status==="READY_FOR_INTERNAL_DRY_RUN").length,
    notRun:requests.filter(x=>x.status==="NOT_RUN").length
  },
  requests
};

writeFileSync("origin-self-evolution-dry-run-requests-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-dry-run-requests-v2.md",[
  "# ORIGIN Self-Evolution V2 Dry-Run Requests",
  "",
  `Exact base SHA: ${out.exactBaseSha}`,
  `Evaluation freeze: ${out.evaluationFreeze}`,
  `Ready: ${out.summary.ready}`,
  `Not run: ${out.summary.notRun}`,
  "",
  "Requests may reference only internal allowlisted adapters. External evidence can never supply a shell command or executable payload.",
  ...requests.map(x=>`- ${x.requestId} ${x.status} adapter=${x.adapterId||"none"} reason=${x.reason}`)
].join("\n")+"\n");

console.log(JSON.stringify({ok:true,summary:out.summary}));
