/**
 * ProposalDeck チャット接続（PR-3a）— streaming チャット経路の後段処理。
 *
 * 設計の正本: ~/workspace/origin-fix/PROPOSAL_PR3_DECISIONS_2026-11-12.md 決定1・決定2
 * - 提案・プレゼン作成の意図が立った場合のみ、骨格指示を追加し、回答確定後に
 *   パーサー → buildProposalDeck → checkProposalDeck → PPTX レンダラーを決定的に通す。
 * - 自己チェック不合格ならファイルは作らない（呼び出し側が注記だけを添える）。
 * - 追加のモデル呼び出しは一切しない。費用は常に $0。
 * - 成果物ペイロードの形は、非streaming側の Supervisor 成果物
 *   （OriginSupervisorArtifactPayloadV2）と同一にし、クライアントの
 *   parseOriginArtifacts 検証（docx/pptx/xlsx のみ・sha256 再検証あり）を
 *   そのまま通る形に揃える。
 */

import { createHash } from "node:crypto";
import {
  buildProposalDeck,
  ProposalDeckBuildError,
} from "../artifacts/proposalDeckPlannerV1.js";
import { renderProposalDeckPptx } from "../artifacts/proposalDeckPptxV1.js";
import {
  checkProposalDeck,
  proposalDeckNumericSourceTexts,
} from "../artifacts/proposalDeckSelfCheckV1.js";
import {
  classifyProposalDeckParseFailureCode,
  summarizeProposalDeckAnswerShape,
  type ProposalDeckAnswerShape,
} from "../artifacts/proposalDeckFailureShapeV1.js";
import {
  parseProposalDeckSkeleton,
  PROPOSAL_DECK_SKELETON_INSTRUCTION,
} from "../artifacts/proposalDeckSkeletonV1.js";
import type { OriginRequestIntent } from "../lib/orchestration/OriginRequestIntent.js";
import type { OriginSupervisorArtifactPayloadV2 } from "../lib/orchestration/OriginSupervisorV2.js";

export { PROPOSAL_DECK_SKELETON_INSTRUCTION };

/** Supervisor 側の単体上限と揃える（OriginSupervisorV2 の MAX_INLINE_ARTIFACT_BYTES）。 */
const MAX_INLINE_ARTIFACT_BYTES = 1_250_000;
const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** 自己チェック不合格などでファイルを作れなかったときに回答末尾へ添える注記。 */
export const PROPOSAL_DECK_FAILURE_NOTE =
  "\n\n（資料ファイルの作成はできませんでした。上記の構成案をご覧ください。）";

/**
 * 提案資料デッキの対象かどうか。
 * - outputs の presentation（スライド等）/ proposal（提案書・企画書）は常に対象。
 * - outputs の document は汎用文書（報告書・手順書等）も含むため、
 *   依頼文に提案・企画の語がある場合だけ対象にする。
 * - 依頼文に「提案資料」「企画資料」が直接含まれる場合も対象にする。
 *   出力カタログは「提案書」「資料を作成」等の語形しか拾えず、本番の自然な
 *   言い回し「販促提案資料を作ってください」が対象外になっていた
 *   （PROPOSAL_CHAT_TRIAGE_2026-11-13 原因A）。
 */
export function isProposalDeckChatRequest(
  intent: OriginRequestIntent,
  intentInput: string,
): boolean {
  const outputs = intent.requestedOutputs;
  if (outputs.includes("presentation") || outputs.includes("proposal")) return true;
  if (outputs.includes("document") && /提案|企画/.test(intentInput)) return true;
  if (/提案資料|企画資料/.test(intentInput)) return true;
  return false;
}

export type ProposalDeckChatArtifactOutcome =
  | { status: "created"; artifact: OriginSupervisorArtifactPayloadV2 }
  | {
      status: "failed";
      failureCode: string;
      violationCodes?: readonly string[];
      /** 失敗時の回答の「形」（件数のみ・原文テキストは含まない）。完了ログへそのまま渡す。 */
      failureShape?: ProposalDeckAnswerShape;
    };

/** artifactGeneratorV12 の safeName と同じ規則でファイル名の stem を作る。 */
function deckFilenameStem(title: string): string {
  const stem = (title || "origin-proposal")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return stem || "origin-proposal";
}

/**
 * 回答テキストから提案資料 PPTX の成果物ペイロードを作る（決定的・$0）。
 * 骨格として読めない／構造が作れない／自己チェック不合格／生成物の検証に
 * 落ちる場合は failed を返し、ファイルは作らない。
 */
export function buildProposalDeckChatArtifact(
  answerText: string,
): ProposalDeckChatArtifactOutcome {
  // 失敗時は段階別の failureCode に加え、回答の「形」（件数のみ）を必ず添える。
  // 形があれば、原文を保存しなくても失敗形状を恒常フィクスチャとして再構成できる。
  const fail = (
    failureCode: string,
    violationCodes?: readonly string[],
  ): ProposalDeckChatArtifactOutcome => ({
    status: "failed",
    failureCode,
    ...(violationCodes ? { violationCodes } : {}),
    failureShape: summarizeProposalDeckAnswerShape(answerText),
  });

  const input = parseProposalDeckSkeleton(answerText);
  if (!input) {
    return fail(classifyProposalDeckParseFailureCode(answerText));
  }

  let deck;
  try {
    deck = buildProposalDeck(input);
  } catch (error) {
    return fail(
      error instanceof ProposalDeckBuildError
        ? `PROPOSAL_DECK_BUILD_${error.code}`
        : "PROPOSAL_DECK_BUILD_FAILED",
    );
  }

  const selfCheck = checkProposalDeck(deck, {
    numericSourceTexts: proposalDeckNumericSourceTexts(input),
  });
  if (!selfCheck.ok) {
    return fail(
      "PROPOSAL_DECK_SELF_CHECK_FAILED",
      selfCheck.violations.map((violation) => violation.code),
    );
  }

  let bytes: Buffer;
  try {
    bytes = renderProposalDeckPptx(deck);
  } catch {
    return fail("PROPOSAL_DECK_RENDER_FAILED");
  }

  // 生成物の決定的検証（artifactGeneratorV12 の pptx 検証と同じ観点）。
  const verification: string[] = [];
  if (bytes.length > 0) verification.push("non-empty");
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) {
    verification.push("zip-signature");
  }
  if (
    bytes.includes(Buffer.from("ppt/presentation.xml")) &&
    bytes.includes(Buffer.from("ppt/slides/slide1.xml"))
  ) {
    verification.push("pptx-package");
  }
  verification.push("proposal-deck-self-check");
  if (!verification.includes("zip-signature") || !verification.includes("pptx-package")) {
    return fail("PROPOSAL_DECK_VERIFICATION_FAILED");
  }
  if (bytes.length > MAX_INLINE_ARTIFACT_BYTES) {
    return fail("PROPOSAL_DECK_ARTIFACT_TOO_LARGE");
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    status: "created",
    artifact: {
      id: `artifact-pptx-${sha256.slice(0, 20)}`,
      kind: "presentation",
      artifactType: "pptx",
      filename: `${deckFilenameStem(deck.title)}.pptx`,
      mimeType: PPTX_MIME_TYPE,
      sha256,
      byteLength: bytes.length,
      encoding: "base64",
      data: bytes.toString("base64"),
      verified: true,
      verification,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
    },
  };
}
