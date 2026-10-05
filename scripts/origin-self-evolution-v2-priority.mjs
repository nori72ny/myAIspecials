import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const hash=(v)=>createHash("sha256").update(String(v)).digest("hex");
const queue=JSON.parse(readFileSync("origin-self-evolution-candidates-v2.json","utf8"));
const baseline=JSON.parse(readFileSync("origin-self-evolution-baseline-v2.json","utf8"));

const ranked=queue.candidates.map(c=>{
  const evidenceWeight=c.tier==="A"?40:c.tier==="B"?25:c.tier==="C"?15:5;
  const domainWeight=["security","ai-models","agents-coding","image-multimodal"].includes(c.category)?20:10;
  const baselineWeight=baseline.productionHealthy?10:0;
  const score=Math.min(100,Number(c.score||0)+evidenceWeight+domainWeight+baselineWeight);
  const priority=score>=85?"P0":score>=70?"P1":score>=55?"P2":"P3";
  const actionable=c.lane==="BASELINE_COMPARISON" && c.tier==="A";
  return {...c,priority,priorityScore:score,actionable};
}).sort((a,b)=>b.priorityScore-a.priorityScore || a.id.localeCompare(b.id));

const actionable=ranked.filter(x=>x.actionable && ["P0","P1"].includes(x.priority));
const fingerprint=hash(JSON.stringify(actionable.map(x=>[x.id,x.evidenceFingerprint,x.priority])));

const out={
  schemaVersion:"origin.self-evolution.priority.v2",
  generatedAt:new Date().toISOString(),
  exactBaseSha:queue.sourceObservationSha,
  baselineFingerprint:baseline.fingerprint,
  queueFingerprint:fingerprint,
  summary:{
    total:ranked.length,
    actionableHighPriority:actionable.length,
    p0:ranked.filter(x=>x.priority==="P0").length,
    p1:ranked.filter(x=>x.priority==="P1").length,
    p2:ranked.filter(x=>x.priority==="P2").length,
    p3:ranked.filter(x=>x.priority==="P3").length
  },
  ranked
};

writeFileSync("origin-self-evolution-priority-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-priority-v2.md",[
  "# ORIGIN Self-Evolution V2 Priority Queue",
  "",
  `Queue fingerprint: ${fingerprint}`,
  `High-priority actionable: ${actionable.length}`,
  "",
  ...ranked.map(x=>`- ${x.priority} ${x.category} ${x.source}: ${x.lane}`)
].join("\n")+"\n");
console.log(JSON.stringify({ok:true,fingerprint,summary:out.summary}));
