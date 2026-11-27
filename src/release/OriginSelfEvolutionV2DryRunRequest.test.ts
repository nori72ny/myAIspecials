import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 dry-run request gate",()=>{
  it("keeps request packager syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-dry-run-request.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("uses only internal allowlisted adapters",()=>{
    const registry=JSON.parse(read("config/origin-self-evolution-adapters.json"));
    expect(registry.adapters.length).toBeGreaterThan(0);
    for(const adapter of registry.adapters){
      expect(adapter.networkWrite).toBe(false);
      expect(adapter.repoWrite).toBe(false);
      expect(adapter.productionAccess).toBe(false);
      expect(adapter.secrets).toBe(false);
      expect(adapter.paidProvider).toBe(false);
      expect(adapter.maxCostUsd).toBe(0);
      expect(adapter.commandClass).toMatch(/^INTERNAL_/);
    }
  });

  it("never accepts executable commands from external evidence",()=>{
    const s=read("scripts/origin-self-evolution-v2-dry-run-request.mjs");
    expect(s).toContain("externalCommand:null");
    expect(s).toContain("allowlistedAdapterOnly:true");
    expect(s).toContain("NO_UNIQUE_ALLOWLISTED_ADAPTER");
    expect(s).not.toContain("exec(");
    expect(s).not.toContain("spawn(");
    expect(s).not.toContain("shell:true");
  });

  it("requires explicit authorization and executable experiment spec",()=>{
    const s=read("scripts/origin-self-evolution-v2-dry-run-request.mjs");
    expect(s).toContain("decision.authorized===true");
    expect(s).toContain("experiment?.executable===true");
    expect(s).toContain('status:ready?"READY_FOR_INTERNAL_DRY_RUN":"NOT_RUN"');
  });
});
