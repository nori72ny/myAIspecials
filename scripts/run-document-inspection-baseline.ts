/**
 * DG-0 ベースライン測定ランナー — 評価集合（固定フィクスチャ）を現行本番経路
 * （旧経路: buildProposalDeckChatArtifact）で実行し、実ファイル検査ハーネスの
 * 結果をベースラインとして記録する。
 *
 * 設計の正本: ~/workspace/origin-fix/DOCUMENT_GENERATION_PROGRAM_2026-11-22.md §5 DG-0
 * 使い方: npx tsx scripts/run-document-inspection-baseline.ts [--out-dir <dir>] [--no-render]
 * - 測定でありゲートではないため、結果にかかわらず終了コードは 0。
 * - レンダリング検査（LibreOffice で画像化）は能力検出つき: soffice／pdftoppm が
 *   無い環境では stage を "unavailable" と記録し、合格とは書かない。
 * - 費用 $0・外部送信なし・本番経路には接続しない。
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  extractNumericTokens,
  inspectDocumentBytes,
  type DocumentInspection,
} from "../src/artifacts/documentInspectionV1.js";
import {
  DOCUMENT_INSPECTION_FIXTURE_CASES,
  type DocumentInspectionFixtureCase,
} from "../src/artifacts/documentInspectionFixturesV1.js";
import { buildProposalDeckChatArtifact } from "../src/legacy/originProposalDeckChat.js";

const execFileAsync = promisify(execFile);

interface RenderStageResult {
  stage: "done" | "unavailable" | "failed";
  reason?: string;
  pdfPages?: number;
  slideCount?: number | null;
  pagesMatchSlides?: boolean;
  inkCoverageByPage?: number[];
  blankPages?: number[];
}

interface CaseResult {
  id: string;
  group: DocumentInspectionFixtureCase["group"];
  briefName: string;
  expectation: DocumentInspectionFixtureCase["expectation"];
  outcome: "created" | "failed";
  failureCode?: string;
  violationCodes?: string[];
  matchesExpectation: boolean;
  inspection?: {
    openOk: boolean;
    slideCount: number | null;
    numericOk: boolean | null;
    numericMissing: Array<{ token: string; count: number }>;
    numericUnexpected: Array<{ token: string; count: number }>;
    overflowingShapes: number;
    estimatedShapes: number;
  };
  /** 起草の忠実度（種類ベース）: 回答が素材に無い持ち込んだ数値。 */
  answerIntroducedNumbers: string[];
  render?: RenderStageResult;
}

async function commandExists(name: string): Promise<boolean> {
  try {
    await execFileAsync("which", [name]);
    return true;
  } catch {
    return false;
  }
}

/** P6 PPM を読み、「インク被覆率」（白でない画素の割合）を返す。 */
function ppmInkCoverage(buffer: Buffer): number {
  let index = 0;
  const tokens: string[] = [];
  const isWhitespace = (byte: number) =>
    byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
  while (tokens.length < 4) {
    while (index < buffer.length) {
      const byte = buffer[index];
      if (byte === 0x23) {
        while (index < buffer.length && buffer[index] !== 0x0a) index++;
      } else if (isWhitespace(byte)) {
        index++;
      } else {
        break;
      }
    }
    const start = index;
    while (index < buffer.length && !isWhitespace(buffer[index])) index++;
    tokens.push(buffer.subarray(start, index).toString("latin1"));
  }
  index++; // 最大値の直後の区切り（空白1文字）でヘッダ終了
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const maxValue = Number(tokens[3]);
  if (tokens[0] !== "P6" || !Number.isFinite(width) || !Number.isFinite(height) || maxValue !== 255) {
    throw new Error("unsupported PPM header");
  }
  const pixels = width * height;
  let ink = 0;
  for (let p = 0; p < pixels; p++) {
    const offset = index + p * 3;
    if (
      buffer[offset] < 245 ||
      buffer[offset + 1] < 245 ||
      buffer[offset + 2] < 245
    ) {
      ink++;
    }
  }
  return Math.round((ink / pixels) * 10000) / 10000;
}

