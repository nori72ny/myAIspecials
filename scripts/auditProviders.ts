import {
  assertOriginZeroCostExecutionResult,
  type OriginProviderExecutionResult,
} from "../src/legacy/originProviderClient.js";
import {
  DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
  ORIGIN_OPENROUTER_FREE_MODEL,
} from "../src/lib/orchestration/OriginExecutionPolicy.js";

function makeResult(overrides: Record<string, unknown> = {}): OriginProviderExecutionResult {
  return {
    text: "audit",
    transportRequestCount: 1,
    actualCostUsd: null,
    reportedUsageCostUsd: 0,
    policyMaxCostUsd: 0,
    costEvidenceStatus: "NOT_MEASURED",
    providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY,
    routingEvidence: {
      requestedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      servedModel: ORIGIN_OPENROUTER_FREE_MODEL,
      strategy: "adaptive-primary",
      provider: "OpenRouter",
      attempt: 1,
      fallbackUsed: false,
    },
    billingEvidence: { reportedUsageCostUsd: 0, isByok: false },
    usage: { reportedCostUsd: 0 },
    ...overrides,
  } as unknown as OriginProviderExecutionResult;
}

const cases: Array<{ name: string; result: OriginProviderExecutionResult; shouldPass: boolean }> = [
  { name: "strict OpenRouter free response with actual billing unmeasured", result: makeResult(), shouldPass: true },
  { name: "numeric actual cost falsely claims measured zero", result: makeResult({ actualCostUsd: 0 }), shouldPass: false },
  { name: "reported usage cost is nonzero", result: makeResult({ reportedUsageCostUsd: 0.000001 }), shouldPass: false },
  { name: "reported usage cost is a string", result: makeResult({ reportedUsageCostUsd: "0" }), shouldPass: false },
  { name: "BYOK is enabled", result: makeResult({ billingEvidence: { reportedUsageCostUsd: 0, isByok: true } }), shouldPass: false },
  { name: "fallback was used", result: makeResult({ routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: true } }), shouldPass: false },
  { name: "non-OpenRouter provider", result: makeResult({ routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, strategy: "adaptive-primary", provider: "Google AI Studio", attempt: 1, fallbackUsed: false } }), shouldPass: false },
];

let passed = 0;
let failed = 0;
for (const testCase of cases) {
  try {
    assertOriginZeroCostExecutionResult(testCase.result);
    if (testCase.shouldPass) {
      console.log(`PASS: ${testCase.name}`);
      passed += 1;
    } else {
      console.error(`FAIL: ${testCase.name} (violation was accepted)`);
      failed += 1;
    }
  } catch (error) {
    if (!testCase.shouldPass) {
      console.log(`PASS (rejected): ${testCase.name}`);
      passed += 1;
    } else {
      console.error(`FAIL: ${testCase.name} (valid result was rejected): ${error instanceof Error ? error.message : String(error)}`);
      failed += 1;
    }
  }
}
console.log(`Provider boundary audit: ${passed}/${cases.length} passed; ${failed} failed`);
if (failed !== 0 || passed !== cases.length) process.exit(1);
