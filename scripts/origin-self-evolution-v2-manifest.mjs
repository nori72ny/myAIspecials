import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const experiments=JSON.parse(readFileSync("origin-self-evolution-experiments-v2.json","utf8"));
const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const authorization=JSON.parse(readFileSync("origin-self-evolution-authorization-v2.json","utf8"));
const breaker=JSON.parse(readFileSync("origin-self-evolution-circuit-breaker-v2.json","utf8"));
const requests=JSON.parse(readFileSync("origin-self-evolution-dry-run-requests-v2.json","utf8"));
const briefs=JSON.parse(readFileSync("origin-self-evolution-implementation-briefs-v2.json","utf8"));
const policy=JSON.parse(readFileSync("config/origin-self-evolution-experiment-policy.json","utf8"));

const hash=(v)=>createHash("sha256").update(String(v)).digest("hex");
const candidateById=new Map(priority.ranked.map(x=>[x.id,x]));
const authByExperiment=new Map(authorization.decisions.map(x=>[x.experimentId,x]));
const requestByExperiment=new Map(requests.requests.map(x=>[x.experimentId,x]));
const briefByCandidate=new Map(briefs.briefs.map(x=>[x.candidateId,x]));

const manifests=experiments.experiments
  .filter(exp=>exp.status==="SPEC_READY")
  .map(exp=>{
    const candidate=candidateById.get(exp.candidateId);
    const auth=authByExperiment.get(exp.experimentId);
    const request=requestByExperiment.get(exp.experimentId);
    const brief=briefByCandidate.get(exp.candidateId);
    const executionReady=
      breaker.tripped!==true &&
      auth?.authorized===true &&
      candidate?.actionable===true &&
      request?.status==="READY_FOR_INTERNAL_DRY_RUN" &&
      brief?.briefType==="IMPLEMENTATION_EXPERIMENT_BRIEF";

    return {
      schemaVersion:"origin.self-evolution.experiment-manifest.v2",
      manifestId:hash([exp.experimentId,priority.exactBaseSha,priority.queueFingerprint].join("|")).slice(0,24),
      experimentId:exp.experimentId,
      candidateId:exp.candidateId,
      category:exp.category,
      exactBaseSha:priority.exactBaseSha,
      capabilityAxes:candidate?.capabilityAxes||[],
      requiredCandidateGates:candidate?.requiredGates||[],
      riskClass:"BOUNDED_EPHEMERAL_CODE_EXPERIMENT",
      executionAuthority:policy.executionAuthority,
      executionReady,
      adapterId:request?.adapterId||null,
      commandClass:request?.commandClass||null,
      implementationBriefId:brief?.briefId||null,
      blockedReason:executionReady
        ? null
        : breaker.tripped
          ? "CIRCUIT_BREAKER_TRIPPED"
          : auth?.authorized!==true
            ? auth?.reason||"NOT_AUTHORIZED"
            : request?.status!=="READY_FOR_INTERNAL_DRY_RUN"
              ? request?.reason||"DRY_RUN_REQUEST_NOT_READY"
              : brief?.briefType!=="IMPLEMENTATION_EXPERIMENT_BRIEF"
                ? "IMPLEMENTATION_BRIEF_NOT_READY"
                : "MANIFEST_NOT_READY",
      objective:"Test whether the candidate technique measurably improves the already-observed ORIGIN gap without regression.",
      boundaries:{
        ...policy.defaults,
        protectedPathPrefixes:policy.protectedPathPrefixes,
        protectedFileNames:policy.protectedFileNames
      },
      requiredGates:[...new Set([...(policy.requiredUniversalGates||[]),...(candidate?.requiredGates||[])])],
      evidenceContract:{
        beforeAfterRequired:true,
        exactBaseShaRequired:true,
        candidateBindingRequired:true,
        experimentBindingRequired:true,
        reproducibleNonHeldOutOnly:true,
        privateHeldOutForbidden:true,
        missingEvidenceStatus:"NOT_MEASURED",
        resultManifestBindingRequired:true,
        resultAdapterBindingRequired:true,
        resultImplementationBriefBindingRequired:true,
        resultArtifactSha256Required:true,
        resultExecutionReceiptRequired:true
      },
      outputAuthority:{
        mayProducePatchArtifact:true,
        mayWriteRepository:false,
        mayOpenPr:false,
        mayMerge:false,
        mayDeploy:false,
        mayChangeSecrets:false,
        mayChangeBilling:false
      }
    };
  });

const out={
  schemaVersion:"origin.self-evolution.experiment-manifest-set.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:priority.exactBaseSha,
  evaluationFreeze:authorization.evaluationFreeze,
  circuitBreakerTripped:breaker.tripped,
  summary:{
    total:manifests.length,
    executionReady:manifests.filter(x=>x.executionReady).length,
    blocked:manifests.filter(x=>!x.executionReady).length
  },
  manifests
};

writeFileSync("origin-self-evolution-experiment-manifests-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-experiment-manifests-v2.md",[
  "# ORIGIN Self-Evolution V2 Experiment Manifests",
  "",
  `Exact base SHA: ${out.exactBaseSha}`,
  `Execution-ready: ${out.summary.executionReady}`,
  `Blocked: ${out.summary.blocked}`,
  "",
  "Manifests are bounded experiment requests for a separate authorized orchestrator. Self-Evolution itself cannot write code, open PRs, merge, deploy, mutate secrets, or incur cost.",
  "",
  ...manifests.map(m=>`- ${m.manifestId} ${m.category}: executionReady=${m.executionReady} / ${m.blockedReason||"AUTHORIZED"}`)
].join("\n")+"\n");

console.log(JSON.stringify({ok:true,summary:out.summary}));
