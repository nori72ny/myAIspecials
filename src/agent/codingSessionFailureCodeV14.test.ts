import { describe, expect, it } from 'vitest';
import { classifyCodingSessionFailureV14 } from './codingSessionFailureCodeV14.js';

describe('V1.4 coding session failure classification', () => {
  it('preserves reviewed coding-stage failure codes', () => {
    expect(classifyCodingSessionFailureV14(new Error('CODING_MODEL_RESPONSE_INVALID'))).toBe('CODING_MODEL_RESPONSE_INVALID');
    expect(classifyCodingSessionFailureV14(new Error('CODING_NAVIGATION_NO_EVIDENCE'))).toBe('CODING_NAVIGATION_NO_EVIDENCE');
  });

  it('translates provider and zero-cost planning failures into durable CODING codes', () => {
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('safe provider message'), { code: 'PROVIDER_TIMEOUT' }))).toBe('CODING_PROVIDER_TIMEOUT');
    expect(classifyCodingSessionFailureV14(new Error('FREE_MODEL_EVIDENCE_STALE'))).toBe('CODING_FREE_MODEL_EVIDENCE_STALE');
  });

  it('never surfaces arbitrary error messages or unreviewed code-shaped values', () => {
    expect(classifyCodingSessionFailureV14(new Error('private-value'))).toBe('CODING_OPERATION_BLOCKED');
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('private-value'), { code: 'CODING_PRIVATE_VALUE' }))).toBe('CODING_OPERATION_BLOCKED');
  });
});
