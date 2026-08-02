import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepositoryFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("ORIGIN Cloud Run production path", () => {
  it("binds one verified GitHub commit to build, image, and runtime", () => {
    const config = readRepositoryFile("cloudbuild.production.yaml");

    expect(config).toContain('test "$${REPO_NAME_VALUE}" = "myAIspecials"');
    expect(config).toContain('test "$${REPO_FULL_NAME_VALUE}" = "nori72ny/myAIspecials"');
    expect(config).toContain('test "$${BRANCH_NAME_VALUE}" = "main"');
    expect(config).toContain("grep -Eq '^[0-9a-f]{40}$'");
    expect(config).toContain('test "$${APPROVED_RELEASE_SHA_VALUE}" = "$${COMMIT_SHA_VALUE}"');
    expect(config).toContain('_APPROVED_RELEASE_SHA: ""');
    expect(config).toContain("grep -Eq '^[a-z]+-[a-z]+[0-9]+$'");
    expect(config).toContain("grep -Eq '^[A-Za-z0-9_-]{1,255}$'");
    expect(config).toContain("ORIGIN_RELEASE_SHA=$COMMIT_SHA");
    expect(config).toContain("${_SERVICE}:$COMMIT_SHA");
    expect(config).not.toContain("${_SERVICE}:latest");
    expect(config).toContain("gcloud artifacts docker images describe");
    expect(config).toContain("--image=\"$${image_ref}\"");
    expect(config).toContain("--service-account=\"$${RUNTIME_SERVICE_ACCOUNT_VALUE}\"");
    expect(config).toContain('test "$${BUILD_SERVICE_ACCOUNT_VALUE}" = "$${EXPECTED_BUILD_SERVICE_ACCOUNT_VALUE}"');
  });

  it("fails closed in the container at build and runtime", () => {
    const dockerfile = readRepositoryFile("Dockerfile");
    const startup = readRepositoryFile("scripts/start-cloud-run.mjs");

    expect(dockerfile).toContain("ARG ORIGIN_RELEASE_SHA");
    expect(dockerfile).toContain("ENV ORIGIN_RELEASE_SHA=$ORIGIN_RELEASE_SHA");
    expect(dockerfile).toContain(
      'RUN node scripts/assert-origin-release-sha.mjs "$ORIGIN_RELEASE_SHA"',
    );
    expect(dockerfile).toContain('CMD ["npm", "run", "start:cloud-run"]');
    expect(dockerfile).toContain("USER node");
    expect(startup).toContain("assertOriginProductionEnv({ imageReleaseSha })");
  });

  it("keeps provider credentials server-only and does not add Gemini", () => {
    const config = readRepositoryFile("cloudbuild.production.yaml");
    const dockerfile = readRepositoryFile("Dockerfile");
    const runbook = readRepositoryFile(
      "docs/ORIGIN_CLOUD_RUN_PRODUCTION_PATH.md",
    );

    expect(config).toContain(
      '--update-secrets="OPENROUTER_API_KEY=$${OPENROUTER_SECRET_VALUE}:$${OPENROUTER_SECRET_VERSION_VALUE}"',
    );
    expect(config).not.toContain("--set-env-vars=OPENROUTER_API_KEY");
    expect(config).not.toContain("GEMINI_API_KEY");
    expect(config).not.toContain("GOOGLE_API_KEY");
    expect(dockerfile).not.toContain("OPENROUTER_API_KEY");
    expect(dockerfile).not.toContain("GEMINI_API_KEY");
    expect(runbook).toContain(
      "`GEMINI_API_KEY`、`GOOGLE_API_KEY`、`GOOGLE_GENERATIVE_AI_API_KEY`を本番要件へ追加しない",
    );
  });

  it("excludes local credentials and generated evidence from build contexts", () => {
    for (const path of [".dockerignore", ".gcloudignore"]) {
      const ignore = readRepositoryFile(path);
      expect(ignore).toContain(".git");
      expect(ignore).toContain(".env*");
      expect(ignore).toContain(".npmrc");
      expect(ignore).toContain("*.pem");
      expect(ignore).toContain("*.key");
      expect(ignore).toContain("node_modules");
      expect(ignore).toContain("test-results");
      expect(ignore).toContain("evidence");
    }
  });

  it("does not configure billing and keeps deployment separately approved", () => {
    const config = readRepositoryFile("cloudbuild.production.yaml");
    const runbook = readRepositoryFile(
      "docs/ORIGIN_CLOUD_RUN_PRODUCTION_PATH.md",
    );

    expect(config.toLowerCase()).not.toContain("billing");
    expect(config).toContain("--min-instances=0");
    expect(config).toContain("--max-instances=1");
    expect(runbook).toContain("デプロイを実行しない");
    expect(runbook).toContain("別の明示承認が必要");
    expect(runbook).toContain("課金設定を要求された場合は停止する");
    expect(runbook).toContain("AI Studioのワンクリック公開はExact SHA要件を満たす本番経路として現時点では`NOT ELIGIBLE`");
    expect(runbook).toContain("`_APPROVED_RELEASE_SHA`はtrigger設定へ保存せず");
  });
});
