// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Execute the ACTUAL bash guard from every sensitive workflow. This test never
// executes a GitHub workflow, loads corpus secrets or calls any real API.
const workflows = [
  'image-edit-private-heldout-v1.yml',
  'image-private-heldout-v1.yml',
  'world-class-image-private-heldout-v2.yml',
  'world-class-image-private-shards-v1.yml',
  'world-class-image-edit-private-shards-v1.yml',
  'world-class-image-private-collect-v1.yml',
  'world-class-image-edit-private-collect-v1.yml',
] as const;

function guardsFromWorkflow(filename: string): string[] {
  const source = readFileSync(path.join(process.cwd(), '.github/workflows', filename), 'utf8');
  const jobs = source.split('    steps:\n').slice(1);
  expect(jobs.length).toBeGreaterThan(0);
  return jobs.map(job => {
    const name = '      - name: Verify approved private evaluator repository before any data access\n';
    const checkout = job.indexOf('      - name: Checkout');
    const start = job.indexOf(name);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeGreaterThan(start);
    expect(job.slice(0, start)).not.toContain('uses: ');
    const firstStep = job.slice(start, checkout);
    expect(firstStep).toContain('id: private_repo_guard');
    const run = firstStep.indexOf('        run: |\n');
    expect(run).toBeGreaterThanOrEqual(0);
    const lines = firstStep.slice(run + '        run: |\n'.length).split('\n');
    const shellLines: string[] = [];
    for (const line of lines) {
      if (line === '') continue;
      if (!line.startsWith('          ')) break;
      shellLines.push(line.slice(10));
    }
    const script = shellLines.join('\n');
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('gh api "repos/$GITHUB_REPOSITORY" --jq');
    return script;
  });
}

function execute(script: string, scenario: {
  eventPrivate?: boolean;
  visibility?: 'private' | 'public';
  approved?: string;
  liveApi?: 'private' | 'public' | 'error';
}) {
  const eventPrivate = String(scenario.eventPrivate ?? true);
  const visibility = scenario.visibility ?? 'private';
  const literalScript = script
    .replaceAll('${{ github.event.repository.private }}', eventPrivate)
    .replaceAll('${{ github.repository_visibility }}', visibility);
  expect(literalScript).not.toContain('${{');

  // Define a shell-local fake of the GitHub CLI. Hardened Coding Sandbox mounts
  // /tmp noexec: mock executables written there would fail *all valid cases*
  // with status 75, even though the real workflow bash guard is correct.
  // A Bash function avoids filesystem execution and keeps this test hermetic.
  const fakeGitHubApi = [
    'gh() {',
    '  [[ "$1" = api && "$2" = "repos/$GITHUB_REPOSITORY" && "$3" = --jq && "$4" = .private ]] || return 40',
    '  case "$MOCK_LIVE_REPOSITORY" in',
    "    private) printf 'true\\n' ;;",
    "    public) printf 'false\\n' ;;",
    '    *) return 44 ;;',
    '  esac',
    '}',
  ].join('\\n');
  const result = spawnSync('bash', ['-c', fakeGitHubApi + '\\n' + literalScript], {
    encoding: 'utf8',
    timeout: 4000,
    env: {
      PATH: process.env.PATH,
      GITHUB_REPOSITORY: 'owner/private-image-eval',
      GH_TOKEN: 'synthetic-no-secret-token',
      EXPECTED_PRIVATE_IMAGE_EVAL_REPOSITORY: scenario.approved ?? 'owner/private-image-eval',
      MOCK_LIVE_REPOSITORY: scenario.liveApi ?? 'private',
    },
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, stderr: result.stderr };
}

describe('Image evaluation: execute every private-repository gate without secrets', () => {
  const scripts = workflows.flatMap(name =>
    guardsFromWorkflow(name).map((script, job) => ({ name, job, script })));
  it('has exactly ten source-preserving protected jobs', () => {
    expect(scripts).toHaveLength(10);
  });
  for (const { name, job, script } of scripts) {
    it(`${name} job #${job + 1} only permits an approved live-private repository`, () => {
      expect(execute(script, {}).status).toBe(0);
      expect(execute(script, { eventPrivate: false })).toMatchObject({
        status: 73,
      });
      expect(execute(script, { visibility: 'public' }).status).toBe(73);
      expect(execute(script, { approved: '' }).status).toBe(74);
      expect(execute(script, { approved: 'other/unauthorized' }).status).toBe(74);
      expect(execute(script, { liveApi: 'error' }).status).toBe(75);
      expect(execute(script, { liveApi: 'public' }).status).toBe(76);
    });
  }
});
