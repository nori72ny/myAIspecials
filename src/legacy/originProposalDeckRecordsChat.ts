/**
 * ProposalDeck 資料レコード経路のチャット接続（D-PR-6）— streaming
 * チャット経路への最終配線。
 *
 * 設計正本: ~/workspace/origin-fix/DECK_RECORDS_REDESIGN_2026-11-15.md
 * （§2.1 処理の流れ、§9 材料不足時の動作、§10 既存経路との関係・
 * キルスイッチ・観測、§13-13 モード判定の初期閾値、追補の統括裁定）
 *
 * キルスイッチ `ORIGIN_DECK_RECORDS_ENABLED`（既定 OFF）が ON の
 * ときだけ、提案資料リクエストは本モジュールの新経路を通る。OFF の
 * 間は現行経路（originProposalDeckChat）が完全に無変更で動く。
 * ON のときに新経路が不成立でも、旧経路では救済しない
 * （fail-closed。追補裁定 §13-2 (a)）。
 *
 * 経路の形:
 * - モード判定（§13-13 の初期閾値）: 依頼文の材料単位（D-PR-1 の
 *   分割）に、表が含まれる／箇条書きが3行以上ある／文の単位が
 *   2つ以上ある（複数文の本文）場合はモードA（材料あり）、
 *   それ以外はモードB（テーマだけの依頼）。
 * - モードB: 通常の生成に起草指示（D-PR-2）を付け、回答をタグ
 *   起草として組立（D-PR-4）→ 変換（D-PR-5）→ PPTX 描画する。
 *   生成は通常の1回だけであり、追加呼び出しはしない（§4.2）。
 * - モードA: 生成の前に決定的配置の組立を試す（追補の統括裁定
 *   「重大1」の手順）。充足すればモデル呼び出しなしで採用し、
 *   生成の回答文は資料化に使わない。充足しなければ、配置指示
 *   （D-PR-3）＋材料一覧を生成の指示に付け、その回答を配置計画
 *   として組立てる（モデル配置は最大1回。呼び出し回数は
 *   §13-4 (a) の上限「通常生成＋追加1回」の内側に収まる）。
 *   それでも不足なら材料不足として扱う（§9）。
 * - チャット表示は、モデルの生の出力（タグ起草・配置計画）を
 *   そのまま出さず、組立文書から決定的に組み立てる（§5、
 *   §13-5 (a) の完成まで保持。保持自体はルーター側で行う）。
 * - 不足の判定の正本はアプリ側の再計算（組立結果の missing）。
 *   モデル配置のパース失敗で組立文書が作れなかった場合に限り、
 *   同じ素材への決定的配置の再計算を不足の正本として使う
 *   （形式の失敗そのものは不足とは扱わない、という D-PR-4 の
 *   切り分けは、モデル側の組立に対する分類として維持する）。
 *
 * DG-1 修正（2026-11-22）: 測定（DOCUMENT_INSPECTION_DG1）で
 * 確定した変換側の原因への対応として、本モジュールに次を加えた。
 * いずれも本スイッチ ON の範囲内であり、OFF の挙動は変えない。
 * - 資料リクエスト判定の拡張（matchesDeckRecordsRequestText）:
 *   資料の種別語＋作成依頼の動詞句を現行判定に重ねる（原因4）。
 * - 依頼文の主題単位（'theme'）: 散文形式の素材は題名文を持た
 *   ないため、依頼の主題をタイトル候補として材料に加える
 *   （原因2の一部。分割側の対応は D-PR-1 の追加分割）。
 * - モード判定で 'label' 単位を文の単位と合算する（原因2）。
 *
 * 自己チェックの扱い: 新経路の自己チェックは D-PR-4 の5ゲート
 * （組立に内包）である。変換後の ProposalDeck に対する現行
 * checkProposalDeck は、D-PR-5 が表面化させた衝突（60字ルール・
 * 1節4件・受動形の見出し）を観測するためだけに実行し、違反
 * コードをメトリクスに記録する（合否には使わない）。合否に使う
 * と、ゲート3が「長さを理由に材料を落とさない」と確定した
 * 逐語単位や、ゲート4が追加で認めた受動形の閉じを、旧検査が
 * 理由に資料全体を落とすことになり、確定事項と衝突するため。
 *
 * 段階別メトリクスは件数・コードのみ（§10.3）。本文・依頼文・
 * 素材のタイトルは記録しない。費用は常に $0（生成は通常経路の
 * 無料枠のみ、追加の有料呼び出しは一切しない）。
 */

