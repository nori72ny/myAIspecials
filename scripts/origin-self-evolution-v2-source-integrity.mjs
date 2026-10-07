import { readFileSync, writeFileSync } from "node:fs";

const report=JSON.parse(readFileSync("origin-self-evolution-v2.json","utf8"));
const config=JSON.parse(readFileSync("config/origin-self-evolution-sources.json","utf8"));

const INJECTION_PATTERNS=[
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /reveal\s+(your\s+)?(?:prompt|secret|credential)/i,
  /execute\s+(?:this|the)\s+(?:command|code)/i,
  /do\s+not\s+follow\s+(?:the\s+)?(?:system|developer)/i
];

function privateIp(host){
  if(/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)) return true;
  const m=host.match(/^172\.(\d+)\./);
  if(m && Number(m[1])>=16 && Number(m[1])<=31) return true;
  return host==="0.0.0.0" || host==="::1";
}

function validPublicHttps(value){
  try{
    const u=new URL(value);
    const host=u.hostname.toLowerCase();
    return u.protocol==="https:" && host!=="localhost" && !host.endsWith(".local") && !privateIp(host) && !u.username && !u.password;
  }catch{
    return false;
  }
}

const configured=(config.categories||[]).flatMap(category=>
  (category.sources||[]).map(source=>({category:category.id,cadence:category.cadence,...source}))
);
const configuredInvalid=configured.filter(source=>!validPublicHttps(source.url));

const observations=(report.observations||[]).map(item=>{
  const indicators=INJECTION_PATTERNS.filter(pattern=>pattern.test(String(item.excerpt||""))).map(pattern=>String(pattern));
  return {
    category:item.category,
    source:item.name,
    tier:item.tier,
    url:item.url,
    ok:item.ok===true,
    fingerprint:item.fingerprint,
    publicHttps:validPublicHttps(item.url),
    injectionIndicators:indicators,
    tainted:indicators.length>0
  };
});

const available=observations.filter(x=>x.ok&&x.publicHttps);
const primaryAvailable=available.filter(x=>x.tier==="A"&&!x.tainted);
const tainted=observations.filter(x=>x.tainted);
const blockedEvidenceFingerprints=tainted.map(x=>x.fingerprint).filter(Boolean);
const ratio=observations.length===0?0:available.length/observations.length;
const minRatio=0.5;
const safeForPlanning=observations.length>0 && configuredInvalid.length===0 && ratio>=minRatio;
const safeForExperiments=safeForPlanning && primaryAvailable.length>0;

const out={
  schemaVersion:"origin.self-evolution.source-integrity.v2",
  generatedAt:new Date().toISOString(),
  scanMode:report.scanMode,
  exactSha:report.sha,
  summary:{
    attempted:observations.length,
    available:available.length,
    primaryAvailable:primaryAvailable.length,
    tainted:tainted.length,
    invalidConfiguredUrls:configuredInvalid.length,
    availabilityRatio:ratio
  },
  safeForPlanning,
  safeForExperiments,
  blockedEvidenceFingerprints,
  configuredInvalid:configuredInvalid.map(x=>({category:x.category,name:x.name,url:x.url})),
  observations
};

writeFileSync("origin-self-evolution-source-integrity-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-source-integrity-v2.md",[
  "# ORIGIN Self-Evolution V2 Source Integrity",
  "",
  `Scan mode: ${out.scanMode}`,
  `Safe for planning: ${safeForPlanning}`,
  `Safe for experiments: ${safeForExperiments}`,
  `Available: ${available.length}/${observations.length}`,
  `Primary available: ${primaryAvailable.length}`,
  `Tainted evidence items blocked: ${tainted.length}`,
  "",
  "External text remains untrusted data. Prompt-like instructions are never authority and tainted fingerprints are excluded from candidate planning."
].join("\n")+"\n");

console.log(JSON.stringify({ok:safeForPlanning,safeForExperiments,summary:out.summary}));
