export type EvaluationAxis =
  | 'instruction-adherence'
  | 'relevance'
  | 'clarity'
  | 'safety-privacy'
  | 'japanese-quality'
  | 'structured-output';

export interface AnswerQualityFixture {
  id: string;
  version: 1;
  title: string;
  prompt: string;
  expectedTerms?: string[];
  forbiddenTerms?: string[];
  requiredSections?: string[];
  maxCharacters?: number;
  minimumScore: number;
  axes: EvaluationAxis[];
}

export interface AxisResult {
  axis: EvaluationAxis;
  passed: boolean;
  score: number;
  reasons: string[];
}

export interface AnswerQualityResult {
  fixtureId: string;
  passed: boolean;
  score: number;
  minimumScore: number;
  axisResults: AxisResult[];
  failures: string[];
}

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('ja-JP');

function includesAll(answer: string, terms: string[]): string[] {
  const normalizedAnswer = normalize(answer);
  return terms.filter((term) => !normalizedAnswer.includes(normalize(term)));
}

function includesAny(answer: string, terms: string[]): string[] {
  const normalizedAnswer = normalize(answer);
  return terms.filter((term) => normalizedAnswer.includes(normalize(term)));
}

function scoreAxis(
  axis: EvaluationAxis,
  fixture: AnswerQualityFixture,
  answer: string,
): AxisResult {
  const reasons: string[] = [];

  if (axis === 'instruction-adherence' || axis === 'relevance') {
    const missing = includesAll(answer, fixture.expectedTerms ?? []);
    if (missing.length > 0) reasons.push(`不足語句: ${missing.join(', ')}`);
  }

  if (axis === 'safety-privacy') {
    const forbidden = includesAny(answer, fixture.forbiddenTerms ?? []);
    if (forbidden.length > 0) reasons.push(`禁止語句を含む: ${forbidden.join(', ')}`);
  }

  if (axis === 'structured-output') {
    const missingSections = includesAll(answer, fixture.requiredSections ?? []);
    if (missingSections.length > 0) reasons.push(`不足セクション: ${missingSections.join(', ')}`);
  }

  if (axis === 'clarity' && fixture.maxCharacters && answer.length > fixture.maxCharacters) {
    reasons.push(`文字数超過: ${answer.length}/${fixture.maxCharacters}`);
  }

  if (axis === 'japanese-quality') {
    const japaneseCharacters = answer.match(/[ぁ-んァ-ヶ一-龠]/g)?.length ?? 0;
    const ratio = answer.length === 0 ? 0 : japaneseCharacters / answer.length;
    if (ratio < 0.2) reasons.push('日本語文字の比率が低すぎます');
  }

  return {
    axis,
    passed: reasons.length === 0,
    score: reasons.length === 0 ? 100 : 0,
    reasons,
  };
}

export function evaluateAnswerQuality(
  fixture: AnswerQualityFixture,
  answer: string,
): AnswerQualityResult {
  const axisResults = fixture.axes.map((axis) => scoreAxis(axis, fixture, answer));
  const score = Math.round(
    axisResults.reduce((total, result) => total + result.score, 0) / Math.max(axisResults.length, 1),
  );
  const failures = axisResults.flatMap((result) =>
    result.reasons.map((reason) => `${result.axis}: ${reason}`),
  );

  return {
    fixtureId: fixture.id,
    passed: score >= fixture.minimumScore && failures.length === 0,
    score,
    minimumScore: fixture.minimumScore,
    axisResults,
    failures,
  };
}

export function assertQualityThreshold(results: AnswerQualityResult[]): void {
  const failed = results.filter((result) => !result.passed);
  if (failed.length === 0) return;

  const details = failed
    .map((result) => `${result.fixtureId}: ${result.score}/${result.minimumScore} - ${result.failures.join('; ')}`)
    .join('\n');
  throw new Error(`回答品質の回帰を検出しました。\n${details}`);
}
