import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const readRepositoryFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ORIGIN Personal release 1 gate", () => {
  it("routes a serverless deployment through the authoritative ORIGIN app", () => {
    const apiEntrypoint = readRepositoryFile("api/index.ts");
    const vercelConfig = JSON.parse(readRepositoryFile("vercel.json")) as { rewrites?: Array<{ source?: string; destination?: string }> };
    expect(apiEntrypoint).toContain('import("../src/server/createOriginApp.js")');
    expect(apiEntrypoint).toContain("createVercelHandler");
    expect(apiEntrypoint).toContain("request: IncomingMessage");
    expect(apiEntrypoint).toContain("response: ServerResponse");
    expect(apiEntrypoint).toContain('console.error("ORIGIN_FUNCTION_INIT_FAILED", diagnostic)');
    expect(apiEntrypoint).not.toContain("console.error(error)");
    expect(vercelConfig.rewrites).toContainEqual({ source: "/api/(.*)", destination: "/api/index.ts" });
  });

  it("keeps main merges separate from Production deployment approval", () => {
    const vercelConfig = JSON.parse(readRepositoryFile("vercel.json")) as {
      git?: { deploymentEnabled?: Record<string, boolean> };
    };
    const gate = readRepositoryFile("docs/ORIGIN_PERSONAL_RELEASE_1_GATE.md");
    expect(vercelConfig.git?.deploymentEnabled?.main).toBe(false);
    expect(gate).toContain("mainのGit pushによる自動Production deploymentを無効化");
    expect(gate).toContain("PR branchのPreview deploymentは維持");
  });

  it("fails closed at the Production smoke boundary unless main is protected", () => {
    const workflow = readRepositoryFile(".github/workflows/publication-smoke.yml");
    const verifier = readRepositoryFile("scripts/verify-release-governance.mjs");
    const gate = readRepositoryFile("docs/ORIGIN_PERSONAL_RELEASE_1_GATE.md");
    expect(workflow).toContain("Verify release governance before Production smoke");
    expect(workflow).toContain("node scripts/verify-release-governance.mjs");
    expect(verifier).toContain("RELEASE_GOVERNANCE_MAIN_UNPROTECTED");
    expect(verifier).toContain("branch?.protected");
    expect(gate).toContain("protected: true");
    expect(gate).toContain("未保護のmainではReady変更・merge・Production smokeを進めない");
  });

  it("keeps the Cloudflare Worker provider route ineligible for release 1", () => {
    const worker = readRepositoryFile("worker/index.mjs");
    expect(worker).toContain("providerExecutionEnabled: false");
    expect(worker).toContain('url.pathname === "/api/v1/ai/free-chat"');
    expect(worker).toContain("return json(DISABLED_AI_RESPONSE, 503, headers)");
  });

  it("locks execution to one approved free provider/model without cross-provider fallback", () => {
    const providerClient = readRepositoryFile("src/legacy/originProviderClient.ts");
    const providerPolicy = readRepositoryFile("src/legacy/zeroCostRoutingPolicy.ts");
    const modelCatalog = readRepositoryFile("src/lib/orchestration/OriginFreeModelCatalog.ts");
    expect(providerClient).toContain('export const ALLOWED_ZERO_COST_PROVIDERS = ["openrouter"] as const;');
    expect(providerClient).toContain("openrouter: [ORIGIN_OPENROUTER_FREE_MODEL]");
    expect(providerPolicy).toContain("allow_fallbacks: false");
    expect(providerPolicy).toContain('data_collection: "deny"');
    expect(providerPolicy).toContain("zdr: true");
    expect(providerPolicy).toContain("prompt: 0");
    expect(providerPolicy).toContain("completion: 0");
    expect(providerPolicy).toContain("request: 0");
    expect(providerClient).toContain("zero(data.usage?.cost");
    expect(providerClient).toMatch(
      /routingEvidence:\s*evidence\([A-Za-z_$][\w$]*,\s*String\(servedModel\)\)/,
    );
    expect(providerClient).toContain('evidence.fallbackUsed === false');
    expect(providerClient).not.toContain('"openrouter/free"');
    expect(providerClient).not.toContain("?key=");
    expect(providerClient).not.toContain("generativelanguage.googleapis.com");
    expect(providerClient).not.toContain("GEMINI_API_KEY");
    expect(modelCatalog).toContain('"inclusionai/ling-3.0-flash-sante:free"');
    expect(modelCatalog).not.toContain('"openrouter/free"');
  });

  it("keeps production chat single-attempt and excludes legacy retry runtimes", () => {
    const chat = readRepositoryFile("src/legacy/originChatRouter.ts");
    const streaming = readRepositoryFile("src/legacy/originStreamingChatRouter.ts");
    const server = readRepositoryFile("src/server/createOriginApp.ts");
    const entrypoint = readRepositoryFile("src/main.tsx");

    for (const source of [chat, streaming]) {
      expect(source).not.toContain("executeWithRetry");
      expect(source).not.toContain("MAX_RETRIES");
    }
    expect(chat).toContain("providerAttempts: 1");
    expect(streaming).toContain("const result = await streamExecute(providerRequest");
    expect(streaming).toContain("retryAttempted: false");
    expect(server).not.toContain("OpenRouterPlugin");
    expect(server).not.toContain("initMissionEngine");
    expect(entrypoint).not.toContain("useAppState");
  });

  it("locks provider egress to one request and keeps upstream diagnostics metadata-only", () => {
    const providerClient = readRepositoryFile("src/legacy/originProviderClient.ts");
    const providerSecurityRegression = readRepositoryFile("src/legacy/originProviderClient.security-regression.test.ts");

    expect(providerClient).toContain("const RETRY: readonly number[] = []");
    expect(providerClient).toContain("const MAX_SEGMENTS = 1");
    expect(providerClient).toContain("attempt: 1");
    expect(providerClient).toContain("fallbackUsed: false");
    expect(providerClient).not.toContain("response.text(");
    expect(providerClient).toContain("upstreamStatus?: number");
    expect(providerClient).toContain("upstreamErrorType?: string");
    expect(providerClient).toContain('transportFailure?: "timeout" | "network"');
    expect(providerSecurityRegression).toContain("preserves Retry-After without exposing upstream content or credentials");
    expect(providerSecurityRegression).toContain("Authorization: Bearer upstream-secret-value");
    expect(providerSecurityRegression).toContain("expect(String(error)).not.toContain(body)");
    expect(providerSecurityRegression).toContain('expect(String(error)).not.toContain("synthetic-key")');
  });

  it("keeps untrusted-source data away from external sinks unless an explicit approved boundary exists", () => {
    const tools = readRepositoryFile("src/agent/toolRegistry.ts");
    const server = readRepositoryFile("src/server/createOriginApp.ts");

    expect(tools).toContain("web_search_grounding");
    expect(tools).toContain("Network capability intentionally disabled in the zero-cost local execution kernel.");
    expect(tools).toContain("Network capability is disabled; no request was made.");
    expect(tools).toContain("requiresApproval: true");
    expect(tools).toContain("if (!approval.approved) throw new Error('HUMAN_APPROVAL_REQUIRED')");
    expect(tools).toContain("if (!securityPolicyPassed) throw new Error('SAFETY_POLICY_BLOCKED')");
    expect(tools).toContain("if (approval.costInUSD !== undefined && approval.costInUSD !== 0) throw new Error('ZERO_COST_BOUNDARY_BLOCKED')");
    expect(tools).toContain("containsLikelySecret(edit.previous)");
    expect(tools).toContain("CHECKPOINT_SECRET_SNAPSHOT_BLOCKED");
    expect(tools).not.toContain("curl ");
    expect(tools).not.toContain("wget ");
    expect(tools).not.toContain("fetch(");
    expect(server).not.toContain("web_search_grounding");
  });

  it("keeps AI Studio direct runtime and fallback out of the release", () => {
    const metadata = JSON.parse(readRepositoryFile("metadata.json")) as { majorCapabilities?: string[] };
    const app = readRepositoryFile("src/server/createOriginApp.ts");
    const gate = readRepositoryFile("docs/ORIGIN_PERSONAL_RELEASE_1_GATE.md");
    expect(metadata.majorCapabilities).toBeUndefined();
    expect(app).toContain("releaseSha: resolveOriginReleaseSha(env)");
    expect(app).toContain("costUsd: 0");
    expect(app).toContain("freeOnly: true");
    expect(app).toContain("paidFallbackEnabled: false");
    expect(app).toContain('secretDelivery: "server-only"');
    expect(app).toContain("env.VERCEL_GIT_COMMIT_SHA");
    expect(app).toContain('["/health", "/api/health"]');
    expect(app).not.toContain("legacyRoutes");
    expect(app).not.toContain("MissionEngine");
    expect(gate).toContain("AI Studio direct runtimeは一次公開に含めない");
    expect(gate).toContain("provider層は同一固定model内の候補だけに限定され");
    expect(gate).toContain("実費`$0.00`");
    expect(gate).toContain("ORIGIN自身が別モデルまたは別providerへ自動で切り替えることはない");
  });

  it("states the selected serverless route and explicit deployment approval boundary", () => {
    const gate = readRepositoryFile("docs/ORIGIN_PERSONAL_RELEASE_1_GATE.md");
    expect(gate).toContain("デプロイについて、マージとは別の明示承認");
    expect(gate).toContain("Vercel serverless `api/index.ts` | SELECTED");
    expect(gate).toContain("Node/Docker `server.ts` | NOT SELECTED");
    expect(gate).toContain("リリースIDがデプロイ対象のExact SHAと一致する");
  });

  it("exercises release identity through the real E2E server boundary", () => {
    const playwrightConfig = readRepositoryFile("playwright.config.ts");
    const responsiveSpec = readRepositoryFile("tests/e2e/sprint-8-4-responsive-v2.spec.ts");
    const releaseFixture = readRepositoryFile("tests/e2e/release-fixture.ts");
    expect(playwrightConfig).toContain("ORIGIN_RELEASE_SHA: E2E_RELEASE_SHA");
    expect(responsiveSpec).not.toContain("page.route('**/api/health'");
    expect(responsiveSpec).toContain("toHaveText(E2E_RELEASE_SHA)");
    expect(releaseFixture).toContain("0123456789abcdef0123456789abcdef01234567");
    expect(releaseFixture).not.toContain("1dd8916fdc353b1692f290a21fdda9262f53476e");
  });

  it("does not publish invalidated release evidence or ignore Lighthouse failures", () => {
    const workflow = readRepositoryFile(".github/workflows/ci.yml");
    const lighthouseConfig = JSON.parse(readRepositoryFile(".lighthouserc.json")) as { ci?: { assert?: { assertions?: Record<string, [string, { minScore: number }]> } } };
    expect(workflow).not.toContain("PRODUCTION_EVIDENCE_REPORT.md");
    expect(workflow).not.toContain("Production_Evidence_Report_FINAL.md");
    expect(workflow).not.toContain('|| echo "Lighthouse audit completed with warnings."');
    expect(workflow).toContain("lhci autorun");
    const gitleaksStep = workflow.slice(workflow.indexOf("- name: Run Secret Scanning (Gitleaks)"), workflow.indexOf("- name: Setup Node.js"));
    expect(gitleaksStep).not.toContain("continue-on-error");
    expect(lighthouseConfig.ci?.assert?.assertions?.["categories:accessibility"]).toEqual(["error", { minScore: 0.9 }]);
    expect(lighthouseConfig.ci?.assert?.assertions?.["categories:best-practices"]).toEqual(["error", { minScore: 0.9 }]);
  });
});
