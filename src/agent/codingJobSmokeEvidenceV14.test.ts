// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exercise the actual release gate, not a second implementation of its rules.
const workflow = readFileSync('.github/workflows/coding-production-smoke-v14.yml', 'utf8');
const start = workflow.indexOf("          const expectedPath =");
const end = workflow.indexOf('\n          NODE', start);
if (start < 0 || end < 0) throw new Error('Coding smoke evidence gate was not found');
const gate = workflow.slice(start, end);
const sha = 'a'.repeat(40);
const jobId = 'coding-AAAAAAAAAAAAAAAAAAAAAA';
const target = 'src/agent/__origin_coding_smoke_v14__.ts';

function fixture() {
  return {
    ok: true, releaseSha: sha, job: { jobId, status: 'verified', changedPaths: [target] },
    resultDetailsState: 'available', freeOnly: true, costUsd: 0, paidFallbackUsed: false,
    result: {
      sessionStatus: 'verified', repairRounds: 1,
      executionEvidence: { sourceRevision: sha, workerRunId: '12345', workerRunAttempt: 1 },
      verificationChecks: ['typecheck', 'lint', 'test', 'build'].map(kind => ({ kind, ok: true, exitCode: 0, timedOut: false, attempt: 1 })),
      diffs: [{ path: target, kind: 'created', before: null, after: 'export const ORIGIN_CODING_SMOKE_V14 = true;\n', previewAvailable: true }],
      freeOnly: true, costUsd: 0, gitPublished: false, deployed: false,
    },
  };
}

function verify(v: unknown) {
  runInNewContext(gate, {
    v, console: { error: () => undefined },
    process: { env: { RELEASE_SHA: sha, JOB_ID: jobId }, exit: () => { throw new Error('SMOKE_REJECTED'); } },
  }, { timeout: 1000 });
}

describe('production smoke result evidence gate', () => {
  it('accepts a matching worker revision and final successful checks', () => {
    expect(() => verify(fixture())).not.toThrow();
  });
  it('rejects a historical result without worker provenance', () => {
    const value = fixture();
    const { executionEvidence: _old, ...historical } = value.result;
    expect(() => verify({ ...value, result: historical })).toThrow('SMOKE_REJECTED');
  });
  it.each([
    (v: ReturnType<typeof fixture>) => { v.result.executionEvidence.sourceRevision = 'b'.repeat(40); },
    (v: ReturnType<typeof fixture>) => { v.result.executionEvidence.workerRunId = 'invalid'; },
    (v: ReturnType<typeof fixture>) => { v.result.executionEvidence.workerRunAttempt = 0; },
    (v: ReturnType<typeof fixture>) => { v.result.verificationChecks[0].attempt = 0; },
    (v: ReturnType<typeof fixture>) => { v.result.verificationChecks[0].timedOut = true; },
    (v: ReturnType<typeof fixture>) => { v.result.verificationChecks.pop(); },
    (v: ReturnType<typeof fixture>) => { v.resultDetailsState = 'unavailable'; },
    (v: ReturnType<typeof fixture>) => { v.paidFallbackUsed = true; },
    (v: ReturnType<typeof fixture>) => { v.result.costUsd = 1; },
  ])('rejects incomplete or inconsistent execution evidence %#', mutate => {
    const value = fixture();
    mutate(value);
    expect(() => verify(value)).toThrow('SMOKE_REJECTED');
  });
});
