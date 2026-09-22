import {
  parseHeldOutFinalPrivateCorpusGzipBase64V14,
  prepareHeldOutFinalPrivateCorpusV14,
  type HeldOutFinalPrivateCorpusV14,
  type HeldOutFinalPreparedCorpusV14,
} from '../agent/heldOutCodingFinalPrivateCorpusV14.js';

export const HELD_OUT_CANDIDATE_BINDING_VERSION_V15 = 'origin-held-out-candidate-binding-v1' as const;

export type HeldOutCandidateBindingV15 = {
  version: typeof HELD_OUT_CANDIDATE_BINDING_VERSION_V15;
  candidateSha: string;
  /** Stable identity of the sealed source corpus before candidate rebinding. */
  sourceCorpusDigest: string;
  /** Candidate-bound public corpus digest. It changes when candidateSha changes. */
  candidateCorpusDigest: string;
  /** Stable one-shot marker. Reusing the same sealed source on another candidate is forbidden. */
  oneShotMarkerName: string;
  taskIds: string[];
  taskCount: number;
  rebound: HeldOutFinalPreparedCorpusV14;
};

function assertCandidateSha(candidateSha: string): void {
  if (!/^[a-f0-9]{40}$/i.test(candidateSha)) {
    throw new Error('HELD_OUT_CANDIDATE_SHA_INVALID');
  }
}

export function bindHeldOutFinalPrivateCorpusToCandidateV15(
  source: HeldOutFinalPrivateCorpusV14,
  candidateSha: string,
): HeldOutCandidateBindingV15 {
  assertCandidateSha(candidateSha);

  // Qualify the original sealed corpus first. This preserves all V14 unseen/
  // prior-observation protections before changing any base SHA.
  const sourcePrepared = prepareHeldOutFinalPrivateCorpusV14(source);
  const sourceCorpusDigest = sourcePrepared.publicCorpus.corpusDigest;

  const reboundSource: HeldOutFinalPrivateCorpusV14 = {
    ...sourcePrepared.privateCorpus,
    tasks: sourcePrepared.privateCorpus.tasks.map(row => ({
      ...row,
      packet: {
        ...row.packet,
        baseSha: candidateSha.toLowerCase(),
      },
    })),
  };

  // Qualify again after rebinding so every task has a uniform exact candidate
  // base and all public scoring contracts remain valid.
  const rebound = prepareHeldOutFinalPrivateCorpusV14(reboundSource);
  if (rebound.publicCorpus.frozenBaseSha !== candidateSha.toLowerCase()) {
    throw new Error('HELD_OUT_CANDIDATE_REBIND_FAILED');
  }

  return Object.freeze({
    version: HELD_OUT_CANDIDATE_BINDING_VERSION_V15,
    candidateSha: candidateSha.toLowerCase(),
    sourceCorpusDigest,
    candidateCorpusDigest: rebound.publicCorpus.corpusDigest,
    oneShotMarkerName: `origin-held-out-final-source-${sourceCorpusDigest}`,
    taskIds: Object.freeze(rebound.publicCorpus.tasks.map(task => task.id)) as unknown as string[],
    taskCount: rebound.publicCorpus.tasks.length,
    rebound,
  });
}

export function parseAndBindHeldOutFinalPrivateCorpusGzipBase64V15(
  encoded: string,
  candidateSha: string,
): HeldOutCandidateBindingV15 {
  const source = parseHeldOutFinalPrivateCorpusGzipBase64V14(encoded);
  return bindHeldOutFinalPrivateCorpusToCandidateV15(source.privateCorpus, candidateSha);
}

export function publicHeldOutCandidateBindingV15(binding: HeldOutCandidateBindingV15) {
  return Object.freeze({
    schemaVersion: HELD_OUT_CANDIDATE_BINDING_VERSION_V15,
    candidateSha: binding.candidateSha,
    sourceCorpusDigest: binding.sourceCorpusDigest,
    candidateCorpusDigest: binding.candidateCorpusDigest,
    oneShotMarkerName: binding.oneShotMarkerName,
    taskIds: [...binding.taskIds],
    taskCount: binding.taskCount,
  });
}
