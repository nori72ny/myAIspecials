import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const environmentTemplate = readFileSync(
  resolve(process.cwd(), ".env.example"),
  "utf8",
);

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
});
