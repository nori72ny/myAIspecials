// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { scripts?: Record<string, string> };

const frontierDoc = readFileSync(
  new URL('../../docs/ORIGIN_FRONTIER_EVALUATION_V1.md', import.meta.url),
  'utf8',
);

const worldClassDoc = readFileSync(
  new URL('../../docs/ORIGIN_WORLD_CLASS_QUALITY_STANDARD.md', import.meta.url),
  'utf8',
);

const currentMainTrigger = readFileSync(
  new URL('../../.github/workflows/aq-v2-current-main-trigger.yml', import.meta.url),
  'utf8',
);

describe('frontier evaluation contract', () => {
  it('keeps the trusted raw-evidence V2 gate canonical', () => {
    expect(packageJson.scripts?.['eval:world-class-quality']).toBe(
      'tsx scripts/evaluate-trusted-world-class-quality-gate-v2.ts',
    );
    expect(frontierDoc).toContain('origin.trusted-world-class-quality-gate.v2');
    expect(worldClassDoc).toContain('origin.trusted-world-class-quality-gate.v2');
    expect(worldClassDoc).not.toContain('The executable contract is `origin.world-class-quality-gate.v1`');
  });

  it('binds every frontier domain to the executable repository commands', () => {
    const requiredScripts: Record<string, string> = {
      'eval:trusted-answer-quality-v2': 'tsx scripts/qualify-trusted-answer-quality-v2.ts',
      'eval:trusted-answer-blind-v2': 'tsx scripts/qualify-trusted-answer-blind-preference-v2.ts',
      'eval:heldout-coding:trusted-comparison': 'tsx scripts/evaluate-held-out-coding-trusted-comparison-v14.ts',
      'eval:heldout-agent:private': 'tsx scripts/run-general-agent-private-v2.ts',
      'eval:heldout-agent:trusted-comparison': 'tsx scripts/evaluate-general-agent-trusted-comparison-v2.ts',
      'eval:image-blind-quality': 'tsx scripts/evaluate-image-blind-quality-v15.ts',
      'eval:image-private': 'tsx scripts/run-image-private-heldout-v1.ts',
      'eval:artifact-blind-quality': 'tsx scripts/evaluate-artifact-blind-quality-v1.ts',
      'eval:artifact-private': 'tsx scripts/run-artifact-private-heldout-v1.ts',
    };

    for (const [name, command] of Object.entries(requiredScripts)) {
      expect(packageJson.scripts?.[name]).toBe(command);
      expect(frontierDoc).toContain(`npm run ${name}`);
    }
  });

  it('requires honest current-SHA evidence states instead of inherited claims', () => {
    expect(frontierDoc).toContain('`NOT MEASURED`');
    expect(frontierDoc).toContain('Evidence from a different ORIGIN SHA does not transfer');
    expect(worldClassDoc).toContain('Historical qualification is useful context but is not inherited by a new SHA.');
  });

  it('keeps the legacy aggregate evaluator explicitly non-canonical', () => {
    expect(packageJson.scripts?.['eval:world-class-quality:legacy']).toBe(
      'tsx scripts/evaluate-world-class-quality-gate.ts',
    );
    expect(frontierDoc).toContain('legacy aggregate evaluator is diagnostics-only');
    expect(worldClassDoc).toContain('legacy command remains available for diagnostics only');
  });

  it('dispatches AQ V2 only for an explicitly confirmed exact current-main candidate', () => {
    expect(currentMainTrigger).toContain("github.ref == 'refs/heads/main'");
    expect(currentMainTrigger).toContain('candidate_sha:process.env.CANDIDATE_SHA');
    expect(currentMainTrigger).toContain("pr_number:'0'");
    expect(currentMainTrigger).toContain("confirmation!=='RUN_FRESH_CURRENT_MAIN'");
    expect(currentMainTrigger).toContain('corpus_digest:process.env.CORPUS_DIGEST');
    expect(currentMainTrigger).toContain('origin/aq-v2-corpus/${CORPUS_DIGEST}');
    expect(currentMainTrigger).toContain("steps.corpus.outputs.reserved != '1'");
    expect(currentMainTrigger).toContain('origin/aq-v2-free-quota/${utc_day}');
    expect(currentMainTrigger).not.toContain('PR 698');
    expect(currentMainTrigger).not.toContain('cb5a6a6e3ef44973da1e40bb253b6b6bf26779e0');
    expect(currentMainTrigger).not.toContain('origin-aq-v2-independent-2026-09-28-fresh-3');
  });
});
