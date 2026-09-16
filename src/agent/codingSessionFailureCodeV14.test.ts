import { describe, expect, it } from 'vitest';
import { classifyCodingSessionFailureV14 } from './codingSessionFailureCodeV14.js';

describe('V1.4 coding session failure classification', () => {
  it('preserves reviewed coding-stage failure codes', () => {
    expect(classifyCodingSessionFailureV14(new Error('CODING_MODEL_RESPONSE_INVALID'))).toBe('CODING_MODEL_RESPONSE_INVALID');
    expect(classifyCodingSessionFailureV14(new Error('CODING_MODEL_CREATE_SCOPE_INVALID'))).toBe('CODING_MODEL_CREATE_SCOPE_INVALID');
    expect(classifyCodingSessionFailureV14(new Error('CODING_NAVIGATION_NO_EVIDENCE'))).toBe('CODING_NAVIGATION_NO_EVIDENCE');
  });

  it('preserves only reviewed schema-stage diagnostics', () => {
    expect(classifyCodingSessionFailureV14(new Error('CODING_MODEL_SCHEMA_INVALID:edit-item-keys'))).toBe('CODING_MODEL_SCHEMA_INVALID:edit-item-keys');
    expect(classifyCodingSessionFailureV14(new Error('CODING_MODEL_SCHEMA_INVALID:top-level'))).toBe('CODING_MODEL_SCHEMA_INVALID:top-level');
    expect(classifyCodingSessionFailureV14(new Error('CODING_MODEL_SCHEMA_INVALID:private-value'))).toBe('CODING_OPERATION_BLOCKED');
  });

  it('translates provider and zero-cost planning failures into durable CODING codes', () => {
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('safe provider message'), { code: 'PROVIDER_TIMEOUT' }))).toBe('CODING_PROVIDER_TIMEOUT');
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('safe provider message'), { code: 'PROVIDER_REQUIRED_TOOL_MISSING' }))).toBe('CODING_PROVIDER_REQUIRED_TOOL_MISSING');
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('safe provider message'), { code: 'PROVIDER_REQUIRED_TOOL_AMBIGUOUS' }))).toBe('CODING_PROVIDER_REQUIRED_TOOL_AMBIGUOUS');
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('safe provider message'), { code: 'PROVIDER_REQUIRED_TOOL_INVALID' }))).toBe('CODING_PROVIDER_REQUIRED_TOOL_INVALID');
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('safe provider message'), { code: 'PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID' }))).toBe('CODING_PROVIDER_REQUIRED_TOOL_ARGUMENTS_INVALID');
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('safe provider message'), { code: 'PROVIDER_REQUIRED_TOOL_TRUNCATED' }))).toBe('CODING_PROVIDER_REQUIRED_TOOL_TRUNCATED');
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('safe provider message'), { code: 'PROVIDER_BUDGET_EXHAUSTED' }))).toBe('CODING_PROVIDER_BUDGET_EXHAUSTED');
    expect(classifyCodingSessionFailureV14(new Error('FREE_MODEL_EVIDENCE_STALE'))).toBe('CODING_FREE_MODEL_EVIDENCE_STALE');
  });

  it('never surfaces arbitrary error messages or unreviewed code-shaped values', () => {
    expect(classifyCodingSessionFailureV14(new Error('CODING_MODEL_SCHEMA_INVALID:private-value'))).toBe('CODING_OPERATION_BLOCKED');
    expect(classifyCodingSessionFailureV14(new Error('CODING_MODEL_SCHEMA_INVALID:edit-item-keys:private-value'))).toBe('CODING_OPERATION_BLOCKED');
    expect(classifyCodingSessionFailureV14(new Error('private-value'))).toBe('CODING_OPERATION_BLOCKED');
    expect(classifyCodingSessionFailureV14(Object.assign(new Error('private-value'), { code: 'CODING_PRIVATE_VALUE' }))).toBe('CODING_OPERATION_BLOCKED');
  });
});