import { createHash } from "node:crypto";
import {
  assembleDeckFromDraft,
  assembleDeckFromMaterial,
  type DeckAssemblyResult,
} from "../artifacts/proposalDeckAssemblyV1.js";
import { renderDeckRecordsChatMarkdown } from "../artifacts/proposalDeckChatRenderV1.js";
import { buildDeckDraftInstruction } from "../artifacts/proposalDeckDraftV1.js";
import {
  buildDeckPlacementInstruction,
  formatDeckMaterialForPlacement,
  type DeckMissingCode,
  type DeckPlacementMissingEntry,
} from "../artifacts/proposalDeckPlacementV1.js";
import {
  buildDeckMaterialUnits,
  type DeckMaterialUnit,
} from "../artifacts/proposalDeckRecordsV1.js";
import { convertAssembledDeckToProposalDeck } from "../artifacts/proposalDeckRenderV1.js";
import { renderProposalDeckPptx } from "../artifacts/proposalDeckPptxV1.js";
import { checkProposalDeck } from "../artifacts/proposalDeckSelfCheckV1.js";
import type { OriginRequestIntent } from "../lib/orchestration/OriginRequestIntent.js";
import type { OriginSupervisorArtifactPayloadV2 } from "../lib/orchestration/OriginSupervisorV2.js";
import { isProposalDeckChatRequest } from "./originProposalDeckChat.js";

// ---------------------------------------------------------------------------
// キルスイッチ（設計 §10.2）
// ---------------------------------------------------------------------------

/** 資料レコード経路のキルスイッチの環境変数名（D-PR-6 で最終確定）。 */
export const ORIGIN_DECK_RECORDS_ENABLED_ENV = "ORIGIN_DECK_RECORDS_ENABLED";

/**
 * キルスイッチの値解釈。統合レコード方式の
 * isGroundedResearchRecordsEnabled と同一: 未設定なら OFF、
 * `false`／`0`／`off`／`no`（前後空白・大小文字を吸収）で無効、
 * それ以外で有効。既定は OFF。
 */
