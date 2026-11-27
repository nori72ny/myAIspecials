/**
 * Independent AQ V2 must not spend its one-shot sealed corpus on a candidate
 * built against an obsolete main. Validate the authenticated GitHub compare
 * response BEFORE accessing a private corpus or issuing provider calls.
 *
 * This routine does not authorize release or independently authenticate the
 * supplied API data; only the protected-main trusted runner may supply it.
 */
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);

export type OriginTrustedAnswerCandidateTopologyInputV2 = Readonly<{
  trustedEvaluatorSha: string;
  currentMain: unknown;
  candidateSha: string;
  prNumber: string;
  comparison: unknown;
}>;

export function assertOriginTrustedAnswerCandidateTopologyV2(
  input: OriginTrustedAnswerCandidateTopologyInputV2,
): void {
  if (!input || !sha(input.trustedEvaluatorSha) || !sha(input.candidateSha)
    || !/^(?:0|[1-9][0-9]{0,6})$/.test(input.prNumber)) {
    throw new Error("AQ_V2_CANDIDATE_TOPOLOGY_INPUT_INVALID");
  }
  const main = record(input.currentMain);
  const mainSha = record(main?.commit)?.sha;
  if (!sha(mainSha) || mainSha !== input.trustedEvaluatorSha) {
    throw new Error("AQ_V2_TRUSTED_MAIN_MOVED");
  }
  const result = record(input.comparison);
  const base = record(result?.base_commit)?.sha;
  const mergeBase = record(result?.merge_base_commit)?.sha;
  const behind = result?.behind_by;
  const ahead = result?.ahead_by;
  if (!sha(base) || !sha(mergeBase)
    || base !== input.trustedEvaluatorSha || mergeBase !== input.trustedEvaluatorSha
    || !Number.isSafeInteger(behind) || behind !== 0
    || !Number.isSafeInteger(ahead) || (ahead as number) < 0) {
    throw new Error("AQ_V2_CANDIDATE_OUTDATED_MAIN");
  }
  if (input.prNumber === "0") {
    if (input.candidateSha !== input.trustedEvaluatorSha
      || result?.status !== "identical" || ahead !== 0) {
      throw new Error("AQ_V2_CANDIDATE_OUTDATED_MAIN");
    }
    return;
  }
  if (input.candidateSha === input.trustedEvaluatorSha
    || result?.status !== "ahead" || (ahead as number) < 1) {
    throw new Error("AQ_V2_CANDIDATE_OUTDATED_MAIN");
  }
}
