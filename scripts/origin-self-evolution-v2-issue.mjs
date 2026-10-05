import { readFileSync } from "node:fs";

const token=process.env.GITHUB_TOKEN;
const repo=process.env.GITHUB_REPOSITORY || "nori72ny/myAIspecials";
if(!token) throw new Error("GITHUB_TOKEN_REQUIRED");

const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const marker=`<!-- origin-self-evolution-v2:${priority.queueFingerprint} -->`;
const selected=priority.ranked.filter(x=>x.actionable && ["P0","P1"].includes(x.priority));

if(selected.length===0){
  console.log(JSON.stringify({ok:true,created:false,reason:"NO_HIGH_PRIORITY_ACTIONABLE"}));
  process.exit(0);
}

const headers={
  Accept:"application/vnd.github+json",
  Authorization:`Bearer ${token}`,
  "X-GitHub-Api-Version":"2022-11-28",
  "User-Agent":"ORIGIN-Self-Evolution-V2/1.0"
};

async function gh(path,init={}){
  const r=await fetch(`https://api.github.com/repos/${repo}${path}`,{...init,headers:{...headers,...(init.headers||{})}});
  const body=await r.json().catch(()=>null);
  if(!r.ok) throw new Error(`GITHUB_HTTP_${r.status}`);
  return body;
}

async function listOpenIssues(){
  const all=[];
  for(let page=1; page<=10; page++){
    const batch=await gh(`/issues?state=open&per_page=100&page=${page}`);
    all.push(...batch);
    if(batch.length<100) break;
  }
  return all;
}

const open=await listOpenIssues();
const duplicate=open.some(issue=>!issue.pull_request && String(issue.body||"").includes(marker));
if(duplicate){
  console.log(JSON.stringify({ok:true,created:false,reason:"DUPLICATE_FINGERPRINT"}));
  process.exit(0);
}

const lines=[
  marker,
  "# ORIGIN Self-Evolution V2 — Improvement Queue",
  "",
  `Exact baseline SHA: ${priority.exactBaseSha}`,
  `Baseline fingerprint: ${priority.baselineFingerprint}`,
  `Queue fingerprint: ${priority.queueFingerprint}`,
  "",
  "This is an evidence queue, not an authorization to merge/deploy.",
  "",
  ...selected.map(x=>[
    `## ${x.priority} — ${x.category} / ${x.source}`,
    `- candidate: ${x.id}`,
    `- evidence tier: ${x.tier}`,
    `- score: ${x.priorityScore}`,
    `- lane: ${x.lane}`,
    `- next: ${x.nextAction}`
  ].join("\n"))
];

const issue=await gh("/issues",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({
    title:`Self-Evolution V2: ${selected.length} high-priority improvement candidate(s)`,
    body:lines.join("\n"),
    labels:[]
  })
});

console.log(JSON.stringify({ok:true,created:true,issueNumber:issue.number,htmlUrl:issue.html_url}));
