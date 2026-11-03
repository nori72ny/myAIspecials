import { describe, expect, it } from 'vitest';
import { hasExplicitZeroCostMetadata } from './explicitZeroCostMetadataV1';

describe('hasExplicitZeroCostMetadata', () => {
  it('accepts only an explicit finite numeric zero', () => {
    expect(hasExplicitZeroCostMetadata({ costUsd: 0 })).toBe(true);
    expect(hasExplicitZeroCostMetadata({ costUsd: 0.0 })).toBe(true);
  });

  it.each([
    ['missing', {}],
    ['undefined', { costUsd: undefined }],
    ['null', { costUsd: null }],
    ['numeric string', { costUsd: '0' }],
    ['non-zero', { costUsd: 0.0001 }],
    ['negative', { costUsd: -1 }],
    ['NaN', { costUsd: Number.NaN }],
    ['infinity', { costUsd: Number.POSITIVE_INFINITY }],
    ['null body', null],
    ['array body', []],
    ['primitive body', 0],
  ])('rejects %s as unverified', (_label, body) => {
    expect(hasExplicitZeroCostMetadata(body)).toBe(false);
  });
});
