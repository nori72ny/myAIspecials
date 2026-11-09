export interface OriginAnswerUxStaticAuditResult {
  version: 1;
  wordLikeLength: number;
  headingCount: number;
  bulletLineCount: number;
  tableRowCount: number;
  boldSpanCount: number;
  paragraphCount: number;
  findings: OriginAnswerUxStaticFinding[];
}

export type OriginAnswerUxStaticFindingCode =
  | "GENERIC_PREAMBLE"
  | "QUESTION_REPETITION"
  | "OVER_SECTIONED"
  | "LIST_SPAM"
  | "TABLE_ABUSE"
  | "EXCESSIVE_BOLD"
  | "REPEATED_CONCLUSION";

export interface OriginAnswerUxStaticFinding {
  code: OriginAnswerUxStaticFindingCode;
  severity: "low" | "medium";
}

function normalizedLines(answer: string): string[] {
  return answer.replace(/\r\n/g, "\n").split("\n");
}

function countMatches(input: string, pattern: RegExp): number {
  return [...input.matchAll(pattern)].length;
}

function hasGenericPreamble(answer: string): boolean {
  const first = answer.trimStart().slice(0, 120);
  return /^(?:以下に|下記に|それでは|では、|ご質問|ご依頼|〜についてお答え|.*について(?:お答え|説明|解説)します)/u.test(first)
    || /^(?:sure[,!.]?\s*)?(?:here(?:'s| is)|below is|i(?:'ll| will) (?:explain|summarize|provide))/i.test(first);
}

function hasQuestionRepetition(answer: string, userMessage?: string): boolean {
  if (!userMessage) return false;
  const question = userMessage.trim().replace(/\s+/g, " ");
  if (question.length < 12) return false;
  const answerHead = answer.trim().slice(0, Math.min(240, question.length * 2));
  return answerHead.includes(question);
}

function hasRepeatedConclusion(answer: string): boolean {
  const paragraphs = answer
    .split(/\n\s*\n/)
    .map((value) => value.replace(/[#>*_`\-]/g, "").trim())
    .filter((value) => value.length >= 24);
  if (paragraphs.length < 3) return false;
  const first = paragraphs[0].slice(0, 80);
  const last = paragraphs.at(-1)?.slice(0, 80) ?? "";
  if (!first || !last) return false;
  const firstTokens = new Set(first.split(/\s+|、|。/).filter((token) => token.length >= 3));
  const overlap = last.split(/\s+|、|。/).filter((token) => token.length >= 3 && firstTokens.has(token)).length;
  return overlap >= 4;
}

export function auditOriginAnswerUxStatic(answer: string, userMessage?: string): OriginAnswerUxStaticAuditResult {
  const lines = normalizedLines(answer);
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  const headingCount = nonEmpty.filter((line) => /^#{1,6}\s+/.test(line)).length;
  const bulletLineCount = nonEmpty.filter((line) => /^\s*(?:[-*+] |\d+[.)]\s+)/.test(line)).length;
  const tableRowCount = nonEmpty.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;
  const boldSpanCount = countMatches(answer, /\*\*[^*\n]+\*\*/g);
  const paragraphCount = answer.split(/\n\s*\n/).filter((value) => value.trim().length > 0).length;
  const wordLikeLength = answer.replace(/\s+/g, "").length;
  const findings: OriginAnswerUxStaticFinding[] = [];

  if (hasGenericPreamble(answer)) findings.push({ code: "GENERIC_PREAMBLE", severity: "low" });
  if (hasQuestionRepetition(answer, userMessage)) findings.push({ code: "QUESTION_REPETITION", severity: "medium" });
  if (headingCount >= 6 && wordLikeLength < 1800) findings.push({ code: "OVER_SECTIONED", severity: "medium" });
  if (bulletLineCount >= 10 && bulletLineCount / Math.max(1, nonEmpty.length) > 0.55) findings.push({ code: "LIST_SPAM", severity: "medium" });
  if (tableRowCount >= 6 && wordLikeLength < 900) findings.push({ code: "TABLE_ABUSE", severity: "low" });
  if (boldSpanCount >= 8 && wordLikeLength < 1800) findings.push({ code: "EXCESSIVE_BOLD", severity: "low" });
  if (hasRepeatedConclusion(answer)) findings.push({ code: "REPEATED_CONCLUSION", severity: "low" });

  return {
    version: 1,
    wordLikeLength,
    headingCount,
    bulletLineCount,
    tableRowCount,
    boldSpanCount,
    paragraphCount,
    findings,
  };
}
