import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeCodingMutablePathV14 } from './codingPathPolicyV14.js';

export type HeldOutTrustedScopeV14 = {
  allowedPaths: string[];
  creatablePaths: string[];
};

/**
 * Bind the public benchmark contract's required production paths to a trusted
 * coding-session scope. This is controller-side evaluator metadata, not hidden
 * test content and not model-inferred repository authority.
 *
 * Existing regular files become editable. Missing required paths become
 * creatable. Directories, symlinks and unsafe paths fail closed.
 */
export async function resolveHeldOutTrustedScopeV14(
  root: string,
  requiredChangedPaths: readonly string[],
): Promise<HeldOutTrustedScopeV14> {
  if (!Array.isArray(requiredChangedPaths) || requiredChangedPaths.length < 2 || requiredChangedPaths.length > 12) {
    throw new Error('HELD_OUT_REQUIRED_SCOPE_INVALID');
  }

  const allowedPaths: string[] = [];
  const creatablePaths: string[] = [];
  const seen = new Set<string>();

  for (const raw of requiredChangedPaths) {
    let relative: string;
    try {
      relative = normalizeCodingMutablePathV14(raw);
    } catch {
      throw new Error('HELD_OUT_REQUIRED_SCOPE_INVALID');
    }
    if (seen.has(relative)) throw new Error('HELD_OUT_REQUIRED_SCOPE_INVALID');
    seen.add(relative);

    const target = path.join(root, relative);
    try {
      const entry = await fs.lstat(target);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('HELD_OUT_REQUIRED_SCOPE_INVALID');
      allowedPaths.push(relative);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        creatablePaths.push(relative);
        continue;
      }
      if (error instanceof Error && error.message === 'HELD_OUT_REQUIRED_SCOPE_INVALID') throw error;
      throw new Error('HELD_OUT_REQUIRED_SCOPE_INVALID');
    }
  }

  if (!allowedPaths.length && !creatablePaths.length) throw new Error('HELD_OUT_REQUIRED_SCOPE_INVALID');
  if (creatablePaths.length > 4) throw new Error('HELD_OUT_REQUIRED_SCOPE_INVALID');
  return { allowedPaths, creatablePaths };
}
