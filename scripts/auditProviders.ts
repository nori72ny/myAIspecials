import {
  assertOriginZeroCostExecutionResult,
  type OriginProviderExecutionResult,
} from "../src/legacy/originProviderClient.js";
import {
  ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL,
  ORIGIN_GROQ_FREE_MODEL,
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginProviderDataPolicy,
} from "../src/lib/orchestration/OriginExecutionPolicy.js";

const providerDataPolicy: OriginProviderDataPolicy = {
  allowProviderFallbacks: true,
  dataCollection: "deny",
  requireZeroDataRetention: false,
};

function makeResult(overrides: Record<string, unknown> = {}): OriginProviderExecutionResult {
  return {
    text: "audit",
    actualCostUsd: 0,
    providerDataPolicy,
    routingEvidence: {
      requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      strategy: "fixed-free-model",
      provider: "OpenRouter",
      attempt: 1,
      fallbackUsed: false,
    },
    usage: { costUsd: 0 },
    ...overrides,
  } as OriginProviderExecutionResult;
}

const cases: Array<{
  name: string;
  result: OriginProviderExecutionResult;
  shouldPass: boolean;
}> = [
  {
    name: "CASE 1: 通常の $0 応答 (OpenRouter Free)",
    result: makeResult(),
    shouldPass: true,
  },
  {
    name: "CASE 2: 429時の $0 フォールバック (Groq / Gemini)",
    result: makeResult({
      routingEvidence: {
        requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
        servedModel: ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL,
        strategy: "zero-cost-failover",
        provider: "Google AI Studio",
        attempt: 1,
        fallbackUsed: true,
      },
    }),
    shouldPass: true,
  },
  {
    name: "CASE 3: 有料コスト ($0.001)",
    result: makeResult({ actualCostUsd: 0.001 }),
    shouldPass: false,
  },
  {
    name: "CASE 4: costInUSD = undefined",
    result: makeResult({ actualCostUsd: undefined }),
    shouldPass: false,
  },
  {
    name: "CASE 5: costInUSD = null",
    result: makeResult({ actualCostUsd: null }),
    shouldPass: false,
  },
  {
    name: "CASE 6: costInUSD = NaN",
    result: makeResult({ actualCostUsd: Number.NaN }),
    shouldPass: false,
  },
  {
    name: "CASE 7: costInUSD = Infinity",
    result: makeResult({ actualCostUsd: Number.POSITIVE_INFINITY }),
    shouldPass: false,
  },
  {
    name: "CASE 8: costInUSD = \"0\" (文字列)",
    result: makeResult({ actualCostUsd: "0" }),
    shouldPass: false,
  },
  {
    name: "CASE 9: costInUSD = 0 だが provider が unknown",
    result: makeResult({ routingEvidence: {
      requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      strategy: "fixed-free-model",
      provider: "unknown",
      attempt: 1,
      fallbackUsed: false,
    } }),
    shouldPass: false,
  },
  {
    name: "CASE 10: costInUSD = 0 だが model が有料モデル (gpt-4o)",
    result: makeResult({ routingEvidence: {
      requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      servedModel: "gpt-4o",
      strategy: "fixed-free-model",
      provider: "OpenRouter",
      attempt: 1,
      fallbackUsed: false,
    } }),
    shouldPass: false,
  },
  {
    name: "CASE 11: costInUSD = 0 だが Groq で未許可モデル",
    result: makeResult({ routingEvidence: {
      requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      servedModel: "llama-3.1-70b-versatile",
      strategy: "zero-cost-failover",
      provider: "Groq",
      attempt: 1,
      fallbackUsed: true,
    } }),
    shouldPass: false,
  },
  {
    name: "CASE 12: fallbackUsed = true だが fallback コスト未知/未許可",
    result: makeResult({
      actualCostUsd: undefined,
      usage: { costUsd: undefined },
      routingEvidence: {
        requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
        servedModel: "gpt-4o",
        strategy: "zero-cost-failover",
        provider: "unknown",
        attempt: 1,
        fallbackUsed: true,
      },
    }),
    shouldPass: false,
  },
];

let passed = 0;
let failed = 0;

console.log("🔍 [ORIGIN Audit] Zero-Cost Engine 12大エッジケース監査を開始します...\n");

for (const testCase of cases) {
  try {
    assertOriginZeroCostExecutionResult(testCase.result);
    if (testCase.shouldPass) {
      console.log(`✅ PASS: ${testCase.name}`);
      passed += 1;
    } else {
      console.error(`❌ FAIL: ${testCase.name} (違反値が通過しました)`);
      failed += 1;
    }
  } catch (error) {
    if (!testCase.shouldPass) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`✅ PASS (正常に拒否): ${testCase.name} -> ${message}`);
      passed += 1;
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ FAIL (正常値を拒否): ${testCase.name} -> ${message}`);
      failed += 1;
    }
  }
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`監査結果: ${passed}/${cases.length} PASS / ${failed} FAIL`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

if (passed !== cases.length || failed !== 0) process.exit(1);
