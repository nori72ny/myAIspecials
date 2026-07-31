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

    expect(apiEntrypoint).toContain('import { createOriginApp }');
    expect(apiEntrypoint).toContain("const app = createOriginApp()");
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
    expect(modelCatalog).toContain('"inclusionai/ling-3.0-flash:free"');
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
  });
});
