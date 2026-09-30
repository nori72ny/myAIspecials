import { createHash } from 'node:crypto';

import {
  aggregateOriginTrustedAnswerRunV2,
  type OriginTrustedAnswerCaseEvidenceV2,
} from './OriginTrustedAnswerRunV2.js';
import {
  qualifyOriginTrustedAnswerQualityV2,
  type OriginTrustedAnswerScoreBundleV2,
} from './OriginTrustedAnswerQualityV2.js';
import {
  qualifyOriginTrustedBlindPreferenceV2,
  type OriginTrustedBlindPreferenceBundleV2,
} from './OriginTrustedBlindPreferenceV2.js';
import {
  qualifyOriginAnswerVisualEvidenceV2,
  type OriginAnswerVisualEvidenceV2,
} from './OriginAnswerVisualEvidenceV2.js';
import {
  qualifyOriginAnswerEvaluationBindingsV2,
  type OriginAnswerEvaluationBindingSetV2,
} from './OriginAnswerEvaluationBindingV2.js';
import {
  evaluateOriginAnswerWorldClassGateV2,
  type OriginAnswerWorldClassGateReportV2,
} from './OriginAnswerWorldClassGateV2.js';
import {
  evaluateOriginImageBlindBenchmarkV15,
  type OriginImageBlindBenchmarkInputV15,
  type OriginImageBlindBenchmarkReportV15,
} from './OriginImageBlindBenchmarkV15.js';
import {
  evaluateOriginArtifactBlindBenchmarkV1,
  type OriginArtifactBlindBenchmarkInputV1,
  type OriginArtifactBlindBenchmarkReportV1,
} from './OriginArtifactBlindBenchmarkV1.js';
import {
  evaluateHeldOutCodingTrustedComparisonV14,
  type HeldOutCodingTrustedComparisonInputV14,
  type HeldOutCodingTrustedComparisonReportV14,
} from '../agent/heldOutCodingTrustedComparisonV14.js';
import {
  evaluateGeneralAgentTrustedComparisonV2,
  type GeneralAgentTrustedComparisonInputV2,
  type GeneralAgentTrustedComparisonReportV2,
} from '../agent/trustedGeneralAgentComparisonV2.js';

export const ORIGIN_TRUSTED_WORLD_CLASS_GATE_SCHEMA_V2 =
  'origin.trusted-world-class-quality-gate.v2' as const;

type TrustedAnswerRunExpectationV2 = Parameters<typeof aggregateOriginTrustedAnswerRunV2>[1];

export type OriginTrustedWorldClassAnswerInputV2 = {
  cases: readonly OriginTrustedAnswerCaseEvidenceV2[];
  expected: TrustedAnswerRunExpectationV2;
  scoreBundle: OriginTrustedAnswerScoreBundleV2;
  blindBundle: OriginTrustedBlindPreferenceBundleV2;
  visualEvidence: OriginAnswerVisualEvidenceV2;
  bindingSet: OriginAnswerEvaluationBindingSetV2;
  liveProviderRunCompleted: boolean;
  zeroCost: boolean;
};

export type OriginTrustedWorldClassQualityInputV2 = {
  schema: typeof ORIGIN_TRUSTED_WORLD_CLASS_GATE_SCHEMA_V2;
  candidateSha: string;
  answer: OriginTrustedWorldClassAnswerInputV2;
  coding: HeldOutCodingTrustedComparisonInputV14;
  agent: GeneralAgentTrustedComparisonInputV2;
  image: OriginImageBlindBenchmarkInputV15;
  artifact: OriginArtifactBlindBenchmarkInputV1;
};

export type OriginTrustedWorldClassDomain = 'answer' | 'coding' | 'agent' | 'image' | 'artifact';

export type OriginTrustedWorldClassQualityReportV2 = {
  schema: typeof ORIGIN_TRUSTED_WORLD_CLASS_GATE_SCHEMA_V2;
  candidateSha: string;
  packetDigest: string;
  domainEvidenceDigests: Record<OriginTrustedWorldClassDomain, string>;
  domainPassed: Record<OriginTrustedWorldClassDomain, boolean>;
  passed: boolean;
  blockers: readonly string[];
  reports: {
    answer: OriginAnswerWorldClassGateReportV2 | null;
    coding: HeldOutCodingTrustedComparisonReportV14 | null;
    agent: GeneralAgentTrustedComparisonReportV2 | null;
    image: OriginImageBlindBenchmarkReportV15 | null;
    artifact: OriginArtifactBlindBenchmarkReportV1 | null;
  };
};

const SHA40 = /^[a-f0-9]{40}$/;

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (error instanceof Error && /^[A-Z0-9_:-]{3,160}$/.test(error.message)) return error.message;
  return fallback;
}

