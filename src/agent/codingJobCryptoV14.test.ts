// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CODING_JOB_CIPHERTEXT_PATTERN,
  CODING_JOB_ID_PATTERN,
  CODING_JOB_OWNER_HASH_PATTERN,
  createCodingJobEnvelopeV14,
  decryptCodingJobPayloadV14,
  encryptCodingJobPayloadV14,
  hashCodingJobOwnerV14,
} from './codingJobCryptoV14.js';

const env = {
  ORIGIN_CODING_JOB_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  ORIGIN_CODING_JOB_OWNER_HMAC_SECRET: Buffer.alloc(40, 11).toString('base64'),
};

describe('V1.4 coding job privacy envelope', () => {
  it('encrypts the private goal and binds it to an opaque job id', () => {
    const envelope = createCodingJobEnvelopeV14({ ownerBinding: 'user:42/session:abc', targetKey: 'github:nori72ny/myAIspecials', goal: 'Fix the status renderer' }, env, 1_700_000_000_000);
    expect(envelope.jobId).toMatch(CODING_JOB_ID_PATTERN);
    expect(envelope.ownerHash).toMatch(CODING_JOB_OWNER_HASH_PATTERN);
    expect(envelope.payloadCiphertext).toMatch(CODING_JOB_CIPHERTEXT_PATTERN);
    expect(envelope.payloadCiphertext).not.toContain('status renderer');
    expect(decryptCodingJobPayloadV14(envelope.jobId, envelope.payloadCiphertext, env)).toEqual({ goal: 'Fix the status renderer' });
  });

  it('prevents ciphertext swapping between job ids and rejects tampering', () => {
    const first = createCodingJobEnvelopeV14({ ownerBinding: 'owner-a', targetKey: 'github:repo/a', goal: 'Fix A' }, env);
    const second = createCodingJobEnvelopeV14({ ownerBinding: 'owner-a', targetKey: 'github:repo/a', goal: 'Fix B' }, env);
    expect(() => decryptCodingJobPayloadV14(second.jobId, first.payloadCiphertext, env)).toThrow('CODING_JOB_PAYLOAD_INVALID');
    const parts = first.payloadCiphertext.split('.');
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
    expect(() => decryptCodingJobPayloadV14(first.jobId, parts.join('.'), env)).toThrow('CODING_JOB_PAYLOAD_INVALID');
  });

  it('uses a keyed owner hash rather than persisting a raw owner binding', () => {
    const hash = hashCodingJobOwnerV14('private-user-binding', env);
    expect(hash).toMatch(CODING_JOB_OWNER_HASH_PATTERN);
    expect(hash).not.toContain('private-user-binding');
    expect(hashCodingJobOwnerV14('another-owner', env)).not.toBe(hash);
  });

  it('fails closed on weak keys, secret-like goals, or excessive retention', () => {
    expect(() => encryptCodingJobPayloadV14('coding-1234567890123456789012', { goal: 'Fix it' }, { ...env, ORIGIN_CODING_JOB_DATA_KEY: 'weak' })).toThrow('CODING_JOB_DATA_KEY_INVALID');
    expect(() => createCodingJobEnvelopeV14({ ownerBinding: 'owner', targetKey: 'github:repo/a', goal: 'api_key="private-value"' }, env)).toThrow('CODING_JOB_GOAL_BLOCKED');
    expect(() => createCodingJobEnvelopeV14({ ownerBinding: 'owner', targetKey: 'github:repo/a', goal: 'Fix it', ttlMs: 8 * 24 * 60 * 60 * 1000 }, env)).toThrow('CODING_JOB_TTL_INVALID');
  });
});
