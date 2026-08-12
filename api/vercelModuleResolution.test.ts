import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const relativeImportPattern = /(?:from\s+|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/g;

function resolveTypeScriptSource(importer: string, specifier: string): string | undefined {
  const sourceBase = resolve(dirname(importer), specifier.replace(/\.js$/, ""));
  return [sourceBase, `${sourceBase}.ts`, `${sourceBase}.tsx`, join(sourceBase, "index.ts")]
    .find((candidate) => existsSync(candidate));
}

describe("Vercel Node ESM module graph", () => {
  it("uses emitted .js specifiers throughout the serverless dependency graph", () => {
    const pending = [join(repositoryRoot, "api/index.ts")];
    const visited = new Set<string>();
    const invalidSpecifiers: string[] = [];

    while (pending.length > 0) {
      const sourcePath = pending.pop();
      if (!sourcePath || visited.has(sourcePath)) continue;
      visited.add(sourcePath);

      const source = readFileSync(sourcePath, "utf8");
      for (const match of source.matchAll(relativeImportPattern)) {
        const specifier = match[2];
        if (!specifier.endsWith(".js")) {
          invalidSpecifiers.push(`${sourcePath}:${specifier}`);
          continue;
        }

        const dependency = resolveTypeScriptSource(sourcePath, specifier);
        if (dependency) pending.push(dependency);
      }
    }

    expect(visited.size).toBeGreaterThan(1);
    expect(invalidSpecifiers).toEqual([]);
  });
});
