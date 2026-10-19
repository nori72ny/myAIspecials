// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PRIVATE_HELDOUT_WORKFLOWS = [
  '.github/workflows/image-private-heldout-v1.yml',
  '.github/workflows/image-edit-private-heldout-v1.yml',
  '.github/workflows/world-class-image-private-heldout-v2.yml',
] as const;

function hasPrivateRepositoryPreflight(yaml: string): boolean {
  const jobs = yaml.split('    steps:\n').slice(1);
  if (jobs.length !== 2) return false;
  return jobs.every(job => {
    const guard = job.indexOf('id: private_repo_guard');
    const checkout = job.indexOf('uses: actions/checkout@');
    const firstStep = job.indexOf('      - name: ');
    if (guard < 0 || checkout <= guard || firstStep < 0 ||
      !job.slice(firstStep, checkout).includes('Verify approved private evaluator repository')) return false;
    const code = job.slice(firstStep, checkout);
    return [
      'set -euo pipefail',
      'github.event.repository.private',
      'github.repository_visibility',
      'ORIGIN_PRIVATE_IMAGE_EVAL_REPOSITORY',
      'GITHUB_REPOSITORY',
      'gh api "repos/$GITHUB_REPOSITORY" --jq \'.private\'',
      'IMAGE_EVAL_PRIVATE_REPOSITORY_REQUIRED',
      'IMAGE_EVAL_PRIVATE_REPOSITORY_ALLOWLIST_REQUIRED',
      'IMAGE_EVAL_REPOSITORY_METADATA_UNAVAILABLE',
      'IMAGE_EVAL_REPOSITORY_BECAME_PUBLIC',
    ].every(t => code.includes(t));
  });
}

describe('Private image-held-out artifact repository boundary', () => {
  for (const file of PRIVATE_HELDOUT_WORKFLOWS) {
    const original = readFileSync(resolve(process.cwd(), file), 'utf8');

    it(file + ': denies unapproved or public environment before checkout in both jobs', () => {
      expect(hasPrivateRepositoryPreflight(original)).toBe(true);
      expect(original).toContain('workflow_dispatch:');
      expect(original).toContain("github.ref == 'refs/heads/main'");
      expect(original).not.toContain('continue-on-error: true');
    });

    it(file + ': negative mutations of all security assertions fail closed', () => {
      for (const match of [
        'github.event.repository.private',
        'github.repository_visibility',
        'ORIGIN_PRIVATE_IMAGE_EVAL_REPOSITORY',
        'gh api "repos/$GITHUB_REPOSITORY" --jq \'.private\'',
      ]) {
        expect(hasPrivateRepositoryPreflight(original.replaceAll(match, 'DISABLED_SECURITY_CHECK'))).toBe(false);
      }
      expect(hasPrivateRepositoryPreflight(original.replaceAll('id: private_repo_guard', 'id: bypass'))).toBe(false);
    });
  }
});
