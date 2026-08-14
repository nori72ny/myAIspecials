import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const environmentTemplate = readProjectFile(".env.example");

describe("ORIGIN Personal environment boundary", () => {
  it("declares only the free runtime provider credential", () => {
    expect(environmentTemplate).toContain('OPENROUTER_API_KEY=""');
    expect(environmentTemplate).toContain('FREE_ONLY="true"');

    const inactiveCredentials = [
      "GEMINI_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "PERPLEXITY_API_KEY",
      "GITHUB_TOKEN",
      "DATABASE_URL",
      "POSTGRES_PASSWORD",
      "REDIS_URL",
    ];

    for (const variable of inactiveCredentials) {
      expect(environmentTemplate).not.toMatch(
        new RegExp(`^${variable}=`, "m"),
      );
    }
  });

  it("keeps database clients outside the Personal chat runtime", () => {
    const personalRuntimeFiles = [
      "api/index.ts",
      "src/server/createOriginApp.ts",
      "src/legacy/originChatRouter.ts",
      "src/legacy/originProviderClient.ts",
    ];

    for (const path of personalRuntimeFiles) {
      const source = readProjectFile(path);
      expect(source).not.toMatch(
        /PostgresClient|RedisClient|DATABASE_URL|REDIS_URL|from ["'](?:pg|redis)["']/,
      );
    }
  });
});
