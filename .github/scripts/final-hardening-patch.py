from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


ci = Path(".github/workflows/ci.yml")
s = ci.read_text()
s = replace_once(s, "npx --yes npm@latest audit --no-package-lock --audit-level=critical", "npx --yes npm@latest audit --no-package-lock --audit-level=moderate", "audit threshold")
ci.write_text(s)

client = Path("src/legacy/originProviderClient.ts")
s = client.read_text()
s = replace_once(s, "  ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL,\n", "", "remove Gemini import")
sanitizer = 'import { sanitizePreEgress, sanitizePreEgressPayload } from "../services/securitySanitizer.js";\n'
s = replace_once(s, sanitizer, sanitizer + 'import { requiresOpenRouterFreeTierAttestation, verifyOpenRouterFreeTierAccount } from "./openRouterFreeTierGate.js";\n', "free tier gate import")
s = replace_once(s, 'export const ALLOWED_ZERO_COST_PROVIDERS = ["openrouter", "gemini"] as const;', 'export const ALLOWED_ZERO_COST_PROVIDERS = ["openrouter"] as const;', "provider allowlist")
s = replace_once(s, 'export const ALLOWED_ZERO_COST_MODELS = { openrouter: [ORIGIN_OPENROUTER_FREE_MODEL], gemini: [ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL] } as const;', 'export const ALLOWED_ZERO_COST_MODELS = { openrouter: [ORIGIN_OPENROUTER_FREE_MODEL] } as const;', "model allowlist")
s = replace_once(s, 'const IDS: Record<string, AllowedZeroCostProvider> = { OpenRouter: "openrouter", "openrouter-free": "openrouter", Gemini: "gemini", "google-ai-studio-free": "gemini" };', 'const IDS: Record<string, AllowedZeroCostProvider> = { OpenRouter: "openrouter", "openrouter-free": "openrouter" };', "provider ids")
s = replace_once(s, '  const validStrategy = evidence.strategy === "adaptive-primary" || (provider === "gemini" && evidence.strategy === "bounded-secondary");\n  const validFallback = !evidence.fallbackUsed || (provider === "gemini" && evidence.fallbackUsed && evidence.strategy === "bounded-secondary");', '  const validStrategy = evidence.strategy === "adaptive-primary";\n  const validFallback = evidence.fallbackUsed === false;', "routing validation")
old_evidence = 'function evidence(request: OriginProviderExecutionRequest, provider: AllowedZeroCostProvider, servedModel: string, fallbackUsed = false): OriginProviderRoutingEvidence { return { requestedModel: provider === "gemini" ? ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL : request.plan.modelId, servedModel, strategy: fallbackUsed ? "bounded-secondary" : "adaptive-primary", provider: provider === "gemini" ? "Gemini" : "OpenRouter", attempt: 1, fallbackUsed }; }'
new_evidence = 'function evidence(request: OriginProviderExecutionRequest, servedModel: string): OriginProviderRoutingEvidence { return { requestedModel: request.plan.modelId, servedModel, strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false }; }'
s = replace_once(s, old_evidence, new_evidence, "routing evidence")
s = replace_once(s, 'routingEvidence: evidence(request, provider, String(servedModel))', 'routingEvidence: evidence(request, String(servedModel))', "openrouter evidence call")
s, count = re.subn(r"\nfunction geminiEligible[\s\S]*?(?=\nexport async function executeOriginProvider)", "", s, count=1)
if count != 1:
    raise SystemExit(f"remove Gemini implementation: expected 1 match, got {count}")
