/**
 * DG-1 修正（2026-11-22）のオフライン事前確認ランナー。
 *
 * 位置づけ: ランブック（DOCUMENT_GENERATION_DG1_PLAN_RUNBOOK
 * §1.6 段階1）の形に沿った事前確認であり、§11.3 の受入証拠では
 * ない。本番再測定は統括が静かな窓を開けて別途行う。
 *
 * 測るもの（すべて決定的・モデルなし・費用 $0）:
 * 1. 固定12件＋スモークについて、モード判定・単位件数・決定的
 *    配置の不足（planDeckRecordsRequest）。
 * 2. 十分群6件について、配置契約に適合する参照配置（本ファイル
 *    に固定した JSON。モデルが返しうる配置の代表例）を
 *    buildDeckRecordsChatArtifact へ通した最終形。作成できた
 *    場合は PPTX を DG-0 ハーネス（inspectDocumentBytes、
 *    sourceTexts = 依頼文）で検査する。
 *    - 参照配置は「ゲート適合可能性」の確認用であり、配置の
 *      質（節の coherence）の証拠ではない。単位経済の都合で
 *      弱い充当が必要なスロットは記録側（設計メモ）に明記する。
 * 3. 不足群6件について、作成に進まないこと（L-1 はモードBの
 *    形式不成立、L-2〜L-5 は空回答での insufficient、L-6 は
 *    途中切れ配置での insufficient）。
 *
 * 使い方: node node_modules/tsx/dist/cli.mjs \
 *   scripts/run-document-inspection-dg1-offline.ts [出力ディレクトリ]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DOCUMENT_INSPECTION_FIXTURE_CASES } from "../src/artifacts/documentInspectionFixturesV1.js";
import { inspectDocumentBytes } from "../src/artifacts/documentInspectionV1.js";
import {
  buildDeckRecordsChatArtifact,
  planDeckRecordsRequest,
  type DeckRecordsRequestPlan,
} from "../src/legacy/originProposalDeckRecordsChat.js";

const outDir =
  process.argv[2] ??
  join(
    process.env.HOME ?? "",
    "workspace/origin-fix/document-inspection-dg1-fix-2026-11-22",
  );
mkdirSync(outDir, { recursive: true });

function composeMessage(requestText: string, materialsText: string): string {
  return materialsText ? `${requestText}\n\n${materialsText}` : requestText;
}

/** 十分群の参照配置（単位 ID は修正後の分割に対する実測値）。 */
const REFERENCE_PLACEMENTS: Record<string, string> = {
  "S-1":
    '{"title_ref":"M15","summary_refs":["M9","M11","M12"],"sections":[' +
    '{"topic_ref":"M5","headline_ref":"M7","body_refs":["M6"]},' +
    '{"topic_ref":"M3","headline_ref":"M4","body_refs":["M2"]},' +
    '{"topic_ref":"M13","headline_ref":"M14","body_refs":["M10"]}],' +
    '"next_step_refs":["M8"],"missing":[]}',
  "S-2":
    '{"title_ref":"M19","summary_refs":["M8","M12","M18"],"sections":[' +
    '{"topic_ref":"M5","headline_ref":"M6","body_refs":["M4"]},' +
    '{"topic_ref":"M9","headline_ref":"M10","body_refs":["M16"]},' +
    '{"topic_ref":"M7","headline_ref":"M14","body_refs":["M13"]}],' +
    '"next_step_refs":["M17"],"missing":[]}',
  "S-3":
    '{"title_ref":"M16","summary_refs":["M4","M11","M13"],"sections":[' +
    '{"topic_ref":"M3","headline_ref":"M7","body_refs":["M5","M6"]},' +
    '{"topic_ref":"M8","headline_ref":"M9","body_refs":["M14"]},' +
    '{"topic_ref":"M10","headline_ref":"M15","body_refs":["M2"]}],' +
    '"next_step_refs":["M12"],"missing":[]}',
  "S-4":
    '{"title_ref":"M14","summary_refs":["M4","M5","M6"],"sections":[' +
    '{"topic_ref":"M3","headline_ref":"M9","body_refs":["M8"]},' +
    '{"topic_ref":null,"headline_ref":"M7","body_refs":["M12"]},' +
    '{"topic_ref":"M10","headline_ref":"M11","body_refs":["M2"]}],' +
    '"next_step_refs":["M13"],"missing":[]}',
  "S-5":
    '{"title_ref":"M13","summary_refs":["M4","M6","M9"],"sections":[' +
    '{"topic_ref":null,"headline_ref":"M7","body_refs":["M5"]},' +
    '{"topic_ref":null,"headline_ref":"M10","body_refs":["M3"]},' +
    '{"topic_ref":null,"headline_ref":"M12","body_refs":["M8"]}],' +
    '"next_step_refs":["M11"],"missing":[]}',
  "S-6":
    '{"title_ref":"M15","summary_refs":["M4","M5","M6"],"sections":[' +
    '{"topic_ref":"M7","headline_ref":"M10","body_refs":["M8"]},' +
    '{"topic_ref":null,"headline_ref":"M12","body_refs":["M9"]},' +
    '{"topic_ref":"M13","headline_ref":"M14","body_refs":["M3"]}],' +
    '"next_step_refs":["M11"],"missing":[]}',
};

