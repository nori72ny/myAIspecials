import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  scripts?: Record<string, string>;
};

const ROOT = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as PackageJson;

function repositoryFileTargets(script: string): string[] {
  return Array.from(
    script.matchAll(/\b((?:scripts|src|tests)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs))\b/g),
    match => match[1],
  );
}

describe('package script truthfulness', () => {
  it('does not advertise removed repair benchmark commands', () => {
    expect(packageJson.scripts).not.toHaveProperty('test:repair-e2e');
    expect(packageJson.scripts).not.toHaveProperty('test:repair-benchmark');
    expect(packageJson.scripts).not.toHaveProperty('test:repair-policy-100');
  });

  it('exposes one repair-core command backed only by existing current tests', () => {
    const command = packageJson.scripts?.['test:repair-core'];
    expect(command).toBeTruthy();
    expect(repositoryFileTargets(command ?? '')).toEqual([
      'src/agent/codingSessionV14.test.ts',
      'src/agent/codingRepeatedPatchV14.test.ts',
      'src/agent/checkpointManager.test.ts',
      'tests/taskGraphResume.test.ts',
    ]);
  });

  it('keeps every repository file named directly by an npm script present', () => {
    const missing = Object.entries(packageJson.scripts ?? {}).flatMap(([name, script]) =>
      repositoryFileTargets(script)
        .filter(path => !existsSync(resolve(ROOT, path)))
        .map(path => ({ name, path })),
    );
    expect(missing).toEqual([]);
  });
});