replacement = '''export async function executeOriginProvider(providerRequest: OriginProviderExecutionRequest, env: NodeJS.ProcessEnv = process.env, fetchImpl: OriginFetch = fetch): Promise<OriginProviderExecutionResult> {
  validate(providerRequest.plan);
  const primary = pid(providerRequest.plan.providerId);
  if (primary !== "openrouter") throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "許可されていないProviderです。", 400, false);
  const openRouterKey = env.OPENROUTER_API_KEY;
  if (!openRouterKey) throw new OriginProviderError("PROVIDER_NOT_CONFIGURED", "利用可能な無料AIが設定されていません。", 503, false);
  if (requiresOpenRouterFreeTierAttestation(env) && !(await verifyOpenRouterFreeTierAccount(openRouterKey, fetchImpl))) {
    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "OpenRouter free-tier account verification failed.", 502, false);
  }
  return openrouter(providerRequest, openRouterKey, fetchImpl, "openrouter");
}
'''
s, count = re.subn(r"export async function executeOriginProvider[\s\S]*\Z", replacement, s, count=1)
if count != 1:
    raise SystemExit(f"replace executeOriginProvider: expected 1 match, got {count}")
if "GEMINI_API_KEY" in s or "ORIGIN_GEMINI_FREE_ONLY" in s or "ORIGIN_GOOGLE_AI_STUDIO_FREE_MODEL" in s:
    raise SystemExit("Gemini execution references remain in originProviderClient.ts")
client.write_text(s)

stream = Path("src/legacy/originProviderStreamClient.ts")
s = stream.read_text()
marker = '} from "./originProviderClient.js";\n'
s = replace_once(s, marker, marker + 'import { requiresOpenRouterFreeTierAttestation, verifyOpenRouterFreeTierAccount } from "./openRouterFreeTierGate.js";\n', "stream gate import")
old = '  const key = env.OPENROUTER_API_KEY;\n  if (!key) throw new OriginProviderError("PROVIDER_NOT_CONFIGURED", "利用可能な無料AIが設定されていません。", 503, false);\n  return streamOpenRouter(providerRequest, key, handlers, fetchImpl);'
new = '  const key = env.OPENROUTER_API_KEY;\n  if (!key) throw new OriginProviderError("PROVIDER_NOT_CONFIGURED", "利用可能な無料AIが設定されていません。", 503, false);\n  if (requiresOpenRouterFreeTierAttestation(env) && !(await verifyOpenRouterFreeTierAccount(key, fetchImpl))) {\n    throw new OriginProviderError("PROVIDER_POLICY_VIOLATION", "OpenRouter free-tier account verification failed.", 502, false);\n  }\n  return streamOpenRouter(providerRequest, key, handlers, fetchImpl);'
s = replace_once(s, old, new, "stream free-tier gate")
stream.write_text(s)

test = Path("src/legacy/originProviderClient.gemini.test.ts")
test.write_text('''import { describe, expect, it } from "vitest";
import { ORIGIN_OPENROUTER_FREE_MODEL } from "../lib/orchestration/OriginExecutionPolicy.js";
import { executeOriginProvider, type OriginFetch, type OriginProviderExecutionRequest } from "./originProviderClient.js";

const request: OriginProviderExecutionRequest = {
  plan: {
    providerId: "openrouter-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_OPENROUTER_FREE_MODEL,
    taskType: "research",
    freeOnly: true,
    estimatedCostUsd: 0,
    timeoutMs: 20_000,
    requiresOwnerApproval: false,
    reason: "test",
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: false },
    modelEvidence: { providerId: "openrouter-free", verifiedAt: "2026-09-08T00:00:00.000Z", reviewAfter: "2026-09-18T00:00:00.000Z", sourceUrl: "https://openrouter.ai/inclusionai/ling-3.0-flash-sante:free" },
  },
  messages: [{ role: "user", content: "日本語で短く答えてください。" }],
  systemInstruction: "You are ORIGIN Personal AI.",
};

describe("no secondary inference provider", () => {
  it.each([429, 500, 502, 503, 504])("never falls back to Gemini after OpenRouter HTTP %s", async (status) => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: OriginFetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status });
    };
    await expect(executeOriginProvider(request, {
      OPENROUTER_API_KEY: "test-openrouter",
      GEMINI_API_KEY: "must-never-be-used",
      ORIGIN_GEMINI_FREE_ONLY: "true",
    }, fetchMock)).rejects.toMatchObject({ retryable: true });
    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toContain("openrouter.ai");
    expect(String(calls[0].input)).not.toContain("googleapis.com");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("x-goog-api-key")).toBeNull();
  });
});
''')
