import { describe, expect, it } from "vitest";
import {
  requiresOriginCurrentInformation,
  requiresOriginGroundedResearch,
} from "./originChatResponsePolicy";

describe("current pricing concept routing", () => {
  it.each([
    ["現在のOpenAIの価格戦略を教えて", true],
    ["最新のSaaS料金モデルを比較してください", true],
    ["Explain OpenAI's current pricing strategy", true],
    ["Compare today's pricing models for AI services", true],
    ["価格戦略の基本を教えて", false],
    ["価格弾力性の意味を説明してください", false],
    ["Explain pricing strategy for a SaaS product", false],
    ["What does price elasticity mean?", false],
  ])("classifies current-vs-stable pricing concept: %s", (message, expected) => {
    expect(requiresOriginCurrentInformation(message)).toBe(expected);
    expect(requiresOriginGroundedResearch(message)).toBe(expected);
  });
});
