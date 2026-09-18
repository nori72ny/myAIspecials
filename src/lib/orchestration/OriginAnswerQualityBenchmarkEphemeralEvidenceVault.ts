export interface OriginAnswerQualityBenchmarkEphemeralEvidence {
  readonly caseId: string;
  readonly finalAnswerRef: string;
  readonly evidenceLedgerRef: string;
  readonly answerText: string;
  readonly evidenceJson: unknown;
}

export interface OriginAnswerQualityBenchmarkEphemeralEvidenceVault {
  readonly size: () => number;
  readonly put: (evidence: OriginAnswerQualityBenchmarkEphemeralEvidence) => void;
  readonly consume: (
    caseId: string,
    finalAnswerRef: string,
    evidenceLedgerRef: string,
  ) => OriginAnswerQualityBenchmarkEphemeralEvidence | null;
  readonly clear: () => void;
}

const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAX_CASES = 40;
const MAX_ANSWER_CHARS = 50_000;
const MAX_EVIDENCE_JSON_CHARS = 200_000;

function cloneJson(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length > MAX_EVIDENCE_JSON_CHARS) {
    throw new Error("AQ_BENCHMARK_EPHEMERAL_EVIDENCE_INVALID");
  }
  return JSON.parse(serialized) as unknown;
}

function validate(
  evidence: OriginAnswerQualityBenchmarkEphemeralEvidence,
): OriginAnswerQualityBenchmarkEphemeralEvidence {
  const answerText = evidence.answerText.trim();
  if (
    !CASE_ID.test(evidence.caseId)
    || !SHA256.test(evidence.finalAnswerRef)
    || !SHA256.test(evidence.evidenceLedgerRef)
    || answerText.length === 0
    || answerText.length > MAX_ANSWER_CHARS
  ) {
    throw new Error("AQ_BENCHMARK_EPHEMERAL_EVIDENCE_INVALID");
  }

  return Object.freeze({
    caseId: evidence.caseId,
    finalAnswerRef: evidence.finalAnswerRef,
    evidenceLedgerRef: evidence.evidenceLedgerRef,
    answerText,
    evidenceJson: cloneJson(evidence.evidenceJson),
  });
}

export function createOriginAnswerQualityBenchmarkEphemeralEvidenceVault():
OriginAnswerQualityBenchmarkEphemeralEvidenceVault {
  const values = new Map<string, OriginAnswerQualityBenchmarkEphemeralEvidence>();

  return Object.freeze({
    size: () => values.size,

    put: (input) => {
      const evidence = validate(input);
      if (values.has(evidence.caseId)) {
        throw new Error("AQ_BENCHMARK_EPHEMERAL_EVIDENCE_DUPLICATE_CASE");
      }
      if (values.size >= MAX_CASES) {
        throw new Error("AQ_BENCHMARK_EPHEMERAL_EVIDENCE_LIMIT");
      }
      values.set(evidence.caseId, evidence);
    },

    consume: (caseId, finalAnswerRef, evidenceLedgerRef) => {
      const evidence = values.get(caseId);
      if (!evidence) return null;
      if (
        evidence.finalAnswerRef !== finalAnswerRef
        || evidence.evidenceLedgerRef !== evidenceLedgerRef
      ) {
        return null;
      }

      values.delete(caseId);
      return Object.freeze({
        ...evidence,
        evidenceJson: cloneJson(evidence.evidenceJson),
      });
    },

    clear: () => {
      values.clear();
    },
  });
}
