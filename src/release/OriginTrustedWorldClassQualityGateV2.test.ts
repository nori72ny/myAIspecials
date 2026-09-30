// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  ORIGIN_TRUSTED_WORLD_CLASS_GATE_SCHEMA_V2,
  evaluateOriginTrustedWorldClassQualityGateV2,
  type OriginTrustedWorldClassQualityInputV2,
} from './OriginTrustedWorldClassQualityGateV2.js';

const SHA = 'a'.repeat(40);

function malformedRawInput(): OriginTrustedWorldClassQualityInputV2 {
  return {
    schema: ORIGIN_TRUSTED_WORLD_CLASS_GATE_SCHEMA_V2,
    candidateSha: SHA,
    answer: {
      cases: undefined,
      expected: { candidateSha: SHA },
      scoreBundle: {},
      blindBundle: {},
      visualEvidence: {},
      bindingSet: {},
      liveProviderRunCompleted: false,
      zeroCost: true,
    },
    coding: { candidateSha: SHA },
    agent: { candidateSha: SHA },
    image: { candidateSha: SHA },
    artifact: { candidateSha: SHA },
  } as unknown as OriginTrustedWorldClassQualityInputV2;
}

describe('trusted cross-domain world-class gate v2', () => {
  it('rejects the old aggregate-only packet shape', () => {
    const legacy = {
      schema: 'origin.world-class-quality-gate.v1',
      candidateSha: SHA,
      domains: {
        answer: { wins: 48, losses: 0 },
        coding: { solved: 12 },
        agent: { solved: 12 },
        image: { wins: 24, losses: 0 },
        artifact: { wins: 16, losses: 0 },
      },
    } as unknown as OriginTrustedWorldClassQualityInputV2;

    const report = evaluateOriginTrustedWorldClassQualityGateV2(legacy);
    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('TRUSTED_WORLD_CLASS_INPUT_INVALID');
    expect(Object.values(report.domainPassed).every(value => value === false)).toBe(true);
  });

  it('fails closed instead of throwing on malformed raw domain evidence', () => {
    expect(() => evaluateOriginTrustedWorldClassQualityGateV2(malformedRawInput())).not.toThrow();
    const report = evaluateOriginTrustedWorldClassQualityGateV2(malformedRawInput());
    expect(report.passed).toBe(false);
    expect(report.blockers.some(code => code.startsWith('answer:'))).toBe(true);
    expect(report.blockers.some(code => code.startsWith('coding:'))).toBe(true);
    expect(report.blockers.some(code => code.startsWith('agent:'))).toBe(true);
    expect(report.blockers.some(code => code.startsWith('image:'))).toBe(true);
    expect(report.blockers.some(code => code.startsWith('artifact:'))).toBe(true);
  });

  it('rejects a cross-domain candidate SHA mismatch before accepting that domain', () => {
    const value = malformedRawInput();
    const report = evaluateOriginTrustedWorldClassQualityGateV2({
      ...value,
      coding: { ...value.coding, candidateSha: 'b'.repeat(40) },
      agent: { ...value.agent, candidateSha: 'c'.repeat(40) },
      image: { ...value.image, candidateSha: 'd'.repeat(40) },
      artifact: { ...value.artifact, candidateSha: 'e'.repeat(40) },
    });

    expect(report.domainPassed.coding).toBe(false);
    expect(report.domainPassed.agent).toBe(false);
    expect(report.domainPassed.image).toBe(false);
    expect(report.domainPassed.artifact).toBe(false);
    expect(report.blockers).toContain('coding:CANDIDATE_SHA_MISMATCH');
    expect(report.blockers).toContain('agent:CANDIDATE_SHA_MISMATCH');
    expect(report.blockers).toContain('image:CANDIDATE_SHA_MISMATCH');
    expect(report.blockers).toContain('artifact:CANDIDATE_SHA_MISMATCH');
  });

  it('binds the final packet and every domain packet to SHA-256 digests', () => {
    const report = evaluateOriginTrustedWorldClassQualityGateV2(malformedRawInput());
    expect(report.packetDigest).toMatch(/^[a-f0-9]{64}$/);
    for (const digest of Object.values(report.domainEvidenceDigests)) {
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