const SMOKE_MESSAGE =
  "経費精算ツール KaihiTool の導入提案資料を作ってください。素材は次のとおりです。\n\n" +
  "製品名: 経費精算ツール KaihiTool。価格: 月額600円/人、初期費用0円。現状: 精算作業に月40時間かかっています。試用の結果: 作業は月16時間まで減りました。計画: 試用2週間、研修1回、本稼働まで5週間。";
const SMOKE_PLACEMENT =
  '{"title_ref":"M13","summary_refs":["M6","M8","M9"],"sections":[' +
  '{"topic_ref":null,"headline_ref":"M4","body_refs":["M5"]},' +
  '{"topic_ref":null,"headline_ref":"M10","body_refs":["M7"]},' +
  '{"topic_ref":null,"headline_ref":"M12","body_refs":["M11"]}],' +
  '"next_step_refs":["M2"],"missing":[]}';

interface CaseResult {
  id: string;
  group: string;
  expectation: string;
  mode: "A" | "B";
  materialUnitCount: number;
  deterministicOk: boolean;
  deterministicMissing: string[];
  /** 参照配置（十分群）または不成立入力（不足群）での最終形。 */
  probeAnswerKind: "reference-placement" | "empty" | "plain-text" | "truncated-placement";
  probeStatus: string;
  probeMissingCodes: string[];
  inspection?: {
    openOk: boolean;
    slideCount: number | null;
    numericStage: string;
    numericUnexpected: unknown;
    numericMissing: unknown;
    overflowingShapes: number;
  };
}

async function probe(
  id: string,
  message: string,
  plan: DeckRecordsRequestPlan,
  answerText: string,
  answerKind: CaseResult["probeAnswerKind"],
): Promise<Pick<CaseResult, "probeStatus" | "probeMissingCodes" | "inspection">> {
  const outcome = buildDeckRecordsChatArtifact({
    requestText: message,
    answerText,
    plan,
  });
  const base = {
    probeStatus: outcome.status,
    probeMissingCodes: [...outcome.metrics.missingCodes],
  };
  if (outcome.status !== "created") return base;
  const bytes = Buffer.from(outcome.artifact.data, "base64");
  writeFileSync(join(outDir, `${id}.pptx`), bytes);
  const inspection = await inspectDocumentBytes(bytes, "pptx", [message]);
  const numericResult =
    inspection.numeric?.stage === "done" ? inspection.numeric.result : null;
  return {
    ...base,
    inspection: {
      openOk: inspection.openOk,
      slideCount: inspection.ooxml?.slideCount ?? null,
      numericStage: inspection.numeric?.stage ?? "none",
      numericUnexpected: numericResult
        ? ((numericResult as { unexpected?: unknown }).unexpected ?? null)
        : null,
      numericMissing: numericResult
        ? ((numericResult as { missing?: unknown }).missing ?? null)
        : null,
      overflowingShapes: inspection.overflow?.overflowing.length ?? 0,
    },
  };
}

