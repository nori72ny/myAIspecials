import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const h=(v)=>createHash("sha256").update(String(v)).digest("hex");
const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const auth=JSON.parse(readFileSync("origin-self-evolution-authorization-v2.json","utf8"));
const breaker=JSON.parse(readFileSync("origin-self-evolution-circuit-breaker-v2.json","utf8"));

const authByCandidate=new Map(auth.decisions.map(x=>[x.candidateId,x]));
const entries=priority.ranked.map(c=>{
  const a=authByCandidate.get(c.id);
  const decision=breaker.tripped
    ? "HALT"
    : a?.authorized
      ? "EXPERIMENT_READY"
      : c.lane==="CONFIRM_PRIMARY_EVIDENCE"
        ? "NEEDS_PRIMARY_EVIDENCE"
        : c.lane==="RESEARCH_ONLY"
          ? "RESEARCH_ONLY"
          : "HOLD";
  const reason=breaker.tripped ? breaker.trips.join(",") : (a?.reason || c.lane);
  return {
    ledgerId:h([priority.exactBaseSha,c.id,c.evidenceFingerprint,decision,reason].join("|")).slice(0,24),
    candidateId:c.id,
    category:c.category,
    priority:c.priority,
    decision,
    reason,
    source:c.source,
    evidenceTier:c.tier,
    evidenceFingerprint:c.evidenceFingerprint,
    exactBaseSha:priority.exactBaseSha,
    baselineFingerprint:priority.baselineFingerprint
  };
});

const out={
  schemaVersion:"origin.self-evolution.decision-ledger.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:priority.exactBaseSha,
  queueFingerprint:priority.queueFingerprint,
  circuitBreakerTripped:breaker.tripped,
  entries
};
writeFileSync("origin-self-evolution-decision-ledger-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-decision-ledger-v2.md",[
  "# ORIGIN Self-Evolution V2 Decision Ledger",
  "",
  `Exact base SHA: ${out.exactBaseSha}`,
  `Circuit breaker: ${out.circuitBreakerTripped ? "TRIPPED" : "CLEAR"}`,
  "",
  ...entries.map(x=>`- ${x.ledgerId} ${x.priority} ${x.category}: ${x.decision} — ${x.reason}`)
].join("\n")+"\n");
console.log(JSON.stringify({ok:true,entries:entries.length}));
