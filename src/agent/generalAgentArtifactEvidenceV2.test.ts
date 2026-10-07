import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGeneralAgentArtifactEvidenceV2 as verify } from './generalAgentArtifactEvidenceV2';
const content = '売上合計：5200円\n末尾を保持';
const expectation = { sha256: createHash('sha256').update(content).digest('hex'), byteLength: Buffer.byteLength(content) };

describe('independent agent artifact expectation', () => {
  it('does not treat a completed status or nonempty output as proof', () => {
    expect(verify(content, undefined)).toEqual({ ok: false, code: 'TASK_ARTIFACT_EXPECTATION_MISSING' });
  });
  it('accepts the complete UTF-8 artifact matching the evaluator expectation', () => {
    expect(verify(content, expectation).ok).toBe(true);
  });
  it.each(['売上合計：5201円\n末尾を保持', content.slice(0, -1), content + '余計な文', ''])('rejects wrong, missing and extra content', value => {
    expect(verify(value, expectation).ok).toBe(false);
  });
  it('rejects a character count substituted for UTF-8 byte length', () => {
    expect(verify(content, { ...expectation, byteLength: content.length }).ok).toBe(false);
  });
  it('accepts an explicitly expected empty file but never absent output', () => {
    const empty = { sha256: createHash('sha256').update('').digest('hex'), byteLength: 0 };
    expect(verify('', empty).ok).toBe(true);
    expect(verify(undefined, empty).ok).toBe(false);
  });
  it('rejects malformed expectations', () => {
    expect(verify(content, { ...expectation, sha256: 'invalid' }).ok).toBe(false);
    expect(verify(content, { ...expectation, byteLength: NaN }).ok).toBe(false);
  });
});
