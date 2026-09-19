import { describe, expect, it } from "vitest";
import { classifyOwnerImprovementCategory, detectExplicitOwnerImprovementIntent } from "./OwnerImprovementIntent";

describe("OwnerImprovementIntent", () => {
  it("captures explicit ORIGIN improvement requests", () => {
    expect(detectExplicitOwnerImprovementIntent("ORIGINの回答画面をもっと見やすく改善して")).toEqual({
      matched: true,
      category: "design",
    });
    expect(detectExplicitOwnerImprovementIntent("このアプリのセキュリティを強化して")).toEqual({
      matched: true,
      category: "security",
    });
  });

  it("does not silently convert ordinary advice into owner backlog work", () => {
    expect(detectExplicitOwnerImprovementIntent("ReactのuseMemoを説明して").matched).toBe(false);
    expect(detectExplicitOwnerImprovementIntent("Claude Codeの特徴を教えて").matched).toBe(false);
    expect(detectExplicitOwnerImprovementIntent("今日の予定を整理して").matched).toBe(false);
  });

  it("requires an ORIGIN/app/UI target as well as an improvement verb", () => {
    expect(detectExplicitOwnerImprovementIntent("もっと見やすくして").matched).toBe(false);
    expect(detectExplicitOwnerImprovementIntent("ORIGINについて教えて").matched).toBe(false);
  });

  it("classifies security, AI, reliability, performance, and external-service evidence", () => {
    expect(classifyOwnerImprovementCategory("Prompt Injectionと個人情報漏洩を防ぎたい")).toBe("security");
    expect(classifyOwnerImprovementCategory("Geminiのモデル機能を検討")).toBe("ai");
    expect(classifyOwnerImprovementCategory("保存後に復元できない不具合")).toBe("reliability");
    expect(classifyOwnerImprovementCategory("表示速度を高速化")).toBe("performance");
    expect(classifyOwnerImprovementCategory("Supabase連携を検討")).toBe("external");
  });
});
