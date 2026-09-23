// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  HELD_OUT_FINAL_PRIVATE_CORPUS_VERSION_V14,
  type HeldOutFinalPrivateCorpusV14,
} from '../agent/heldOutCodingFinalPrivateCorpusV14.js';
import { HELD_OUT_FINAL_QUALIFICATION_VERSION_V14 } from '../agent/heldOutCodingFinalQualificationV14.js';
import {
  HELD_OUT_PRIVATE_TASK_PACKET_VERSION,
  type HeldOutPrivateTaskPacketV14,
} from '../agent/heldOutCodingTrustedRunnerV14.js';
import {
  bindHeldOutFinalPrivateCorpusToCandidateV15,
  parseAndBindHeldOutFinalPrivateCorpusGzipBase64V15,
  publicHeldOutCandidateBindingV15,
} from './OriginHeldOutCandidateBindingV15.js';

const sourceBase = 'a'.repeat(40);

function packet(index: number, recoveryRequired = false): HeldOutPrivateTaskPacketV14 {
  return {
    version: HELD_OUT_PRIVATE_TASK_PACKET_VERSION,
    id: `candidate-bound-${index}`,
    baseSha: sourceBase,
    timeBudgetMs: 900_000,
    requiredChangedPaths: [`src/example-${index}.ts`, `src/example-${index}-helper.ts`],
    protectedPaths: [`tests/__origin_heldout__/candidate-bound-${index}.test.ts`],
    recoveryRequired,
    goal: `Implement sealed candidate-bound task ${index}.`,
    hiddenTests: [{
      path: `tests/__origin_heldout__/candidate-bound-${index}.test.ts`,
      content: `import { expect, it } from 'vitest'; it('sealed ${index}', () => expect(true).toBe(true));`,
    }],
  };
}

function corpus(): HeldOutFinalPrivateCorpusV14 {
  return {
    version: HELD_OUT_FINAL_PRIVATE_CORPUS_VERSION_V14,
    qualification: HELD_OUT_FINAL_QUALIFICATION_VERSION_V14,
    corpusId: 'candidate-bound-synthetic',
    tasks: [
      { coverage: ['navigationMultiFile'], packet: packet(1, true) },
      { coverage: ['featureWithNewFile'], packet: packet(2, true) },
      { coverage: ['regressionRecovery'], packet: packet(3) },
      { coverage: ['buildOrTypecheckRepair'], packet: packet(4) },
      { coverage: ['securityPathBoundary'], packet: packet(5) },
      { coverage: ['navigationMultiFile', 'regressionRecovery'], packet: packet(6) },
    ],
  };
}

describe('trusted exact-candidate held-out binding', () => {
  it('rebinds every private task to one exact candidate without mutating the source corpus', () => {
    const source = corpus();
    const before = JSON.stringify(source);
    const candidate = 'b'.repeat(40);
    const binding = bindHeldOutFinalPrivateCorpusToCandidateV15(source, candidate);

    expect(JSON.stringify(source)).toBe(before);
    expect(binding.candidateSha).toBe(candidate);
    expect(binding.rebound.publicCorpus.frozenBaseSha).toBe(candidate);
    expect(binding.rebound.privateCorpus.tasks.every(row => row.packet.baseSha === candidate)).toBe(true);
    expect(binding.taskCount).toBe(6);
  });

  it('keeps one stable source identity across candidate SHAs while candidate digests change', () => {
    const source = corpus();
    const first = bindHeldOutFinalPrivateCorpusToCandidateV15(source, 'b'.repeat(40));
    const second = bindHeldOutFinalPrivateCorpusToCandidateV15(source, 'c'.repeat(40));

    expect(first.sourceCorpusDigest).toBe(second.sourceCorpusDigest);
    expect(first.oneShotMarkerName).toBe(second.oneShotMarkerName);
    expect(first.candidateCorpusDigest).not.toBe(second.candidateCorpusDigest);
  });

  it('never emits private prompts or hidden tests in the public binding projection', () => {
    const binding = bindHeldOutFinalPrivateCorpusToCandidateV15(corpus(), 'b'.repeat(40));
    const serialized = JSON.stringify(publicHeldOutCandidateBindingV15(binding));

    expect(serialized).not.toContain('Implement sealed candidate-bound task');
    expect(serialized).not.toContain('hiddenTests');
    expect(serialized).not.toContain('test.ts');
  });

  it('parses a sealed gzip corpus and binds it without exposing the source payload', () => {
    const encoded = gzipSync(Buffer.from(JSON.stringify(corpus()))).toString('base64');
    const binding = parseAndBindHeldOutFinalPrivateCorpusGzipBase64V15(encoded, 'd'.repeat(40));
    expect(binding.candidateSha).toBe('d'.repeat(40));
    expect(binding.taskIds).toHaveLength(6);
  });

  it('fails closed on malformed candidate SHA', () => {
    expect(() => bindHeldOutFinalPrivateCorpusToCandidateV15(corpus(), 'main')).toThrow('HELD_OUT_CANDIDATE_SHA_INVALID');
  });
});