async function renderStage(
  pptxPath: string,
  workDir: string,
  slideCount: number | null,
): Promise<RenderStageResult> {
  const hasSoffice = await commandExists("soffice");
  const hasPdftoppm = await commandExists("pdftoppm");
  if (!hasSoffice || !hasPdftoppm) {
    return {
      stage: "unavailable",
      reason: `soffice=${hasSoffice} pdftoppm=${hasPdftoppm}`,
    };
  }
  try {
    const profileDir = join(workDir, "lo-profile");
    await mkdir(profileDir, { recursive: true });
    await execFileAsync(
      "soffice",
      [
        "--headless",
        "--norestore",
        `-env:UserInstallation=file://${profileDir}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        pptxPath,
      ],
      { timeout: 180000 },
    );
    const pdfName = (await readdir(workDir)).find((name) => name.endsWith(".pdf"));
    if (!pdfName) return { stage: "failed", reason: "LibreOffice produced no PDF" };
    const pdfPath = join(workDir, pdfName);
    // 注: poppler 24.02 では PPM が既定出力で -ppm フラグ自体が無い。
    await execFileAsync(
      "pdftoppm",
      ["-r", "60", pdfPath, join(workDir, "page")],
      { timeout: 180000 },
    );
    const pageFiles = (await readdir(workDir))
      .filter((name) => /^page-\d+\.ppm$/.test(name))
      .sort();
    const inkCoverageByPage: number[] = [];
    const blankPages: number[] = [];
    for (const [index, name] of pageFiles.entries()) {
      const coverage = ppmInkCoverage(await readFile(join(workDir, name)));
      inkCoverageByPage.push(coverage);
      if (coverage < 0.001) blankPages.push(index + 1);
    }
    return {
      stage: "done",
      pdfPages: pageFiles.length,
      slideCount,
      pagesMatchSlides: slideCount === null ? undefined : pageFiles.length === slideCount,
      inkCoverageByPage,
      blankPages,
    };
  } catch (error) {
    return {
      stage: "failed",
      reason: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}

function introducedNumbers(fixture: DocumentInspectionFixtureCase): string[] {
  const answerNumbers = new Set(extractNumericTokens(fixture.sampleAnswer));
  const materialNumbers = new Set(extractNumericTokens(fixture.materialsText));
  return [...answerNumbers]
    .filter((token) => !materialNumbers.has(token))
    .sort((a, b) => Number(a) - Number(b));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outDirIndex = args.indexOf("--out-dir");
  const outDir =
    outDirIndex >= 0 ? args[outDirIndex + 1] : "test-results/document-inspection";
  const noRender = args.includes("--no-render");
  await mkdir(join(outDir, "artifacts"), { recursive: true });

  const results: CaseResult[] = [];
  for (const fixture of DOCUMENT_INSPECTION_FIXTURE_CASES) {
    const outcome = buildProposalDeckChatArtifact(fixture.sampleAnswer);
    const base: CaseResult = {
      id: fixture.id,
      group: fixture.group,
      briefName: fixture.briefName,
      expectation: fixture.expectation,
      outcome: outcome.status === "created" ? "created" : "failed",
      matchesExpectation:
        (outcome.status === "created") === (fixture.expectation === "created"),
      answerIntroducedNumbers: introducedNumbers(fixture),
    };
    if (outcome.status === "failed") {
      base.failureCode = outcome.failureCode;
      base.violationCodes = outcome.violationCodes ? [...outcome.violationCodes] : [];
      results.push(base);
      continue;
    }
    const bytes = Buffer.from(outcome.artifact.data, "base64");
    const pptxPath = join(outDir, "artifacts", `${fixture.id}.pptx`);
    await writeFile(pptxPath, bytes);
    const inspection: DocumentInspection = await inspectDocumentBytes(bytes, "pptx", [
      fixture.sampleAnswer,
    ]);
    base.inspection = {
      openOk: inspection.openOk,
      slideCount: inspection.ooxml?.slideCount ?? null,
      numericOk:
        inspection.numeric?.stage === "done" ? inspection.numeric.result.ok : null,
      numericMissing:
        inspection.numeric?.stage === "done" ? inspection.numeric.result.missing : [],
      numericUnexpected:
        inspection.numeric?.stage === "done" ? inspection.numeric.result.unexpected : [],
      overflowingShapes: inspection.overflow?.overflowing.length ?? 0,
      estimatedShapes: inspection.overflow?.estimates.length ?? 0,
    };
    if (!noRender) {
      const workDir = await mkdtemp(join(tmpdir(), `dg0-render-${fixture.id}-`));
      base.render = await renderStage(
        pptxPath,
        workDir,
        inspection.ooxml?.slideCount ?? null,
      );
    }
    results.push(base);
  }

  const sufficient = results.filter((item) => item.group === "sufficient");
  const insufficient = results.filter((item) => item.group === "insufficient");
  const createdCount = (items: CaseResult[]) =>
    items.filter((item) => item.outcome === "created").length;
  const failureShapes: Record<string, number> = {};
  for (const item of results) {
    if (item.outcome === "failed" && item.failureCode) {
      failureShapes[item.failureCode] = (failureShapes[item.failureCode] ?? 0) + 1;
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    path: "legacy (buildProposalDeckChatArtifact)",
    totalCases: results.length,
    sufficient: {
      cases: sufficient.length,
      created: createdCount(sufficient),
      completionRate: sufficient.length
        ? createdCount(sufficient) / sufficient.length
        : 0,
    },
    insufficient: {
      cases: insufficient.length,
      created: createdCount(insufficient),
      falseCreationRate: insufficient.length
        ? createdCount(insufficient) / insufficient.length
        : 0,
      correctlyStopped: insufficient.length - createdCount(insufficient),
    },
    failureShapes,
    numericReconciliationOk: results.filter(
      (item) => item.inspection?.numericOk === true,
    ).length,
    openCheckOk: results.filter((item) => item.inspection?.openOk === true).length,
    overflowingShapesTotal: results.reduce(
      (sum, item) => sum + (item.inspection?.overflowingShapes ?? 0),
      0,
    ),
    renderStage: noRender
      ? "skipped (--no-render)"
      : results.some((item) => item.render?.stage === "done")
        ? "done"
        : results.some((item) => item.render?.stage === "failed")
          ? "failed"
          : "unavailable",
  };

  await writeFile(
    join(outDir, "baseline.json"),
    JSON.stringify({ summary, results }, null, 2),
    "utf8",
  );

  const lines: string[] = [
    "# DG-0 ベースライン（現行本番経路＝旧経路、固定の代表回答で測定）",
    "",
    `- 測定日時: ${summary.generatedAt}`,
    `- 十分な素材群: 完成率 ${summary.sufficient.created}/${summary.sufficient.cases} = ${Math.round(summary.sufficient.completionRate * 1000) / 10}%`,
    `- 不足素材群: 誤作成 ${summary.insufficient.created}/${summary.insufficient.cases}（誤作成率 ${Math.round(summary.insufficient.falseCreationRate * 1000) / 10}%）、正しく停止 ${summary.insufficient.correctlyStopped}件`,
    `- 失敗形状: ${Object.entries(failureShapes).map(([code, count]) => `${code} ×${count}`).join("、") || "なし"}`,
    `- 実ファイル検査: 開ける ${summary.openCheckOk}件 / 数値照合OK ${summary.numericReconciliationOk}件 / はみ出し見込み 合計 ${summary.overflowingShapesTotal}件`,
    `- レンダリング検査: ${summary.renderStage}`,
    "",
    "| ケース | 群 | 期待 | 結果 | スライド | 数値照合 | はみ出し | レンダリング |",
    "|---|---|---|---|---|---|---|---|",
    ...results.map((item) => {
      const render =
        item.render?.stage === "done"
          ? `PDF ${item.render.pdfPages}頁・空白頁 ${item.render.blankPages?.length ?? 0}`
          : (item.render?.stage ?? "-");
      return `| ${item.id} ${item.briefName} | ${item.group} | ${item.expectation} | ${item.outcome}${item.failureCode ? ` (${item.failureCode})` : ""} | ${item.inspection?.slideCount ?? "-"} | ${item.inspection ? (item.inspection.numericOk ? "OK" : "不一致") : "-"} | ${item.inspection?.overflowingShapes ?? "-"} | ${render} |`;
    }),
    "",
  ];
  await writeFile(join(outDir, "baseline.md"), lines.join("\n"), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