export function isDeckRecordsEnabled(env: {
  [key: string]: string | undefined;
}): boolean {
  const raw = env[ORIGIN_DECK_RECORDS_ENABLED_ENV];
  if (raw === undefined) return false;
  return !["false", "0", "off", "no"].includes(raw.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// 資料リクエスト判定（DG-1 修正, 2026-11-22）
// ---------------------------------------------------------------------------

/**
 * 資料の作成依頼を表す動詞句（作成依頼の形だけを受け、方法の質問
 * 「作るにはどうすれば」は含めない）。
 */
const DECK_RECORDS_CREATION_VERB_PATTERN =
  "作って|作成して|作ってもらって|作成してもらって|作りたい|作成したい|作ってほしい|作成してほしい|にして|にまとめ|に仕上げ";

/**
 * レコード経路専用の資料リクエスト文面判定（DG-1 原因4の修正）。
 *
 * 現行判定（isProposalDeckChatRequest）は outputs=document の場合に
 * 「提案／企画」を必須とするため、「経営レポート資料を作って
 * ください」のような資料化依頼が資料リクエストと判定されなかった
 * （DG-1 の S-6）。本判定は、キルスイッチ ON のときだけ使う拡張で、
 * 資料の種別語＋作成依頼の動詞句の組み合わせを受け付ける。
 * 調査経路の振り分け回避（原因3）の判定にも同じ関数を使う。
 */
export function matchesDeckRecordsRequestText(text: string): boolean {
  if (typeof text !== "string" || text === "") return false;
  if (/提案資料|企画資料|仕様資料|レポート資料/.test(text)) return true;
  if (
    new RegExp(`資料を?(?:${DECK_RECORDS_CREATION_VERB_PATTERN})`).test(text)
  )
    return true;
  if (
    new RegExp(
      `(?:報告書|仕様書|提案書|企画書|レポート)を?(?:${DECK_RECORDS_CREATION_VERB_PATTERN})`,
    ).test(text)
  )
    return true;
  return false;
}

/**
 * レコード経路の資料リクエスト判定: 現行判定（isProposalDeckChatRequest）
 * に、依頼文そのものと直近ユーザー発話への文面判定を重ねる。
 * キルスイッチ OFF の間は呼び出し側が現行判定だけを使うため、
 * OFF の挙動は変わらない。
 */
export function isProposalDeckRecordsChatRequest(
  intent: OriginRequestIntent,
  intentInput: string,
  lastUserMessage?: string,
): boolean {
  if (isProposalDeckChatRequest(intent, intentInput)) return true;
  if (matchesDeckRecordsRequestText(intentInput)) return true;
  if (
    lastUserMessage !== undefined &&
    matchesDeckRecordsRequestText(lastUserMessage)
  )
    return true;
  return false;
}

// ---------------------------------------------------------------------------
// モード判定（設計 §2.3、§13-13 の初期閾値）
// ---------------------------------------------------------------------------

/**
 * 材料単位列からのモード判定（§13-13 の初期閾値）: 表がある／
 * 箇条書きが3行以上ある／複数文の本文（文の単位が2つ以上）なら
 * モードA（材料あり）。判定は D-PR-1 の単位分割の結果だけから
 * 決定的に行う（閾値の較正は D-PR-7 の測定で行う）。
 */
function deckRecordsModeFromUnits(
  units: readonly DeckMaterialUnit[],
): "A" | "B" {
  if (units.some((unit) => unit.kind === "table")) return "A";
  if (units.filter((unit) => unit.kind === "bullet").length >= 3) return "A";
  // DG-1 修正: 'label' 単位（「項目名：」の項目名）は、その後に
  // 本文が続く構造化された材料の印であるため、文の単位と合算して
  // 「複数文の本文」の閾値に数える（ラベル＋本文1文の材料を
  // テーマだけの依頼と誤判定しない）。
  if (
    units.filter((unit) => unit.kind === "sentence" || unit.kind === "label")
      .length >= 2
  )
    return "A";
  return "B";
}

/** 依頼文のモード判定（材料あり = 'A'、テーマだけ = 'B'）。 */
export function detectDeckRecordsMode(requestText: string): "A" | "B" {
  return deckRecordsModeFromUnits(buildDeckMaterialUnits(requestText));
}

// ---------------------------------------------------------------------------
// 依頼文の主題単位（DG-1 修正, 2026-11-22）
// ---------------------------------------------------------------------------

/**
 * 依頼文の主題の抽出パターン: 依頼文の先頭文にある「主題＋資料の
 * 種別語＋作成依頼の動詞句」から主題だけを取り出す。主題は依頼文
 * の逐語の部分文字列であり、新しい文は作らない。
 */
const DECK_REQUEST_THEME_PATTERN =
  /^(.{3,40}?)(?:の)?(提案資料|企画資料|仕様資料|レポート資料|報告書|仕様書|提案書|企画書|レポート|資料)(?:を|に|の)?(作って|作成して|作ってもらって|作成してもらって|作りたい|作成したい|作ってほしい|作成してほしい|ください|お願いします)/;

/**
 * 依頼文の主題（例: 「値引きキャンペーンの企画資料を作って
 * ください」→「値引きキャンペーン」）。散文形式の素材は題名文を
 * 含まないため、そのままでは資料のタイトルが常に不足する
 * （DG-1 の十分群すべてで MISSING_TITLE が構造的に発生した）。
 * 依頼の主題は利用者自身の言葉であり、タイトル候補として材料に
 * 加える。抽出できない場合は null（従来通りタイトル不足として
 * 扱う）。
 */
export function extractDeckRequestTheme(requestText: string): string | null {
  const firstSentence = requestText.split(/[。\n]/, 1)[0] ?? "";
  const match = DECK_REQUEST_THEME_PATTERN.exec(firstSentence);
  if (match === null) return null;
  const theme = match[1].trim();
  if (theme.length < 3 || theme.length > 40) return null;
  if (/[、，：:]/.test(theme)) return null;
  if (/(?:は|が|を|に|へ|と|も|の)$/.test(theme)) return null;
  return theme;
}

/**
 * レコード経路が使う材料単位列: D-PR-1 の分割に、依頼文の主題
 * 単位（'theme'、末尾）を足したもの。計画（モデルへ見せる材料
 * 一覧）と組立で同じ単位列を使うため、両者は必ずこの関数を
 * 経由する。主題が抽出できない場合は分割結果そのもの。
 */
export function buildDeckRecordsUnits(
  requestText: string,
): DeckMaterialUnit[] {
  const units = buildDeckMaterialUnits(requestText);
  const theme = extractDeckRequestTheme(requestText);
  if (theme === null) return units;
  return [
    ...units,
    {
      id: `M${units.length + 1}`,
      text: theme,
      kind: "theme",
      sourceKind: "user-material",
    },
  ];
}

// ---------------------------------------------------------------------------
// 段階別メトリクス（設計 §10.3、件数・コードのみ）
// ---------------------------------------------------------------------------

export interface DeckRecordsStageMetrics {
  /** モード判定の結果。 */
  mode: "A" | "B";
  /** 材料レコードの総単位件数。 */
  materialUnitCount: number;
  /**
   * 資料経路が消費した生成回数。モードBの起草とモードAのモデル
   * 配置は通常の生成1回を使う（=1）。決定的配置だけで採用した
   * 場合は0（生成の回答文は資料化に使っていない）。
   */
  executionCount: number;
  /** 配置の解釈形式（モードA: json／text／deterministic、モードB: tags）。 */
  placementFormatKind: "json" | "text" | "deterministic" | "tags" | null;
  /** 材料に無い ID への参照を無効化した件数（モードAのモデル配置のみ）。 */
  unknownIdCount: number;
  /** 重複配置として除去した参照の件数（モードAのモデル配置のみ）。 */
  duplicateRemovedCount: number;
  /** 5ゲートの違反件数（コード別）。 */
  gateViolationCounts: Record<string, number>;
  /** ゲート3が再計算した不足の種別コード。 */
  missingCodes: readonly string[];
  /** 逐語昇格が発動した節の数。 */
  promotionCount: number;
  /** 構成案メタ語彙の検出件数。 */
  metaDetectionCount: number;
  /**
   * 変換後の ProposalDeck に対する現行自己チェックの違反コード
   * （観測のみ。合否には使わない。created のときだけ記録する）。
   */
  legacySelfCheckViolationCodes: readonly string[];
  /** 最終形の種別。 */
  finalForm: "created" | "insufficient" | "failed";
  /** 資料経路の処理時間（呼び出し側が渡した場合のみ意味を持つ）。 */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// 生成前の計画（モード判定と、生成へ付ける指示の決定）
// ---------------------------------------------------------------------------

export interface DeckRecordsRequestPlan {
  mode: "A" | "B";
  /** 依頼文の材料単位件数（モードAでは主題単位を含む）。 */
  materialUnitCount: number;
  /**
   * 組立に使う材料単位列（DG-1 修正）。モードAでは主題単位を
   * 含み、計画時にモデルへ見せた材料一覧と一致する。モードBでは
   * 素材分割の結果そのもの（組立は起草側で行うため未使用）。
   */
  units: readonly DeckMaterialUnit[];
  /**
   * 生成（経路1・2）のシステム指示へ追加する固定文。モードBは
   * 起草指示、モードAで決定的配置が充足しなかった場合は配置
   * 指示＋材料一覧。モードAで決定的配置が充足した場合は null
   * （生成の回答文は資料化に使わないため、追加指示は付けない）。
   */
  instruction: string | null;
  /** モードAで生成前に計算した決定的配置の組立結果。モードBでは null。 */
  deterministicAssembly: DeckAssemblyResult | null;
}

/**
 * 依頼文から、モード判定と生成へ付ける指示を決める。モードAでは
 * 決定的配置の組立まで生成前に行う（追補裁定の手順1〜2）。
 * 決定的処理のみで、モデル呼び出しはしない。
 */
export function planDeckRecordsRequest(
  requestText: string,
): DeckRecordsRequestPlan {
  const baseUnits = buildDeckMaterialUnits(requestText);
  const mode = deckRecordsModeFromUnits(baseUnits);
  if (mode === "B") {
    return {
      mode,
      materialUnitCount: baseUnits.length,
      units: baseUnits,
      instruction: buildDeckDraftInstruction(),
      deterministicAssembly: null,
    };
  }
  // モードA: 主題単位を含む単位列で決定的配置まで試す（DG-1 修正）。
  const units = buildDeckRecordsUnits(requestText);
  const deterministicAssembly = assembleDeckFromMaterial({
    materialText: requestText,
    units,
  });
  if (deterministicAssembly.ok) {
    return {
      mode,
      materialUnitCount: units.length,
      units,
      instruction: null,
      deterministicAssembly,
    };
  }
  const instruction = [
    buildDeckPlacementInstruction(),
    "",
    "材料:",
    formatDeckMaterialForPlacement(deterministicAssembly.units),
  ].join("\n");
  return {
    mode,
    materialUnitCount: units.length,
    units,
    instruction,
    deterministicAssembly,
  };
}

// ---------------------------------------------------------------------------
// 生成後の組立〜成果物化
// ---------------------------------------------------------------------------

export type DeckRecordsChatOutcome =
  | {
      status: "created";
      artifact: OriginSupervisorArtifactPayloadV2;
      chatText: string;
      metrics: DeckRecordsStageMetrics;
    }
  | { status: "insufficient"; chatText: string; metrics: DeckRecordsStageMetrics }
  | {
      status: "failed";
      failureCode: string;
      violationCodes: readonly string[];
      chatText: string;
      metrics: DeckRecordsStageMetrics;
    };

/** 新経路で資料を作れなかったときにチャット本文へ出す定型文。 */
export const PROPOSAL_DECK_RECORDS_FAILURE_TEXT =
  "資料ファイルの作成はできませんでした。";

/** 不足種別コード → 利用者へ聞く項目（設計 §9 の伝え方）。 */
const DECK_RECORDS_MISSING_QUESTIONS: Readonly<Record<DeckMissingCode, string>> = {
  MISSING_TITLE: "資料のタイトルになる文",
  MISSING_KEY_POINTS: "要点として載せる内容（3点）",
  MISSING_SECTION_CONTENT: "各節の本文になる具体的な内容",
  MISSING_ASSERTION_HEADLINES: "各節の結論を言い切る文",
  MISSING_NEXT_ACTION: "提案したい次の行動",
};

/** Supervisor 側の単体上限と揃える（originProposalDeckChat と同一）。 */
const MAX_INLINE_ARTIFACT_BYTES = 1_250_000;
const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** artifactGeneratorV12 の safeName と同じ規則（現行経路と同一のファイル名規則）。 */
function deckFilenameStem(title: string): string {
  const stem = (title || "origin-proposal")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return stem || "origin-proposal";
}

function countViolationsByCode(
  violations: readonly { code: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of violations) {
    counts[violation.code] = (counts[violation.code] ?? 0) + 1;
  }
  return counts;
}

/**
 * 生成後の処理: 計画と生成の回答文から、組立→変換→自己チェック
 * （観測）→ PPTX 描画→生成物の決定的検証までを決定的に行う。
 * 不成立の場合は、不足（insufficient）と失敗（failed）を区別して
 * 返し、ファイルは作らない（fail-closed）。
 */
export function buildDeckRecordsChatArtifact(input: {
  requestText: string;
  answerText: string;
  plan: DeckRecordsRequestPlan;
  durationMs?: number;
}): DeckRecordsChatOutcome {
  const durationMs = input.durationMs ?? 0;
  let assembly: DeckAssemblyResult;
  let executionCount: number;
  if (input.plan.mode === "B") {
    assembly = assembleDeckFromDraft({ draftText: input.answerText });
    executionCount = 1;
  } else if (input.plan.deterministicAssembly?.ok) {
    assembly = input.plan.deterministicAssembly;
    executionCount = 0;
  } else {
    assembly = assembleDeckFromMaterial({
      materialText: input.requestText,
      units: input.plan.units,
      placementOutputText: input.answerText,
    });
    executionCount = 1;
  }

  const baseMetrics = {
    mode: input.plan.mode,
    materialUnitCount: assembly.units.length,
    executionCount,
    placementFormatKind: assembly.placementFormatKind,
    unknownIdCount: assembly.unknownIdCount,
    duplicateRemovedCount: assembly.duplicateRemovedCount,
    gateViolationCounts: countViolationsByCode(assembly.violations),
    missingCodes: assembly.missing.map((entry) => entry.code),
    promotionCount: assembly.promotionCount,
    metaDetectionCount: assembly.metaDetectionCount,
    legacySelfCheckViolationCodes: [] as readonly string[],
    durationMs,
  };

  const fail = (
    failureCode: string,
    violationCodes: readonly string[],
  ): DeckRecordsChatOutcome => ({
    status: "failed",
    failureCode,
    violationCodes,
    chatText: PROPOSAL_DECK_RECORDS_FAILURE_TEXT,
    metrics: { ...baseMetrics, finalForm: "failed" },
  });

  if (assembly.ok && assembly.document !== null) {
    const conversion = convertAssembledDeckToProposalDeck(assembly.document);
    if (!conversion.ok || conversion.deck === null) {
      return fail(
        "PROPOSAL_DECK_RECORDS_CONVERSION_FAILED",
        conversion.issues.map((issue) => issue.code),
      );
    }
    // 現行自己チェックは観測のみ（モジュール冒頭の「自己チェックの扱い」）。
    const legacyViolations = checkProposalDeck(conversion.deck).violations.map(
      (violation) => violation.code,
    );

    let bytes: Buffer;
    try {
      bytes = renderProposalDeckPptx(conversion.deck);
    } catch {
      return fail("PROPOSAL_DECK_RENDER_FAILED", []);
    }
    // 生成物の決定的検証（現行経路・artifactGeneratorV12 と同じ観点）。
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
    verification.push("deck-records-gates");
    if (
      !verification.includes("zip-signature") ||
      !verification.includes("pptx-package")
    ) {
      return fail("PROPOSAL_DECK_VERIFICATION_FAILED", []);
    }
    if (bytes.length > MAX_INLINE_ARTIFACT_BYTES) {
      return fail("PROPOSAL_DECK_ARTIFACT_TOO_LARGE", []);
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      status: "created",
      artifact: {
        id: `artifact-pptx-${sha256.slice(0, 20)}`,
        kind: "presentation",
        artifactType: "pptx",
        filename: `${deckFilenameStem(conversion.deck.title)}.pptx`,
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
      chatText: renderDeckRecordsChatMarkdown(assembly.document),
      metrics: {
        ...baseMetrics,
        legacySelfCheckViolationCodes: legacyViolations,
        finalForm: "created",
      },
    };
  }

  // 不足と失敗の切り分け（設計 §9）: 不足の正本は組立の再計算。
  // モデル配置のパース失敗で文書が作れなかった場合に限り、同じ
  // 素材への決定的配置の再計算を不足の正本として使う。ただし
  // 材料が実質ゼロの場合（モードBで起草が全く解釈できない等）は、
  // 不足ではなく形式の失敗として扱う（利用者に材料の追加を求める
  // のは誤りであり、生成側の形式失敗であるため）。
  let missing: readonly DeckPlacementMissingEntry[] = assembly.missing;
  let partialDocument = assembly.document;
  if (
    assembly.document === null &&
    input.plan.deterministicAssembly !== null &&
    input.plan.deterministicAssembly.missing.length > 0
  ) {
    missing = input.plan.deterministicAssembly.missing;
    partialDocument = input.plan.deterministicAssembly.document;
  }

  const hasSubstance =
    assembly.units.length > 0 ||
    (partialDocument !== null && partialDocument.titleText !== null);
  if (missing.length > 0 && hasSubstance) {
    const blocks: string[] = [];
    if (partialDocument !== null) {
      blocks.push(renderDeckRecordsChatMarkdown(partialDocument, { partial: true }));
    }
    const questionLines = missing.map(
      (entry) =>
        `- ${DECK_RECORDS_MISSING_QUESTIONS[entry.code]}${
          entry.count > 1 ? `（${entry.count}か所）` : ""
        }`,
    );
    blocks.push(
      [
        "資料の作成には、次の情報が不足しています。",
        ...questionLines,
        "教えていただければ、その内容で資料を作成します。",
      ].join("\n"),
    );
    return {
      status: "insufficient",
      chatText: blocks.join("\n\n"),
      metrics: {
        ...baseMetrics,
        missingCodes: missing.map((entry) => entry.code),
        finalForm: "insufficient",
      },
    };
  }

  return fail(
    assembly.document === null
      ? "PROPOSAL_DECK_RECORDS_FORMAT_FAILED"
      : "PROPOSAL_DECK_RECORDS_GATES_FAILED",
    assembly.violations.map((violation) => violation.code),
  );
}
