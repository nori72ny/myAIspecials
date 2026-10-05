import { readFileSync, writeFileSync } from "node:fs";

const baseline=JSON.parse(readFileSync("origin-self-evolution-baseline-v2.json","utf8"));
const auth=JSON.parse(readFileSync("origin-self-evolution-authorization-v2.json","utf8"));
const integrity=JSON.parse(readFileSync("origin-self-evolution-source-integrity-v2.json","utf8"));

const trips=[];

if(baseline.productionHealthy !== true) trips.push("PRODUCTION_BASELINE_UNHEALTHY");
if(baseline.invariants?.maxCostUsd !== 0) trips.push("ZERO_COST_INVARIANT_BROKEN");
if(baseline.invariants?.paidFallbackEnabled !== false) trips.push("PAID_FALLBACK_INVARIANT_BROKEN");
if(baseline.invariants?.secretDelivery !== "server-only") trips.push("SECRET_DELIVERY_INVARIANT_BROKEN");
if(auth.baselineFresh !== true) trips.push("BASELINE_STALE");
if(integrity.safeForPlanning !== true) trips.push("SOURCE_INTEGRITY_PLANNING_UNSAFE");
if(auth.sourceIntegritySafe !== true && auth.summary.authorized > 0) trips.push("SOURCE_INTEGRITY_AUTHORIZATION_BUG");
if(auth.evaluationFreeze === true && auth.summary.authorized > 0) trips.push("FREEZE_AUTHORIZATION_BUG");
if(auth.disabled === true && auth.summary.authorized > 0) trips.push("DISABLED_AUTHORIZATION_BUG");

const tripped=trips.length>0;
const out={
  schemaVersion:"origin.self-evolution.circuit-breaker.v2",
  generatedAt:new Date().toISOString(),
  tripped,
  trips,
  action:tripped?"HALT_ALL_EXPERIMENTS":"ALLOW_AUTHORIZED_DRY_RUNS_ONLY",
  rollback:{
    automaticProductionRollback:false,
    reason:"Self-Evolution V2 has no Production mutation authority; rollback means halt experiments and retain the last verified baseline."
  }
};

writeFileSync("origin-self-evolution-circuit-breaker-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-circuit-breaker-v2.md",[
  "# ORIGIN Self-Evolution V2 Circuit Breaker",
  "",
  `Tripped: ${tripped}`,
  `Action: ${out.action}`,
  ...trips.map(x=>`- ${x}`)
].join("\n")+"\n");

if(tripped) process.exitCode=3;
console.log(JSON.stringify({ok:!tripped,trips}));
