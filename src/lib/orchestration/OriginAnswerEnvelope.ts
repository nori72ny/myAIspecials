export type OriginAnswerVerificationStatus = "not-run" | "not-required" | "passed";

export interface OriginAnswerEvidenceItem {
  label: string;
  sourceUrl?: string;
  evidenceLevel: "provided" | "source-checked";
}

export interface OriginAnswerRichOutput {
  kind: "comparison" | "chart" | "illustration" | "document" | "presentation" | "spreadsheet";
  label: string;
  artifactId: string;
}

export interface OriginAnswerEnvelopeInput {
  language: "ja" | "en";
  conclusion: string;
  answer: string;
  evidence: readonly OriginAnswerEvidenceItem[];
  verification: {
    status: OriginAnswerVerificationStatus;
    independentReviewPerformed: boolean;
    summary: string;
  };
  limitations: readonly string[];
  nextActions: readonly string[];
  richOutputs?: readonly OriginAnswerRichOutput[];
}

export interface OriginAnswerEnvelope extends OriginAnswerEnvelopeInput {
  schemaVersion: "origin.answer.v1";
}

export interface OriginAnswerTechnicalTrace {
  traceId: string;
  providerId: string;
  modelId: string;
  actualCostUsd: number;
  freeOnly: true;
}

export type OriginAnswerEnvelopeFailureCode =
  | "INVALID_ANSWER_CONTENT"
  | "INVALID_EVIDENCE"
  | "INVALID_VERIFICATION"
  | "INVALID_RICH_OUTPUT";

export type OriginAnswerEnvelopeResult =
  | { ok: true; value: OriginAnswerEnvelope }
  | { ok: false; code: OriginAnswerEnvelopeFailureCode; message: string };

const MAX_CONCLUSION_LENGTH = 500;
const MAX_ANSWER_LENGTH = 50_000;
const MAX_LIST_ITEMS = 20;
const MAX_ITEM_LENGTH = 1_000;

function cleanRequiredText(value: string, maxLength: number): string | null {
  const cleaned = value.trim();
  return cleaned.length > 0 && cleaned.length <= maxLength ? cleaned : null;
}

function cleanList(values: readonly string[]): string[] | null {
  if (values.length > MAX_LIST_ITEMS) return null;

  const cleaned = values.map((value) => value.trim());
  if (cleaned.some((value) => value.length === 0 || value.length > MAX_ITEM_LENGTH)) return null;
  return cleaned;
}

function isSafeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function createOriginAnswerEnvelope(
  input: OriginAnswerEnvelopeInput,
): OriginAnswerEnvelopeResult {
  const conclusion = cleanRequiredText(input.conclusion, MAX_CONCLUSION_LENGTH);
  const answer = cleanRequiredText(input.answer, MAX_ANSWER_LENGTH);
  const limitations = cleanList(input.limitations);
  const nextActions = cleanList(input.nextActions);

  if (!conclusion || !answer || !limitations || !nextActions) {
    return {
      ok: false,
      code: "INVALID_ANSWER_CONTENT",
      message: "回答内容、制約、または次の行動の形式が正しくありません。",
    };
  }

  if (input.evidence.length > MAX_LIST_ITEMS) {
    return {
      ok: false,
      code: "INVALID_EVIDENCE",
      message: "回答根拠の形式が正しくありません。",
    };
  }

  const evidence = input.evidence.map((item) => ({
    ...item,
    label: item.label.trim(),
    sourceUrl: item.sourceUrl?.trim(),
  }));
  const invalidEvidence = evidence.some((item) =>
    item.label.length === 0
    || item.label.length > MAX_ITEM_LENGTH
    || (item.sourceUrl !== undefined && !isSafeSourceUrl(item.sourceUrl))
    || (item.evidenceLevel === "source-checked" && item.sourceUrl === undefined)
  );
  if (invalidEvidence) {
    return {
      ok: false,
      code: "INVALID_EVIDENCE",
      message: "回答根拠の形式が正しくありません。",
    };
  }

  const verificationSummary = cleanRequiredText(input.verification.summary, MAX_ITEM_LENGTH);
  const passedWithoutIndependentReview = input.verification.status === "passed"
    && !input.verification.independentReviewPerformed;
  const unreviewedButMarkedIndependent = input.verification.status !== "passed"
    && input.verification.independentReviewPerformed;
  if (!verificationSummary || passedWithoutIndependentReview || unreviewedButMarkedIndependent) {
    return {
      ok: false,
      code: "INVALID_VERIFICATION",
      message: "独立確認の実行状態と表示内容が一致しません。",
    };
  }

  const richOutputs = (input.richOutputs ?? []).map((output) => ({
    ...output,
    label: output.label.trim(),
    artifactId: output.artifactId.trim(),
  }));
  if (
    richOutputs.length > MAX_LIST_ITEMS
    || richOutputs.some((output) =>
      output.label.length === 0
      || output.label.length > MAX_ITEM_LENGTH
      || output.artifactId.length === 0
      || output.artifactId.length > MAX_ITEM_LENGTH
    )
  ) {
    return {
      ok: false,
      code: "INVALID_RICH_OUTPUT",
      message: "生成成果物の参照情報が正しくありません。",
    };
  }

  return {
    ok: true,
    value: {
      schemaVersion: "origin.answer.v1",
      language: input.language,
      conclusion,
      answer,
      evidence,
      verification: {
        ...input.verification,
        summary: verificationSummary,
      },
      limitations,
      nextActions,
      richOutputs,
    },
  };
}
