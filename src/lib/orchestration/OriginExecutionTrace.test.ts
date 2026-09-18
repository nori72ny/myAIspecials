import { describe, expect, it, vi } from "vitest";

import { validateOriginExecutionTrace, type OriginExecutionTraceRecord } from "./OriginExecutionTrace";
import { PostgresOriginExecutionTraceStore } from "./PostgresOriginExecutionTraceStore";

const base:OriginExecutionTraceRecord={
  schemaVersion:"origin-execution-trace-v1",
  traceId:"origin-20260918-test",
  startedAt:"2026-09-18T08:00:00.000Z",
  completedAt:"2026-09-18T08:00:01.000Z",
  outcome:"accepted",
  transmission:"attempted",
  policy:{
    freeOnly:true,
    maxEstimatedCostUsd:0,
    timeoutMs:52_000,
    modelEvidenceStatus:"current",
  },
  execution:{
    providerId:"openrouter-free",
    modelId:"example/free-model:free",
    fallbackUsed:false,
    estimatedCostUsd:0,
    actualCostUsd:0,
    inputTokens:10,
    outputTokens:20,
  },
  verification:{ status:"not-run", reviewerCount:0 },
  context:{
    policyVersion:"origin-context-v1",
    includedMessageCount:2,
    includedCharacterCount:120,
    omittedMessageCount:0,
    omittedCharacterCount:0,
  },
};

describe("OriginExecutionTrace",()=>{
  it("accepts a privacy-bounded zero-cost trace",()=>{
    const result=validateOriginExecutionTrace(base);
    expect(result.ok).toBe(true);
    if(!result.ok)return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value).not.toHaveProperty("prompt");
    expect(result.value).not.toHaveProperty("answer");
  });

  it("rejects unknown fields, secrets, paid/fallback traces and fake passed review",()=>{
    expect(validateOriginExecutionTrace({ ...base, prompt:"secret prompt" }).ok).toBe(false);
    expect(validateOriginExecutionTrace({ ...base, traceId:"origin-Authorization: Bearer synthetic_token_123456" }).ok).toBe(false);
    expect(validateOriginExecutionTrace({ ...base, execution:{...base.execution!, actualCostUsd:0.01} }).ok).toBe(false);
    expect(validateOriginExecutionTrace({ ...base, execution:{...base.execution!, fallbackUsed:true} }).ok).toBe(false);
    expect(validateOriginExecutionTrace({ ...base, verification:{status:"passed",reviewerCount:0} }).ok).toBe(false);
  });

  it("requires execution metadata only when transmission was attempted",()=>{
    expect(validateOriginExecutionTrace({
      ...base,
      outcome:"sensitive-input-blocked",
      transmission:"not-attempted",
      execution:undefined,
      policy:{...base.policy,modelEvidenceStatus:"not-applicable"},
    }).ok).toBe(true);
    expect(validateOriginExecutionTrace({
      ...base,
      transmission:"attempted",
      execution:undefined,
    }).ok).toBe(false);
  });
});

describe("PostgresOriginExecutionTraceStore",()=>{
  it("inserts validated traces with parameterized SQL and append-only conflict behavior",async()=>{
    const query=vi.fn().mockResolvedValue({rowCount:1,rows:[{trace_id:base.traceId}]});
    const store=new PostgresOriginExecutionTraceStore({query} as never);
    await expect(store.append(base)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql,values]=query.mock.calls[0];
    expect(String(sql)).toContain("on conflict (trace_id) do nothing");
    expect(JSON.stringify(values)).not.toContain("prompt");
    expect(JSON.stringify(values)).not.toContain("answer");
  });

  it("does not write an invalid trace",async()=>{
    const query=vi.fn();
    const store=new PostgresOriginExecutionTraceStore({query} as never);
    await expect(store.append({...base,execution:{...base.execution!,actualCostUsd:1}})).rejects.toThrow("INVALID_EXECUTION_TRACE");
    expect(query).not.toHaveBeenCalled();
  });

  it("uses bounded retention deletion",async()=>{
    const query=vi.fn().mockResolvedValue({rowCount:2,rows:[{},{}]});
    const store=new PostgresOriginExecutionTraceStore({query} as never);
    await expect(store.deleteExpired(100)).resolves.toBe(2);
    await expect(store.deleteExpired(0)).rejects.toThrow("TRACE_CLEANUP_LIMIT_INVALID");
  });
});
