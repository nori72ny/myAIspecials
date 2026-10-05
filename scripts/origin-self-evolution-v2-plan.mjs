import { readFileSync, writeFileSync } from "node:fs";

const input = JSON.parse(readFileSync("origin-self-evolution-v2.json", "utf8"));

const LOW_RISK_COMPONENTS = new Set(["docs", "tests", "dependency"]);
const SENSITIVE_CATEGORIES = new Set(["security", "provider", "pricing", "privacy", "permissions", "secrets"]);

function route(hypothesis) {
  const sensitive = SENSITIVE_CATEGORIES.has(hypothesis.category);
  const primary = hypothesis.tier === "A";
  if (sensitive && !primary) {
    return {
      lane: "RESEARCH_ONLY",
      reason: "Sensitive changes require Tier A primary evidence before implementation."
    };
  }
  if (hypothesis.evidenceClass === "DISCOVERY_SIGNAL" || hypothesis.evidenceClass === "RESEARCH_SIGNAL") {
    return {
      lane: "CONFIRM_PRIMARY_EVIDENCE",
      reason: "Discovery/research evidence may challenge ORIGIN but cannot directly authorize implementation."
    };
  }
  return {
    lane: "BASELINE_COMPARISON",
    reason: "Primary evidence is available; compare against exact ORIGIN baseline before proposing an experiment."
  };
}

const candidates = input.hypotheses.map((hypothesis) => ({
  ...hypothesis,
  ...route(hypothesis),
  automation: {
    codeWriteAllowed: false,
    mergeAllowed: false,
    productionDeployAllowed: false,
    ownerApprovalRequiredForSensitiveBoundary: true
  },
  experimentContract: {
    exactBaseSha: input.sha,
    isolateBranch: true,
    requireRollback: true,
    requireRelevantTests: true,
    requireNoRegression: true,
    requireMeasuredImprovement: true,
    maxCostUsd: 0
  }
}));

const output = {
  schemaVersion: "origin.self-evolution.candidates.v2",
  generatedAt: new Date().toISOString(),
  sourceObservationSha: input.sha,
  invariant: input.invariant,
  summary: {
    total: candidates.length,
    baselineComparison: candidates.filter((x) => x.lane === "BASELINE_COMPARISON").length,
    confirmPrimaryEvidence: candidates.filter((x) => x.lane === "CONFIRM_PRIMARY_EVIDENCE").length,
    researchOnly: candidates.filter((x) => x.lane === "RESEARCH_ONLY").length
  },
  candidates
};

writeFileSync("origin-self-evolution-candidates-v2.json", JSON.stringify(output, null, 2) + "\n");
writeFileSync("origin-self-evolution-candidates-v2.md", [
  "# ORIGIN Self-Evolution V2 Candidate Queue",
  "",
  `Exact baseline SHA: ${input.sha}`,
  `Candidates: ${candidates.length}`,
  "",
  "No candidate is an update decision. Every candidate must first prove a measurable improvement over exact current ORIGIN.",
  "",
  ...candidates.map((c) => `- ${c.id} [${c.category}] ${c.lane}: ${c.reason}`)
].join("\n") + "\n");

console.log(JSON.stringify({ ok: true, summary: output.summary }));
