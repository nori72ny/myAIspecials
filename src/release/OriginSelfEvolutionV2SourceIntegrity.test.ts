import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 source integrity",()=>{
  it("keeps source-integrity scanner syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-source-integrity.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("rejects redirects and oversized source bodies before planning",()=>{
    const observer=read("scripts/origin-self-evolution-v2.mjs");
    expect(observer).toContain('redirect: "error"');
    expect(observer).toContain("SOURCE_BODY_TOO_LARGE");
    expect(observer).toContain("maxSourceBytes");
    const config=JSON.parse(read("config/origin-self-evolution-sources.json"));
    expect(config.rules.maxSourceBytes).toBe(262144);
  });

  it("pins every configured outbound endpoint and strips raw HTML elements without regex filtering",()=>{
    const helperUrl=pathToFileURL(resolve(process.cwd(),"scripts/origin-self-evolution-v2-source-safety.mjs")).href;
    const config=JSON.parse(read("config/origin-self-evolution-sources.json"));
    const payload=JSON.stringify(config.categories.flatMap((category:{sources:Array<{name:string;url:string}>})=>category.sources));
    const probe=[
      `import { resolveCanonicalSource, sanitizeExternalEvidence } from ${JSON.stringify(helperUrl)};`,
      `const sources=JSON.parse(${JSON.stringify(payload)});`,
      `const canonical=sources.every(source=>resolveCanonicalSource(source)?.url===source.url);`,
      `const tampered=resolveCanonicalSource({name:"OpenAI",url:"http://127.0.0.1/internal"});`,
      `const cleaned=sanitizeExternalEvidence("<script>secret instructions</script\\t\\n bogus><style>hidden</style><p>Safe evidence</p>",1800);`,
      `console.log(JSON.stringify({canonical,tampered,cleaned}));`
    ].join("\\n");
    const result=JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",probe],{encoding:"utf8"}));
    expect(result.canonical).toBe(true);
    expect(result.tampered).toBe(null);
    expect(result.cleaned).toBe("Safe evidence");
    const observer=read("scripts/origin-self-evolution-v2.mjs");
    expect(observer).toContain("resolveCanonicalSource(source)");
    expect(observer).toContain("fetch(canonical.url");
    expect(observer).not.toContain("fetch(source.url");
    expect(observer).not.toContain("<script\\\\b");
  });

  it("stops source-body streaming once the byte budget is exceeded",()=>{
    const helperUrl=pathToFileURL(resolve(process.cwd(),"scripts/origin-self-evolution-v2-source-safety.mjs")).href;
    const probe=[
      `import { readBoundedResponseText } from ${JSON.stringify(helperUrl)};`,
      `const ok=await readBoundedResponseText(new Response("small"),16);`,
      `let rejected=false; try { await readBoundedResponseText(new Response("0123456789abcdef"),8); } catch (error) { rejected=String(error?.message||error)==="SOURCE_BODY_TOO_LARGE"; }`,
      `console.log(JSON.stringify({ok,rejected}));`
    ].join("\\n");
    const result=JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",probe],{encoding:"utf8"}));
    expect(result.ok).toBe("small");
    expect(result.rejected).toBe(true);
    const observer=read("scripts/origin-self-evolution-v2.mjs");
    expect(observer).toContain("readBoundedResponseText(response, maxSourceBytes)");
    expect(observer).not.toContain("response.text()");
  });

  it("requires public HTTPS and blocks prompt-like external evidence",()=>{
    const s=read("scripts/origin-self-evolution-v2-source-integrity.mjs");
    expect(s).toContain("validPublicHttps");
    expect(s).toContain("blockedEvidenceFingerprints");
    expect(s).toContain("system\\s+prompt");
    expect(s).toContain("safeForExperiments");
    expect(s).toContain("tainted");
  });

  it("maps observations onto explicit ORIGIN capability axes and gates",()=>{
    const config=JSON.parse(read("config/origin-self-evolution-capabilities.json"));
    expect(config.categories["ai-models"].axes).toContain("answer-quality");
    expect(config.categories["agents-coding"].axes).toContain("general-agent");
    expect(config.categories["image-multimodal"].axes).toContain("image-generation");
    expect(config.categories.security.requiredGates).toContain("codeql");
    expect(config.categories["design-ux-a11y"].requiredGates).toContain("lighthouse");
  });

  it("runs source integrity before candidate planning",()=>{
    const workflow=read(".github/workflows/origin-self-evolution-v2.yml");
    const integrity=workflow.indexOf("Validate source integrity and untrusted-content boundary");
    const planning=workflow.indexOf("Build baseline-comparison candidate queue");
    expect(integrity).toBeGreaterThan(0);
    expect(planning).toBeGreaterThan(integrity);
  });

  it("keeps source evidence as data, never authority",()=>{
    const plan=read("scripts/origin-self-evolution-v2-plan.mjs");
    expect(plan).toContain("sourceIntegritySafe");
    expect(plan).toContain("blockedEvidenceCount");
    expect(plan).toContain("codeWriteAllowed:false");
    expect(plan).toContain("mergeAllowed:false");
    expect(plan).toContain("productionDeployAllowed:false");
  });
});
