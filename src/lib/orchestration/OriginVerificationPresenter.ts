import type { OriginAnswerVerificationStatus } from "./OriginAnswerEnvelope.js";
import type {
  OriginVerificationIssue,
  OriginVerificationResult,
} from "./OriginVerifier.js";

export interface OriginVerificationPresentation {
  readonly status: OriginAnswerVerificationStatus;
  readonly independentReviewPerformed: boolean;
  readonly summary: string;
  readonly limitations: readonly string[];
  readonly nextActions: readonly string[];
}

function uniqueIssueCodes(issues: readonly OriginVerificationIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.code))];
}

function issueLabel(code: string, language: "ja" | "en"): string {
  const ja: Record<string, string> = {
    MISSING_EVIDENCE: "根拠不足",
    INSUFFICIENT_EVIDENCE_STATE: "根拠の検証状態不足",
    STALE_EVIDENCE: "根拠の鮮度不足",
    EXECUTION_EVIDENCE_REQUIRED: "実行証拠不足",
    USER_EVIDENCE_REQUIRED: "ユーザー提供根拠不足",
    CONFLICTING_EVIDENCE: "根拠の矛盾",
    INDEPENDENT_REVIEW_REQUIRED: "独立レビュー未実施",
  };
  const en: Record<string, string> = {
    MISSING_EVIDENCE: "missing evidence",
    INSUFFICIENT_EVIDENCE_STATE: "insufficient evidence verification",
    STALE_EVIDENCE: "stale evidence",
    EXECUTION_EVIDENCE_REQUIRED: "execution evidence required",
    USER_EVIDENCE_REQUIRED: "user-provided evidence required",
    CONFLICTING_EVIDENCE: "conflicting evidence",
    INDEPENDENT_REVIEW_REQUIRED: "independent review required",
  };
  return (language === "ja" ? ja : en)[code] ?? code;
}

export function presentOriginVerification(
  result: OriginVerificationResult,
  options: {
    language: "ja" | "en";
    independentReviewRequired: boolean;
    independentReviewPerformed: boolean;
  },
): OriginVerificationPresentation {
  const { language, independentReviewRequired, independentReviewPerformed } = options;

  if (result.decision === "PASS") {
    if (independentReviewRequired) {
      if (!independentReviewPerformed) {
        return Object.freeze({
          status: "not-run",
          independentReviewPerformed: false,
          summary: language === "ja"
            ? "独立レビューが必要ですが、完了していないため確認済みとは表示しません。"
            : "Independent review is required but has not completed, so the answer is not shown as verified.",
          limitations: Object.freeze([
            language === "ja"
              ? "独立レビューが未完了です。"
              : "Independent review is incomplete.",
          ]),
          nextActions: Object.freeze([
            language === "ja"
              ? "条件を満たす独立レビューを実行してから再判定してください。"
              : "Run a qualifying independent review before re-evaluating the answer.",
          ]),
        });
      }

      return Object.freeze({
        status: "passed",
        independentReviewPerformed: true,
        summary: language === "ja"
          ? "必要な根拠確認と独立レビューを完了しました。"
          : "Required evidence checks and independent review completed.",
        limitations: Object.freeze([]),
        nextActions: Object.freeze([]),
      });
    }

    return Object.freeze({
      status: "not-required",
      independentReviewPerformed: false,
      summary: language === "ja"
        ? "必要な根拠確認を完了し、この依頼では独立レビューを必須としていません。"
        : "Required evidence checks completed; independent review is not required for this request.",
      limitations: Object.freeze([]),
      nextActions: Object.freeze([]),
    });
  }

  const labels = uniqueIssueCodes(result.issues)
    .map((code) => issueLabel(code, language))
    .slice(0, 6);
  const issueSummary = labels.join(language === "ja" ? "、" : ", ");

  if (result.decision === "BLOCKED_UNVERIFIED") {
    return Object.freeze({
      status: "not-run",
      independentReviewPerformed: false,
      summary: language === "ja"
        ? `確認条件を満たしていないため、確認済みとは表示しません（${issueSummary || "未確認"}）。`
        : `Verification requirements were not met, so the answer is not shown as verified (${issueSummary || "unverified"}).`,
      limitations: Object.freeze([
        language === "ja"
          ? "必須の検証条件が不足しているため、重要判断には使用しないでください。"
          : "Required verification conditions are missing; do not rely on this for consequential decisions.",
      ]),
      nextActions: Object.freeze([
        language === "ja"
          ? "不足している検証条件を満たしてから再判定してください。"
          : "Satisfy the missing verification requirements and re-run verification.",
      ]),
    });
  }

  return Object.freeze({
    status: "not-run",
    independentReviewPerformed: false,
    summary: language === "ja"
      ? `追加確認が必要です（${issueSummary || "根拠不足"}）。`
      : `Additional verification is required (${issueSummary || "insufficient evidence"}).`,
    limitations: Object.freeze([
      language === "ja"
        ? "一部の主張がまだ十分に検証されていません。"
        : "Some material claims are not yet sufficiently verified.",
    ]),
    nextActions: Object.freeze([
      language === "ja"
        ? "不足する根拠を取得・確認してから再検証してください。"
        : "Collect and verify the missing evidence, then run verification again.",
    ]),
  });
}
