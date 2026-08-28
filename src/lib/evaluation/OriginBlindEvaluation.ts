export type BlindCandidate = {
  id: string;
  response: string;
};

export type BlindEvaluationDimension =
  | 'correctness'
  | 'relevance'
  | 'completeness'
  | 'actionability'
  | 'clarity';

export type BlindScore = Record<BlindEvaluationDimension, number>;

export type BlindEvaluation = {
  blindedCandidates: Array<{ label: string; response: string }>;
  scores: Record<string, BlindScore>;
  ranking: string[];
};

const DIMENSIONS: BlindEvaluationDimension[] = [
  'correctness',
  'relevance',
  'completeness',
  'actionability',
  'clarity',
];

const clampScore = (value: number) => Math.max(1, Math.min(5, Math.round(value)));

/**
 * Creates an evaluator-neutral blind presentation. Candidate identity is kept
 * outside the labels shown to a reviewer so product/model names cannot bias a
 * manual comparison. Scoring remains an explicit reviewer input; this module
 * never fabricates quality scores from response text.
 */
export function createBlindEvaluation(candidates: readonly BlindCandidate[], seed = 0): BlindEvaluation {
  const unique = candidates.filter((candidate, index, all) =>
    candidate.id.trim().length > 0
      && candidate.response.trim().length > 0
      && all.findIndex((item) => item.id === candidate.id) === index,
  );
  const offset = unique.length ? Math.abs(Math.floor(seed)) % unique.length : 0;
  const rotated = unique.map((_, index) => unique[(index + offset) % unique.length]);
  const blindedCandidates = rotated.map((candidate, index) => ({ label: `Candidate ${String.fromCharCode(65 + index)}`, response: candidate.response }));
  const scores: Record<string, BlindScore> = {};
  unique.forEach((candidate) => {
    scores[candidate.id] = {
      correctness: 0,
      relevance: 0,
      completeness: 0,
      actionability: 0,
      clarity: 0,
    };
  });
  return { blindedCandidates, scores, ranking: [] };
}

export function scoreBlindCandidate(
  evaluation: BlindEvaluation,
  candidateId: string,
  score: Partial<BlindScore>,
): BlindEvaluation {
  if (!(candidateId in evaluation.scores)) return evaluation;
  const nextScore = { ...evaluation.scores[candidateId] };
  DIMENSIONS.forEach((dimension) => {
    const value = score[dimension];
    if (typeof value === 'number' && Number.isFinite(value)) nextScore[dimension] = clampScore(value);
  });
  const scores = { ...evaluation.scores, [candidateId]: nextScore };
  const ranking = Object.entries(scores)
    .filter(([, candidateScore]) => DIMENSIONS.every((dimension) => candidateScore[dimension] > 0))
    .sort(([, a], [, b]) => average(b) - average(a))
    .map(([id]) => id);
  return { ...evaluation, scores, ranking };
}

export function average(score: BlindScore): number {
  const total = DIMENSIONS.reduce((sum, dimension) => sum + score[dimension], 0);
  return total / DIMENSIONS.length;
}
