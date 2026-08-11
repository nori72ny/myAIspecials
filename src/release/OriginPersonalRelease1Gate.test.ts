import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepositoryFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("ORIGIN Personal release 1 gate", () => {
  it("routes a serverless deployment through the authoritative ORIGIN app", () => {
    const apiEntrypoint = readRepositoryFile("api/index.ts");
    const vercelConfig = JSON.parse(readRepositoryFile("vercel.json")) as {
      rewrites?: Array<{ source?: string; destination?: string }>;
    };

    expect(apiEntrypoint).toContain(
      'import("../src/server/createOriginApp.ts")',
    );
    expect(apiEntrypoint).toContain("createVercelHandler");
    expect(apiEntrypoint).toContain("request: IncomingMessage");
    expect(apiEntrypoint).toContain("response: ServerResponse");
    expect(apiEntrypoint).toContain(
      'console.error("ORIGIN_FUNCTION_INIT_FAILED", diagnostic)',
    );
    expect(apiEntrypoint).not.toContain("console.error(error)");
    expect(vercelConfig.rewrites).toContainEqual({
      source: "/api/(.*)",
      destination: "/api/index.ts",
    });
  });

  it("keeps the Cloudflare Worker provider route ineligible for release 1", () => {
    const worker = readRepositoryFile("worker/index.mjs");

    expect(worker).toContain("providerExecutionEnabled: false");
    expect(worker).toContain('url.pathname === "/api/v1/ai/free-chat"');
    expect(worker).toContain("return json(DISABLED_AI_RESPONSE, 503, headers)");
  });

  it("locks provider execution to one fixed OpenRouter free model", () => {
    const providerClient = readRepositoryFile(
      "src/legacy/originProviderClient.ts",
    );
    const modelCatalog = readRepositoryFile(
      "src/lib/orchestration/OriginFreeModelCatalog.ts",
    );

    expect(providerClient).toContain(
      'request.plan.providerId !== "openrouter-free"',
    );
    expect(providerClient).toContain(
      "request.plan.modelId === ORIGIN_OPENROUTER_FREE_MODEL",
    );
    expect(providerClient).toContain("servedModel !== requestedModel");
    expect(providerClient).not.toContain('"openrouter/free"');
    expect(providerClient).not.toContain("for (const attempt");
    expect(modelCatalog).toContain('"nvidia/nemotron-3-ultra-550b-a55b:free"');
    expect(modelCatalog).not.toContain('"openrouter/free"');
    expect(providerClient).toContain("const apiKey = env.OPENROUTER_API_KEY");
    expect(providerClient).toContain(
      "allow_fallbacks: request.plan.providerDataPolicy.allowProviderFallbacks",
    );
    expect(providerClient).toContain(
      "data_collection: request.plan.providerDataPolicy.dataCollection",
    );
    expect(providerClient).toContain(
      "const costUsd = verifiedZeroCost(data.usage?.cost)",
    );
    expect(providerClient).toContain(
      "const routingEvidence = verifiedRoutingEvidence(",
    );
  });

  it("removes the Gemini capability declaration and exposes the release SHA", () => {
    const metadata = JSON.parse(readRepositoryFile("metadata.json")) as {
      majorCapabilities?: string[];
    };
    const app = readRepositoryFile("src/server/createOriginApp.ts");

    expect(metadata.majorCapabilities).toBeUndefined();
    expect(app).toContain("releaseSha: resolveOriginReleaseSha(env)");
    expect(app).toContain("env.VERCEL_GIT_COMMIT_SHA");
    expect(app).toContain('["/health", "/api/health"]');
    expect(app).not.toContain("legacyRoutes");
    expect(app).not.toContain("MissionEngine");
  });

  it("states that AI Studio direct runtime is outside the first release", () => {
    const gate = readRepositoryFile(
      "docs/ORIGIN_PERSONAL_RELEASE_1_GATE.md",
    );

    expect(gate).toContain(
      "AI Studio direct runtimeは一次公開に含めない",
    );
    expect(gate).toContain("デプロイについて、マージとは別の明示承認");
    expect(gate).toContain("実費`$0.00`");
    expect(gate).toContain("別モデルや別providerへ自動で切り替えない");
    expect(gate).toContain("Vercel serverless `api/index.ts` | SELECTED");
    expect(gate).toContain("Node/Docker `server.ts` | NOT SELECTED");
    expect(gate).toContain("リリースIDがデプロイ対象のExact SHAと一致する");
  });

  it("exercises release identity through the real E2E server boundary", () => {
    const playwrightConfig = readRepositoryFile("playwright.config.ts");
    const responsiveSpec = readRepositoryFile(
      "tests/e2e/sprint-8-4-responsive-v2.spec.ts",
    );
    const releaseFixture = readRepositoryFile(
      "tests/e2e/release-fixture.ts",
    );

    expect(playwrightConfig).toContain("ORIGIN_RELEASE_SHA: E2E_RELEASE_SHA");
    expect(responsiveSpec).not.toContain("page.route('**/api/health'");
    expect(responsiveSpec).toContain("toHaveText(E2E_RELEASE_SHA)");
    expect(releaseFixture).toContain(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(releaseFixture).not.toContain(
      "1dd8916fdc353b1692f290a21fdda9262f53476e",
    );
  });

  it("does not publish invalidated release evidence or ignore Lighthouse failures", () => {
    const workflow = readRepositoryFile(".github/workflows/ci.yml");
    const lighthouseConfig = JSON.parse(
      readRepositoryFile(".lighthouserc.json"),
    ) as {
      ci?: { assert?: { assertions?: Record<string, [string, { minScore: number }]> } };
    };

    expect(workflow).not.toContain("PRODUCTION_EVIDENCE_REPORT.md");
    expect(workflow).not.toContain("Production_Evidence_Report_FINAL.md");
    expect(workflow).not.toContain('|| echo "Lighthouse audit completed with warnings."');
    expect(workflow).toContain("lhci autorun");
    const gitleaksStep = workflow.slice(
      workflow.indexOf("- name: Run Secret Scanning (Gitleaks)"),
      workflow.indexOf("- name: Setup Node.js"),
    );
    expect(gitleaksStep).not.toContain("continue-on-error");
    expect(
      lighthouseConfig.ci?.assert?.assertions?.["categories:accessibility"],
    ).toEqual(["error", { minScore: 0.9 }]);
    expect(
      lighthouseConfig.ci?.assert?.assertions?.["categories:best-practices"],
    ).toEqual(["error", { minScore: 0.9 }]);
  });
});