const results: CaseResult[] = [];

for (const fixture of DOCUMENT_INSPECTION_FIXTURE_CASES) {
  const message = composeMessage(fixture.requestText, fixture.materialsText);
  const plan = planDeckRecordsRequest(message);
  const deterministicMissing =
    plan.deterministicAssembly?.missing.map(
      (entry) => `${entry.code}x${entry.count}`,
    ) ?? [];
  let probeFields: Pick<
    CaseResult,
    "probeAnswerKind" | "probeStatus" | "probeMissingCodes" | "inspection"
  >;
  if (fixture.group === "sufficient") {
    const placement = REFERENCE_PLACEMENTS[fixture.id];
    probeFields = {
      probeAnswerKind: "reference-placement",
      ...(await probe(fixture.id, message, plan, placement, "reference-placement")),
    };
  } else if (fixture.id === "L-1") {
    // モードB: 起草形式でない回答は形式不成立として止まる。
    probeFields = {
      probeAnswerKind: "plain-text",
      ...(await probe(
        fixture.id,
        message,
        plan,
        "新しいサービスについての通常の文章回答です。",
        "plain-text",
      )),
    };
  } else if (fixture.id === "L-6") {
    // 出力途中切れ: S-1 の参照配置を途中で切った形。
    const truncated = REFERENCE_PLACEMENTS["S-1"].slice(0, 120);
    probeFields = {
      probeAnswerKind: "truncated-placement",
      ...(await probe(fixture.id, message, plan, truncated, "truncated-placement")),
    };
  } else {
    probeFields = {
      probeAnswerKind: "empty",
      ...(await probe(fixture.id, message, plan, "", "empty")),
    };
  }
  results.push({
    id: fixture.id,
    group: fixture.group,
    expectation: fixture.expectation,
    mode: plan.mode,
    materialUnitCount: plan.materialUnitCount,
    deterministicOk: plan.deterministicAssembly?.ok ?? false,
    deterministicMissing,
    ...probeFields,
  });
}

// スモーク（固定12件の外。DG-1 窓の疎通確認と同じ文面）。
{
  const plan = planDeckRecordsRequest(SMOKE_MESSAGE);
  const probed = await probe(
    "SMOKE",
    SMOKE_MESSAGE,
    plan,
    SMOKE_PLACEMENT,
    "reference-placement",
  );
  results.push({
    id: "SMOKE",
    group: "smoke",
    expectation: "created",
    mode: plan.mode,
    materialUnitCount: plan.materialUnitCount,
    deterministicOk: plan.deterministicAssembly?.ok ?? false,
    deterministicMissing:
      plan.deterministicAssembly?.missing.map(
        (entry) => `${entry.code}x${entry.count}`,
      ) ?? [],
    probeAnswerKind: "reference-placement",
    ...probed,
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  note: "DG-1 修正のオフライン事前確認（受入証拠ではない）。参照配置はゲート適合可能性の確認用。",
  sufficientCreated:
    results.filter((r) => r.group === "sufficient" && r.probeStatus === "created")
      .length,
  sufficientTotal: results.filter((r) => r.group === "sufficient").length,
  insufficientNotCreated:
    results.filter(
      (r) => r.group === "insufficient" && r.probeStatus !== "created",
    ).length,
  insufficientTotal: results.filter((r) => r.group === "insufficient").length,
};
writeFileSync(
  join(outDir, "offline-precheck.json"),
  JSON.stringify({ summary, results }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
for (const r of results) {
  console.log(
    `${r.id}: mode=${r.mode} units=${r.materialUnitCount} detOk=${r.deterministicOk} probe=${r.probeStatus} missing=${r.probeMissingCodes.join(",") || "-"}`,
  );
}
