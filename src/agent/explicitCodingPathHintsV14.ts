import { readRepositoryFile } from './safeRepositoryReader.js';
import { normalizeCodingContextPathV14 } from './codingPathPolicyV14.js';
import type { CodingDiscoveryContext } from './codingSessionV14.js';

const MAX_DISCOVERY_FILES = 200;
const MAX_EXPLICIT_HINTS = 12;
const PATH_TOKEN = /[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+/g;

function explicitPathTokens(goal: string): string[] {
  const matches = goal.match(PATH_TOKEN) ?? [];
  const unique: string[] = [];
  for (const candidate of matches) {
    if (unique.includes(candidate)) continue;
    try {
      const normalized = normalizeCodingContextPathV14(candidate);
      unique.push(normalized);
    } catch {
      // Invalid/protected-looking path text is never probed or authorized.
    }
    if (unique.length >= MAX_EXPLICIT_HINTS) break;
  }
  return unique;
}

async function existingExplicitPaths(root: string, goal: string): Promise<string[]> {
  const existing: string[] = [];
  for (const candidate of explicitPathTokens(goal)) {
    try {
      await readRepositoryFile(root, candidate);
      existing.push(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || (error instanceof Error && error.message === 'NOT_A_FILE')) continue;
      // Race-safe reader policy failures are fail-closed by omission. The session
      // remains responsible for final scope validation before any mutation.
    }
  }
  return existing;
}

/**
 * Bounded discovery inventories can omit deep files in large repositories. If
 * the goal explicitly names a safe path that already exists, reserve inventory
 * space for it before model-assisted discovery. Missing paths are not added:
 * they remain subject to the navigator's explicit-create policy.
 */
export async function augmentCodingDiscoveryContextV14(
  root: string,
  context: CodingDiscoveryContext,
): Promise<CodingDiscoveryContext> {
  const prioritized = await existingExplicitPaths(root, context.goal);
  if (!prioritized.length) return context;
  const seen = new Set(prioritized);
  const files = [...prioritized];
  for (const filePath of context.files) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    files.push(filePath);
    if (files.length >= MAX_DISCOVERY_FILES) break;
  }
  return { goal: context.goal, files };
}
