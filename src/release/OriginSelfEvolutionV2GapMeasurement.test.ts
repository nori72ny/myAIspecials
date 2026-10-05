import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 measured gap evidence",()=>{
  it("keeps the measurement validator syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-gap-measurement.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("defaults to NOT_MEASURED when no measurement is supplied",()=>{
    const s=read("scripts/origin-self-evolution-v2-gap-measurement.mjs");
    expect(s).toContain('empty("NOT_MEASURED","GAP_MEASUREMENT_INPUT_MISSING")');
    expect(s).toContain("acceptedMeasurements:[]");
  });

  it("requires exact base and mapped capability axis",()=>{
    const s=read("scripts/origin-self-evolution-v2-gap-measurement.mjs");
    expect(s).toContain('input.exactBaseSha!==queue.sourceObservationSha');
    expect(s).toContain("candidate?.capabilityAxes?.includes(axis)");
    expect(s).toContain("m?.exactBaseSha===queue.sourceObservationSha");
  });

  it("rejects held-out or non-reproducible gap claims",()=>{
    const s=read("scripts/origin-self-evolution-v2-gap-measurement.mjs");
    expect(s).toContain('m?.evidenceKind==="REPRODUCIBLE_NON_HELD_OUT"');
    expect(s).toContain("m?.privateHeldOut===false");
  });

  it("runs measurement validation before gap assessment",()=>{
    const w=read(".github/workflows/origin-self-evolution-v2.yml");
    const validate=w.indexOf("Validate reproducible measured-gap evidence");
    const assess=w.indexOf("Assess measured ORIGIN gaps and solution fit");
    expect(validate).toBeGreaterThan(0);
    expect(assess).toBeGreaterThan(validate);
  });
});
