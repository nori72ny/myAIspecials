import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const hash=(v)=>createHash("sha256").update(String(v)).digest("hex");
const pkg=JSON.parse(readFileSync("package.json","utf8"));
const base=process.env.ORIGIN_CANONICAL_BASE || "https://origin-personal.vercel.app";

async function getJson(path){
  try{
    const r=await fetch(new URL(path,base),{
      redirect:"error",
      headers:{Accept:"application/json","User-Agent":"ORIGIN-Self-Evolution-V2/1.0"}
    });
    const text=await r.text();
    let body=null;
    try{body=JSON.parse(text);}catch{}
    return {ok:r.ok,status:r.status,body};
  }catch{
    return {ok:false,status:0,body:null};
  }
}

const [health,research,coding,artifacts,builder,raster]=await Promise.all([
  getJson("/api/health"),
  getJson("/api/research/v1.1/status"),
  getJson("/api/coding/v1.4/status"),
  getJson("/api/artifacts/v1.2/status"),
  getJson("/api/builder/v1.3/status"),
  getJson("/api/creative/v1.5/raster/status")
]);

const baseline={
  schemaVersion:"origin.self-evolution.baseline.v2",
  generatedAt:new Date().toISOString(),
  repository:process.env.GITHUB_REPOSITORY || "nori72ny/myAIspecials",
  workflowSha:process.env.GITHUB_SHA || "unknown",
  packageVersion:pkg.version || null,
  canonicalBase:base,
  invariants:{
    maxCostUsd:0,
    paidFallbackEnabled:false,
    secretDelivery:"server-only"
  },
  production:{health,research,coding,artifacts,builder,raster}
};

const canonical=JSON.stringify(baseline.production);
baseline.fingerprint=hash(canonical);
baseline.productionHealthy=
  health.ok &&
  health.body?.status==="ok" &&
  health.body?.costUsd===0 &&
  health.body?.freeOnly===true &&
  health.body?.paidFallbackEnabled===false &&
  health.body?.secretDelivery==="server-only";

writeFileSync("origin-self-evolution-baseline-v2.json",JSON.stringify(baseline,null,2)+"\n");
writeFileSync("origin-self-evolution-baseline-v2.md",[
  "# ORIGIN Self-Evolution V2 Baseline",
  "",
  `Workflow SHA: ${baseline.workflowSha}`,
  `Production healthy: ${baseline.productionHealthy}`,
  `Fingerprint: ${baseline.fingerprint}`,
  "",
  "This file records the observed ORIGIN baseline. It does not mutate Production."
].join("\n")+"\n");

if(!baseline.productionHealthy) process.exitCode=2;
console.log(JSON.stringify({ok:baseline.productionHealthy,fingerprint:baseline.fingerprint}));