export function evaluateOriginTrustedWorldClassQualityGateV2(
  input: OriginTrustedWorldClassQualityInputV2,
  nowMs: number = Date.now(),
): OriginTrustedWorldClassQualityReportV2 {
  const emptyPassed: Record<OriginTrustedWorldClassDomain, boolean> = {
    answer: false,
    coding: false,
    agent: false,
    image: false,
    artifact: false,
  };
  const emptyDigests: Record<OriginTrustedWorldClassDomain, string> = {
    answer: '',
    coding: '',
    agent: '',
    image: '',
    artifact: '',
  };
  const emptyReports: OriginTrustedWorldClassQualityReportV2['reports'] = {
    answer: null,
    coding: null,
    agent: null,
    image: null,
    artifact: null,
  };

  const candidateSha = typeof input?.candidateSha === 'string' ? input.candidateSha : '';
  if (
    input?.schema !== ORIGIN_TRUSTED_WORLD_CLASS_GATE_SCHEMA_V2
    || !SHA40.test(candidateSha)
    || !input.answer
    || !input.coding
    || !input.agent
    || !input.image
    || !input.artifact
  ) {
    return {
      schema: ORIGIN_TRUSTED_WORLD_CLASS_GATE_SCHEMA_V2,
      candidateSha,
      packetDigest: sha256Json(input ?? null),
      domainEvidenceDigests: emptyDigests,
      domainPassed: emptyPassed,
      passed: false,
      blockers: ['TRUSTED_WORLD_CLASS_INPUT_INVALID'],
      reports: emptyReports,
    };
  }

  const blockers: string[] = [];
  const domainPassed = { ...emptyPassed };
  const reports = { ...emptyReports };
  const domainEvidenceDigests: Record<OriginTrustedWorldClassDomain, string> = {
    answer: sha256Json(input.answer),
    coding: sha256Json(input.coding),
    agent: sha256Json(input.agent),
    image: sha256Json(input.image),
    artifact: sha256Json(input.artifact),
  };

  if (input.answer.expected?.candidateSha !== candidateSha) {
    blockers.push('answer:CANDIDATE_SHA_MISMATCH');
  } else {
    try {
      const run = aggregateOriginTrustedAnswerRunV2(input.answer.cases, input.answer.expected);
      const trustedQuality = qualifyOriginTrustedAnswerQualityV2(run, input.answer.scoreBundle, nowMs);
      const trustedBlind = qualifyOriginTrustedBlindPreferenceV2(run, input.answer.blindBundle, nowMs);
      const visual = qualifyOriginAnswerVisualEvidenceV2(input.answer.visualEvidence, candidateSha);
      const binding = qualifyOriginAnswerEvaluationBindingsV2(
        {
          candidateSha: run.binding.candidateSha,
          corpusDigest: run.binding.corpusDigest,
          evaluatorSha: run.binding.evaluatorSha,
          rubricDigest: run.binding.rubricDigest,
          roundId: run.binding.roundId,
        },
        input.answer.bindingSet,
      );

      const answerExperience = trustedQuality.aggregate
        ? {
            schemaVersion: 'origin.answer-experience-qualification.v2' as const,
            aggregate: trustedQuality.aggregate,
            absoluteQualityPassed: trustedQuality.absoluteQualityPassed,
            blockers: trustedQuality.blockers,
          }
        : null;

      const answerReport = evaluateOriginAnswerWorldClassGateV2({
        candidateSha,
        answerExperience,
        blindPreference: trustedBlind.blindReport,
        trustedAnswerQuality: trustedQuality,
        trustedBlindPreference: trustedBlind,
        visual,
        trustedExecution: run.qualification,
        binding,
        liveProviderRunCompleted: input.answer.liveProviderRunCompleted,
        zeroCost: input.answer.zeroCost,
      });
      reports.answer = answerReport;
      domainPassed.answer = answerReport.worldClassCandidate;
      blockers.push(...answerReport.blockers.map(code => `answer:${code}`));
    } catch (error) {
      blockers.push(`answer:${safeErrorCode(error, 'TRUSTED_EVALUATION_ERROR')}`);
    }
  }

  if (input.coding.candidateSha !== candidateSha) {
    blockers.push('coding:CANDIDATE_SHA_MISMATCH');
  } else {
    try {
      const report = evaluateHeldOutCodingTrustedComparisonV14(input.coding, nowMs);
      reports.coding = report;
      domainPassed.coding = report.passed;
      blockers.push(...report.blockers.map(code => `coding:${code}`));
    } catch (error) {
      blockers.push(`coding:${safeErrorCode(error, 'TRUSTED_EVALUATION_ERROR')}`);
    }
  }

  if (input.agent.candidateSha !== candidateSha) {
    blockers.push('agent:CANDIDATE_SHA_MISMATCH');
  } else {
    try {
      const report = evaluateGeneralAgentTrustedComparisonV2(input.agent, nowMs);
      reports.agent = report;
      domainPassed.agent = report.passed;
      blockers.push(...report.blockers.map(code => `agent:${code}`));
    } catch (error) {
      blockers.push(`agent:${safeErrorCode(error, 'TRUSTED_EVALUATION_ERROR')}`);
    }
  }

  if (input.image.candidateSha !== candidateSha) {
    blockers.push('image:CANDIDATE_SHA_MISMATCH');
  } else {
    try {
      const report = evaluateOriginImageBlindBenchmarkV15(input.image, nowMs);
      reports.image = report;
      domainPassed.image = report.passed;
      blockers.push(...report.blockers.map(code => `image:${code}`));
    } catch (error) {
      blockers.push(`image:${safeErrorCode(error, 'TRUSTED_EVALUATION_ERROR')}`);
    }
  }

  if (input.artifact.candidateSha !== candidateSha) {
    blockers.push('artifact:CANDIDATE_SHA_MISMATCH');
  } else {
    try {
      const report = evaluateOriginArtifactBlindBenchmarkV1(input.artifact, nowMs);
      reports.artifact = report;
      domainPassed.artifact = report.passed;
      blockers.push(...report.blockers.map(code => `artifact:${code}`));
    } catch (error) {
      blockers.push(`artifact:${safeErrorCode(error, 'TRUSTED_EVALUATION_ERROR')}`);
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    schema: ORIGIN_TRUSTED_WORLD_CLASS_GATE_SCHEMA_V2,
    candidateSha,
    packetDigest: sha256Json(input),
    domainEvidenceDigests,
    domainPassed,
    passed: Object.values(domainPassed).every(Boolean) && uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    reports,
  };
}
