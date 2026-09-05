import { describe, expect, it } from "vitest";
import {
  capabilityExecutionOrder,
  selectOriginCapability,
} from "./OriginCapabilityRouter.js";

describe("Origin v2 capability routing", () => {
  it("selects research for source/verification requests", () => {
    expect(selectOriginCapability("最新情報を出典付きで検証して").capability).toBe("research");
  });

  it("selects coding for implementation requests", () => {
    expect(selectOriginCapability("TypeScriptのバグを修正してテストを追加").capability).toBe("coding");
  });

  it("uses the strongest capability signal instead of first-match ordering", () => {
    expect(selectOriginCapability("最新のコードを調査して、TypeScriptのバグを修正").capability).toBe("coding");
  });

  it("reports medium confidence when multiple capabilities tie", () => {
    expect(selectOriginCapability("コードを分析してレビューして")).toMatchObject({
      capability: "coding",
      reason: "keyword",
      confidence: "medium",
    });
  });

  it("honors explicit capability over keyword inference", () => {
    expect(selectOriginCapability("最新のコードを調査して", "analysis")).toMatchObject({
      capability: "analysis",
      reason: "explicit",
      confidence: "high",
    });
  });

  it("treats empty input as the safe answer default", () => {
    expect(selectOriginCapability(" ")).toMatchObject({ capability: "answer", reason: "default", confidence: "low" });
  });

  it("is deterministic and keeps every capability in the bounded order", () => {
    const decision = selectOriginCapability("普通の質問");
    expect(capabilityExecutionOrder(decision)).toEqual([
      "answer",
      "research",
      "coding",
      "writing",
      "analysis",
    ]);
  });
});
