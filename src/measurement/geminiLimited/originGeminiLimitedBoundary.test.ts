import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Import boundary for the Gemini limited gate (design §3.1 / §4.2):
 *
 * - NOTHING outside this directory may import the gate. In particular the
 *   normal routes (chat routers, failover, provider clients, server app) must
 *   stay completely independent of it, so removing the gate can never affect
 *   production behavior. Measurement harnesses connect in a later, separately
 *   reviewed phase; when they do, this test's allowlist is where that change
 *   becomes visible.
 * - The gate itself may import ONLY node builtins and its own sibling files.
 *   It must never import the normal-route code (no shared fate, no lock-in).
 */

const GATE_DIR = resolve(process.cwd(), "src/measurement/geminiLimited");
const GATE_REFERENCE_PATTERN = /measurement\/geminiLimited|originGeminiLimited(?:Gate|Evidence)/;

function listSourceFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root, { recursive: true }) as unknown as string[];
  } catch {
    return [];
  }
  return entries
    .filter((entry) => /\.(?:ts|tsx|mts|cts)$/.test(entry))
    .map((entry) => join(root, entry));
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return specifiers;
}

describe("Gemini limited gate import boundary", () => {
  it("is not referenced by any code outside the gate directory", () => {
    const roots = [
      resolve(process.cwd(), "src"),
      resolve(process.cwd(), "scripts"),
      resolve(process.cwd(), "api"),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of listSourceFiles(root)) {
        if (file.startsWith(GATE_DIR)) continue;
        const source = readFileSync(file, "utf8");
        if (GATE_REFERENCE_PATTERN.test(source)) offenders.push(file);
      }
    }
    const serverEntry = resolve(process.cwd(), "server.ts");
    try {
      if (GATE_REFERENCE_PATTERN.test(readFileSync(serverEntry, "utf8"))) offenders.push(serverEntry);
    } catch { /* server.ts absent in some checkouts */ }
    expect(offenders).toEqual([]);
  });

  it("gate modules import only node builtins and gate siblings", () => {
    const gateSources = listSourceFiles(GATE_DIR).filter((file) => !file.endsWith(".test.ts"));
    expect(gateSources.length).toBeGreaterThan(0);
    for (const file of gateSources) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        const allowed = specifier.startsWith("node:")
          || (specifier.startsWith("./") && !specifier.includes(".."));
        expect(allowed, `${file} imports forbidden specifier: ${specifier}`).toBe(true);
      }
    }
  });

  it("gate modules never reference the normal-route provider machinery", () => {
    const forbidden = [
      "originProviderClient",
      "originProviderFailover",
      "originChatRouter",
      "originStreamingChatRouter",
      "originGroqProviderClient",
      "originCloudflareProviderClient",
      "createOriginApp",
    ];
    const gateSources = listSourceFiles(GATE_DIR).filter((file) => !file.endsWith(".test.ts"));
    for (const file of gateSources) {
      const source = readFileSync(file, "utf8");
      for (const token of forbidden) {
        expect(source.includes(token), `${file} references ${token}`).toBe(false);
      }
    }
  });

  it("contains the Gemini egress in exactly one module", () => {
    const gateSources = listSourceFiles(GATE_DIR).filter((file) => !file.endsWith(".test.ts"));
    // Compare whole hostname tokens by strict equality, so a lookalike host
    // (e.g. "generativelanguage.googleapis.com.evil.example") never counts
    // as the egress endpoint.
    const egressHost = "generativelanguage.googleapis.com";
    const mentionsEgressHost = (source: string) =>
      source.split(/[^a-zA-Z0-9.-]+/).some((token) => token === egressHost);
    const withEndpoint = gateSources.filter((file) => mentionsEgressHost(readFileSync(file, "utf8")));
    expect(withEndpoint.map((file) => file.split("/").pop())).toEqual(["originGeminiLimitedGate.ts"]);
  });
});
