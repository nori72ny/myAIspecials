import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const requests=JSON.parse(readFileSync("origin-self-evolution-dry-run-requests-v2.json","utf8"));
const hash=(v)=>createHash("sha256").update(String(v)).digest("hex");

const requestByCandidate=new Map(requests.requests.map(x=>[x.candidateId,x]));

const componentHints={
  "ai-models":["answer-runtime","research","multimodal"],
  "agents-coding":["agent-runtime","coding","tool-routing"],
  "image-multimodal":["creative","image-generation","image-editing"],
  "security":["security","release-gates","supply-chain"],
  "platform-runtime":["server","runtime","observability"],
  "design-ux-a11y":["ui","ux","accessibility"],
  "standards-web":["web-platform","builder","artifact-isolation"]
};

const selected=priority.ranked.filter(x=>x.tier==="A" && ["P0","P1"].includes(x.priority));

const briefs=selected.map(candidate=>{
  const request=requestByCandidate.get(candidate.id);
  const ready=request?.status==="READY_FOR_INTERNAL_DRY_RUN";
  const gap=candidate.gapAssessment||null;
  const briefType=ready
    ? "IMPLEMENTATION_EXPERIMENT_BRIEF"
    : gap?.gapKnown===true || gap?.measuredGapEvidence
      ? "SOLUTION_FIT_MEASUREMENT_BRIEF"
      : "BASELINE_GAP_MEASUREMENT_BRIEF";

  return {
    briefId:hash([priority.exactBaseSha,candidate.id,briefType].join("|")).slice(0,24),
    exactBaseSha:priority.exactBaseSha,
    candidateId:candidate.id,
    category:candidate.category,
    priority:candidate.priority,
    briefType,
    source:{
      name:candidate.source,
      tier:candidate.tier,
      evidenceFingerprint:candidate.evidenceFingerprint
    },
    capabilityAxes:candidate.capabilityAxes||[],
    componentHints:componentHints[candidate.category]||["manual-scope"],
    problemStatement:ready
      ? "A measured ORIGIN gap exists and the candidate has passed current dry-run authorization. Design the smallest reversible experiment that can test solution fit."
      : gap?.gapKnown===true
        ? "ORIGIN has a known limitation in this area, but the external observation has not proven solution fit. Measure the specific hypothesis before implementation."
        : "The external observation is potentially relevant, but no reproducible ORIGIN capability gap is proven yet. Measure the baseline first.",
    requiredGates:candidate.requiredGates||[],
    requiredEvidence:ready
      ? [
          "exact-base-sha",
          "minimal-reversible-change",
          "before-after-metric",
          "relevant-regression-tests",
          "security-regression-check",
          "accessibility-regression-check",
          "performance-regression-check",
          "rollback-plan"
        ]
      : [
          "exact-base-sha",
          "reproducible-non-held-out-measurement",
          "mapped-capability-axis",
          "metric-direction",
          "minimum-material-gap"
        ],
    forbiddenChanges:[
      "main-direct-write",
      "production-direct-deploy",
      "secret-or-credential-change",
      "permission-expansion",
      "paid-provider-or-billing",
      "paid-fallback",
      "held-out-corpus-authorship-or-inspection",
      "security-gate-relaxation",
      "evaluation-bypass"
    ],
    authority:{
      codeWrite:false,
      branchCreate:false,
      pullRequestCreate:false,
      merge:false,
      deploy:false,
      secretWrite:false,
      environmentWrite:false,
      billing:false
    },
    nextAction:ready
      ? "Hand this brief to a separately authorized normal-development orchestration for an isolated branch experiment."
      : "Collect the required non-held-out measurement evidence; do not implement from this brief yet."
  };
});

const out={
  schemaVersion:"origin.self-evolution.implementation-briefs.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:priority.exactBaseSha,
  evaluationFreeze:requests.evaluationFreeze,
  summary:{
    total:briefs.length,
    implementationExperiment:briefs.filter(x=>x.briefType==="IMPLEMENTATION_EXPERIMENT_BRIEF").length,
    solutionFitMeasurement:briefs.filter(x=>x.briefType==="SOLUTION_FIT_MEASUREMENT_BRIEF").length,
    baselineGapMeasurement:briefs.filter(x=>x.briefType==="BASELINE_GAP_MEASUREMENT_BRIEF").length
  },
  briefs
};

writeFileSync("origin-self-evolution-implementation-briefs-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-implementation-briefs-v2.md",[
  "# ORIGIN Self-Evolution V2 Implementation Briefs",
  "",
  `Exact base SHA: ${out.exactBaseSha}`,
  `Evaluation freeze: ${out.evaluationFreeze}`,
  `Briefs: ${out.summary.total}`,
  "",
  "These briefs contain no code-write, branch, PR, merge, deploy, secret, env, or billing authority.",
  "",
  ...briefs.map(x=>[
    `## ${x.priority} ${x.category} — ${x.briefType}`,
    `- brief: ${x.briefId}`,
    `- candidate: ${x.candidateId}`,
    `- axes: ${x.capabilityAxes.join(", ")}`,
    `- next: ${x.nextAction}`
  ].join("\n"))
].join("\n")+"\n");

console.log(JSON.stringify({ok:true,summary:out.summary}));
