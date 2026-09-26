import { createHash } from "node:crypto";

import type {
  OriginAnswerExperienceBlindJudgmentV2,
  OriginAnswerExperienceSurfaceV2,
} from "./OriginAnswerExperienceGateV2.js";

export interface OriginAnswerExperienceBlindPairV2 {
  readonly caseId: string;
  readonly surface: OriginAnswerExperienceSurfaceV2;
  readonly prompt: string;
  readonly candidateAnswer: string;
  readonly competitorId: string;
  readonly competitorAnswer: string;
}

export interface OriginAnswerExperienceBlindReviewItemV2 {
  readonly blindId: string;
  readonly caseId: string;
  readonly surface: OriginAnswerExperienceSurfaceV2;
  readonly prompt: string;
  readonly answerA: string;
  readonly answerB: string;
}

export interface OriginAnswerExperienceBlindAnswerKeyV2 {
  readonly blindId: string;
  readonly caseId: string;
  readonly surface: OriginAnswerExperienceSurfaceV2;
  readonly competitorId: string;
  readonly candidatePresentedAs: "A" | "B";
  readonly candidateDigest: string;
  readonly competitorDigest: string;
}

export interface OriginAnswerExperienceBlindPackV2 {
  readonly schemaVersion: "origin.answer-experience.blind-pack.v2";
  readonly judgeId: string;
  readonly reviewItems: readonly OriginAnswerExperienceBlindReviewItemV2[];
  readonly answerKey: readonly OriginAnswerExperienceBlindAnswerKeyV2[];
}

export interface OriginAnswerExperienceBlindRawJudgmentV2 {
  readonly blindId: string;
  readonly winner: "A" | "B" | "tie";
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function validText(value: string, max: number): boolean {
  return value.trim().length > 0 && value.length <= max;
}

function assertPair(item: OriginAnswerExperienceBlindPairV2): void {
  if (
    !SAFE_ID.test(item.caseId)
    || !SAFE_ID.test(item.competitorId)
    || !validText(item.prompt, 32_000)
    || !validText(item.candidateAnswer, 200_000)
    || !validText(item.competitorAnswer, 200_000)
  ) {
    throw new Error("ANSWER_EXPERIENCE_BLIND_PAIR_INVALID");
  }
  if (digest(item.candidateAnswer) === digest(item.competitorAnswer)) {
    throw new Error("ANSWER_EXPERIENCE_BLIND_IDENTICAL_ANSWERS");
  }
}

export function buildOriginAnswerExperienceBlindPackV2(input: {
  readonly judgeId: string;
  readonly seed: string;
  readonly pairs: readonly OriginAnswerExperienceBlindPairV2[];
}): OriginAnswerExperienceBlindPackV2 {
  if (!SAFE_ID.test(input.judgeId) || !validText(input.seed, 256) || input.pairs.length < 1) {
    throw new Error("ANSWER_EXPERIENCE_BLIND_PACK_INVALID");
  }
  input.pairs.forEach(assertPair);

  const unique = new Set(input.pairs.map((item) => `${item.caseId}\t${item.competitorId}`));
  if (unique.size !== input.pairs.length) {
    throw new Error("ANSWER_EXPERIENCE_BLIND_PAIR_DUPLICATE");
  }

  const ordered = input.pairs
    .map((item) => ({
      item,
      orderKey: digest(`${input.seed}\n${input.judgeId}\n${item.caseId}\n${item.competitorId}`),
    }))
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey));

  const reviewItems: OriginAnswerExperienceBlindReviewItemV2[] = [];
  const answerKey: OriginAnswerExperienceBlindAnswerKeyV2[] = [];

  ordered.forEach(({ item }, index) => {
    const candidatePresentedAs = index % 2 === 0 ? "A" : "B";
    const candidateDigest = digest(item.candidateAnswer);
    const competitorDigest = digest(item.competitorAnswer);
    const blindId = digest([
      input.judgeId,
      item.caseId,
      item.competitorId,
      candidateDigest,
      competitorDigest,
    ].join("\n")).slice("sha256:".length, "sha256:".length + 24);

    reviewItems.push(Object.freeze({
      blindId,
      caseId: item.caseId,
      surface: item.surface,
      prompt: item.prompt,
      answerA: candidatePresentedAs === "A" ? item.candidateAnswer : item.competitorAnswer,
      answerB: candidatePresentedAs === "B" ? item.candidateAnswer : item.competitorAnswer,
    }));
    answerKey.push(Object.freeze({
      blindId,
      caseId: item.caseId,
      surface: item.surface,
      competitorId: item.competitorId,
      candidatePresentedAs,
      candidateDigest,
      competitorDigest,
    }));
  });

  return Object.freeze({
    schemaVersion: "origin.answer-experience.blind-pack.v2",
    judgeId: input.judgeId,
    reviewItems: Object.freeze(reviewItems),
    answerKey: Object.freeze(answerKey),
  });
}

export function unblindOriginAnswerExperienceJudgmentsV2(input: {
  readonly pack: OriginAnswerExperienceBlindPackV2;
  readonly judgments: readonly OriginAnswerExperienceBlindRawJudgmentV2[];
}): readonly OriginAnswerExperienceBlindJudgmentV2[] {
  const byId = new Map(input.pack.answerKey.map((item) => [item.blindId, item] as const));
  if (input.judgments.length !== input.pack.answerKey.length) {
    throw new Error("ANSWER_EXPERIENCE_BLIND_JUDGMENT_COUNT_MISMATCH");
  }
  const seen = new Set<string>();

  return Object.freeze(input.judgments.map((judgment) => {
    const key = byId.get(judgment.blindId);
    if (!key || seen.has(judgment.blindId)) {
      throw new Error("ANSWER_EXPERIENCE_BLIND_JUDGMENT_INVALID");
    }
    seen.add(judgment.blindId);

    const winner = judgment.winner === "tie"
      ? "tie"
      : judgment.winner === key.candidatePresentedAs
        ? "candidate"
        : "competitor";

    return Object.freeze({
      caseId: key.caseId,
      surface: key.surface,
      judgeId: input.pack.judgeId,
      competitorId: key.competitorId,
      candidateDigest: key.candidateDigest,
      competitorDigest: key.competitorDigest,
      presentedCandidateAs: key.candidatePresentedAs,
      winner,
    });
  }));
}
