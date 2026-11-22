import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { generateArtifactV12 } from "./artifactGeneratorV12";
import {
  checkXmlWellFormed,
  crc32,
  decodeXmlEntities,
  estimatePptxTextOverflow,
  extractNumericTokens,
  extractXmlTextValues,
  inspectDocumentBytes,
  inspectOoxmlDocument,
  inspectPdfDocument,
  readZipArchive,
  reconcileNumericTokens,
} from "./documentInspectionV1";
import {
  DOCUMENT_INSPECTION_FIXTURE_CASES,
  documentInspectionFixtureCase,
} from "./documentInspectionFixturesV1";
import { makeUnicodePdfV12 } from "./unicodePdfV12";
import { zipStore } from "./zipStore";
import { buildProposalDeckChatArtifact } from "../legacy/originProposalDeckChat";

/** deflate 圧縮の ZIP を1エントリで作る（一般の OOXML 相当の読み取り確認用）。 */
function buildDeflatedZip(name: string, data: Buffer): Buffer {
  const compressed = deflateRawSync(data);
  const crc = crc32(data);
  const nameBuffer = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuffer.length, 12);
  end.writeUInt32LE(30 + nameBuffer.length + compressed.length, 16);
  return Buffer.concat([local, nameBuffer, compressed, central, nameBuffer, end]);
}

describe("readZipArchive", () => {
  it("zipStore の出力（stored）を CRC 照合つきで読み戻せる", () => {
    const zip = zipStore([
      { name: "a.txt", data: Buffer.from("hello", "utf8") },
      { name: "dir/b.xml", data: Buffer.from("<root/>", "utf8") },
    ]);
    const result = readZipArchive(zip);
    expect(result.ok).toBe(true);
    expect(result.entries.get("a.txt")?.toString("utf8")).toBe("hello");
    expect(result.entries.get("dir/b.xml")?.toString("utf8")).toBe("<root/>");
  });

  it("deflate 圧縮のエントリも読み戻せる", () => {
    const data = Buffer.from("<root><a>text</a></root>".repeat(20), "utf8");
    const result = readZipArchive(buildDeflatedZip("doc.xml", data));
    expect(result.ok).toBe(true);
    expect(result.entries.get("doc.xml")?.equals(data)).toBe(true);
  });

  it("データが壊れていると CRC 不一致で落ちる", () => {
    const zip = zipStore([{ name: "a.txt", data: Buffer.from("hello", "utf8") }]);
    const corrupted = Buffer.from(zip);
    corrupted[35] = corrupted[35] ^ 0xff; // ローカルヘッダ(30)+名前(5)の直後＝データ先頭
    const result = readZipArchive(corrupted);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("CRC");
  });

  it("ZIP でない入力と、途中で切れた入力を弾く", () => {
    expect(readZipArchive(Buffer.from("not a zip", "utf8")).ok).toBe(false);
    const zip = zipStore([{ name: "a.txt", data: Buffer.from("hello", "utf8") }]);
    expect(readZipArchive(zip.subarray(0, zip.length - 10)).ok).toBe(false);
  });
});

describe("checkXmlWellFormed / extractXmlTextValues", () => {
  it("宣言・コメント・CDATA・属性を含む整形式 XML を通す", () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><!-- c --><root a="1>2" b=\'x\'>' +
      "<a:t>値 &amp; 5</a:t><![CDATA[<not-a-tag>]]><empty/></root>";
    expect(checkXmlWellFormed(xml).ok).toBe(true);
  });

  it("タグの不一致・未閉鎖・不正な実体参照・属性内の < を検出する", () => {
    expect(checkXmlWellFormed("<root><a></root>").ok).toBe(false);
    expect(checkXmlWellFormed("<root><a>").ok).toBe(false);
    expect(checkXmlWellFormed("<root>&unknown;</root>").ok).toBe(false);
    expect(checkXmlWellFormed('<root a="1<2"/>').ok).toBe(false);
    expect(checkXmlWellFormed("<root/><root/>").ok).toBe(false);
  });

  it("指定ローカル名のテキストを実体デコードして抽出する", () => {
    const xml =
      '<p:sld xmlns:a="x"><a:t>月&amp;日</a:t><a:t>5万円</a:t><a:x>対象外</a:x></p:sld>';
    expect(extractXmlTextValues(xml, new Set(["t"]))).toEqual(["月&日", "5万円"]);
    expect(decodeXmlEntities("&#x41;&#66;")).toBe("AB");
  });
});

describe("数値抽出と全数照合", () => {
  it("全角・桁区切り・小数・末尾ゼロを正規化する（自己チェックと同一規則）", () => {
    expect(extractNumericTokens("月額５，０００円と2.90億円と007件")).toEqual([
      "5000",
      "2.9",
      "7",
    ]);
    expect(extractNumericTokens("数値なし")).toEqual([]);
  });

  it("多重集合で照合し、落ちた数値と増えた数値を数える", () => {
    const ok = reconcileNumericTokens(["売上は100万円と100万円"], ["100万円が100万円"]);
    expect(ok.ok).toBe(true);
    const diff = reconcileNumericTokens(["100万円と50万円"], ["100万円と80万円"]);
    expect(diff.ok).toBe(false);
    expect(diff.missing).toEqual([{ token: "80", count: 1 }]);
    expect(diff.unexpected).toEqual([{ token: "50", count: 1 }]);
    const dup = reconcileNumericTokens(["100"], ["100と100"]);
    expect(dup.missing).toEqual([{ token: "100", count: 1 }]);
  });
});

function deckBytes(caseId: string): Buffer {
  const fixture = documentInspectionFixtureCase(caseId);
  const outcome = buildProposalDeckChatArtifact(fixture.sampleAnswer);
  if (outcome.status !== "created") throw new Error(`case ${caseId} did not create a deck`);
  return Buffer.from(outcome.artifact.data, "base64");
}

describe("inspectOoxmlDocument（実生成ファイル）", () => {
  it("生成した PPTX を開け、スライド数とテキストが取れる", () => {
    const inspection = inspectOoxmlDocument(deckBytes("S-1"), "pptx");
    expect(inspection.ok).toBe(true);
    expect(inspection.slideCount).toBe(8);
    expect(inspection.allText).toContain("SeisanPro");
    expect(inspection.malformedParts).toEqual([]);
  });

  it("スライド XML が壊れていると、該当パーツを名指しで検出する", () => {
    const zip = readZipArchive(deckBytes("S-1"));
    expect(zip.ok).toBe(true);
    const entries = [...zip.entries.entries()].map(([name, data]) => ({
      name,
      data:
        name === "ppt/slides/slide1.xml"
          ? Buffer.from("<p:sld><broken></p:sld>", "utf8")
          : data,
    }));
    const inspection = inspectOoxmlDocument(zipStore(entries), "pptx");
    expect(inspection.ok).toBe(false);
    expect(inspection.malformedParts.map((item) => item.part)).toContain(
      "ppt/slides/slide1.xml",
    );
  });

  it("必須パーツの欠落を検出する", () => {
    const zip = zipStore([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>", "utf8") },
    ]);
    const inspection = inspectOoxmlDocument(zip, "pptx");
    expect(inspection.ok).toBe(false);
    expect(inspection.errors.join(" ")).toContain("ppt/presentation.xml");
  });

  it("V12 生成器の XLSX／DOCX を開けて数値照合できる", async () => {
    const xlsx = generateArtifactV12({
      type: "xlsx",
      title: "検査",
      rows: [
        ["項目", "金額"],
        ["売上", 8400],
      ],
    });
    const xlsxInspection = await inspectDocumentBytes(xlsx.bytes, "xlsx", ["売上 8400"]);
    expect(xlsxInspection.openOk).toBe(true);
    expect(xlsxInspection.ooxml?.sheetCount).toBe(1);
    expect(xlsxInspection.numeric?.stage).toBe("done");
    if (xlsxInspection.numeric?.stage === "done") {
      expect(xlsxInspection.numeric.result.ok).toBe(true);
    }

    const docx = generateArtifactV12({
      type: "docx",
      title: "検査文書",
      content: "売上は8400万円です。",
    });
    const docxInspection = await inspectDocumentBytes(docx.bytes, "docx", ["8400万円"]);
    expect(docxInspection.openOk).toBe(true);
    expect(docxInspection.numeric?.stage).toBe("done");
    if (docxInspection.numeric?.stage === "done") {
      expect(docxInspection.numeric.result.ok).toBe(true);
    }
  });
});

describe("estimatePptxTextOverflow", () => {
  it("生成したデッキでは、はみ出し見込みの図形が無い", () => {
    const report = estimatePptxTextOverflow(deckBytes("S-3"));
    expect(report.estimates.length).toBeGreaterThan(0);
    expect(report.overflowing).toEqual([]);
  });

  function slideZip(shapeXml: string): Buffer {
    return zipStore([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>", "utf8") },
      {
        name: "ppt/presentation.xml",
        data: Buffer.from("<p:presentation/>", "utf8"),
      },
      {
        name: "ppt/slides/slide1.xml",
        data: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?><p:sld><p:cSld><p:spTree>${shapeXml}</p:spTree></p:cSld></p:sld>`,
          "utf8",
        ),
      },
    ]);
  }

  function shape(name: string, cy: number, text: string): string {
    return (
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="${cy}"/></a:xfrm></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>` +
      `<a:p><a:pPr><a:lnSpc><a:spcPct val="125000"/></a:lnSpc></a:pPr>` +
      `<a:r><a:rPr lang="ja-JP" sz="1800"/><a:t>${text}</a:t></a:r><a:endParaRPr sz="1800"/></a:p>` +
      `</p:txBody></p:sp>`
    );
  }

  it("小さな図形に長いテキストがある場合はみ出しを検出する", () => {
    const longText = "これは見積もり確認のための長いテキストです。".repeat(4);
    const report = estimatePptxTextOverflow(slideZip(shape("狭い図形", 127000, longText)));
    expect(report.overflowing.length).toBe(1);
    expect(report.overflowing[0].shapeName).toBe("狭い図形");
    expect(report.overflowing[0].overflowPt).toBeGreaterThan(2);
  });

  it("十分な高さがある図形ははみ出さない", () => {
    const report = estimatePptxTextOverflow(slideZip(shape("広い図形", 6858000, "短い文です。")));
    expect(report.overflowing).toEqual([]);
    expect(report.estimates.length).toBe(1);
  });
});

describe("inspectPdfDocument", () => {
  it("生成した PDF を実パーサで開ける", async () => {
    const pdf = await makeUnicodePdfV12("検査タイトル", "売上は8400万円です。");
    const inspection = await inspectPdfDocument(pdf);
    expect(inspection.ok).toBe(true);
    expect(inspection.pageCount).toBeGreaterThanOrEqual(1);
    expect(inspection.pageSizesPt.length).toBe(inspection.pageCount);
  }, 60000);

  it("壊れた入力を弾き、統合検査では数値ステージが unsupported になる", async () => {
    const broken = await inspectPdfDocument(Buffer.from("%PDF- broken", "utf8"));
    expect(broken.ok).toBe(false);
    const pdf = await makeUnicodePdfV12("検査", "本文です。");
    const unified = await inspectDocumentBytes(pdf, "pdf", ["本文"]);
    expect(unified.openOk).toBe(true);
    expect(unified.numeric?.stage).toBe("unsupported");
  }, 60000);
});

/**
 * DG-0 ベースラインの固定（旧経路の現在の挙動）。
 * ここの期待値は「望ましい結果」ではなく、現行本番経路（旧経路）の実測の固定である。
 * 挙動が変わったら、ベースライン記録（DOCUMENT_INSPECTION_BASELINE）と一緒に
 * 意図して更新すること。特に不足素材群で「作成される」ケースは誤作成の記録であり、
 * レコード経路（DG-1）では全て not-created になることが合格条件になる。
 */
describe("評価集合フィクスチャ（DG-0 ベースラインの固定）", () => {
  it("ケースは12件（十分6・不足6）で ID が一意", () => {
    expect(DOCUMENT_INSPECTION_FIXTURE_CASES.length).toBe(12);
    expect(
      new Set(DOCUMENT_INSPECTION_FIXTURE_CASES.map((item) => item.id)).size,
    ).toBe(12);
    expect(
      DOCUMENT_INSPECTION_FIXTURE_CASES.filter((item) => item.group === "sufficient")
        .length,
    ).toBe(6);
  });

  for (const fixture of DOCUMENT_INSPECTION_FIXTURE_CASES.filter(
    (item) => item.group === "sufficient",
  )) {
    it(`${fixture.id}（${fixture.briefName}）: 作成され、開けて、数値が全数一致する`, async () => {
      const outcome = buildProposalDeckChatArtifact(fixture.sampleAnswer);
      expect(outcome.status).toBe("created");
      if (outcome.status !== "created") return;
      const bytes = Buffer.from(outcome.artifact.data, "base64");
      const inspection = await inspectDocumentBytes(bytes, "pptx", [fixture.sampleAnswer]);
      expect(inspection.openOk).toBe(true);
      expect(inspection.numeric?.stage).toBe("done");
      if (inspection.numeric?.stage === "done") {
        expect(inspection.numeric.result.ok).toBe(true);
      }
      expect(inspection.overflow?.overflowing).toEqual([]);
      // 起草の忠実度: 回答が素材に無い数値を持ち込んでいないこと（種類ベース）。
      const answerNumbers = new Set(extractNumericTokens(fixture.sampleAnswer));
      const materialNumbers = new Set(extractNumericTokens(fixture.materialsText));
      const introduced = [...answerNumbers].filter((token) => !materialNumbers.has(token));
      expect(introduced).toEqual([]);
    });
  }

  it("L-1（丸投げ）と L-6（途中切れ）は作成されない", () => {
    for (const id of ["L-1", "L-6"]) {
      const fixture = documentInspectionFixtureCase(id);
      expect(buildProposalDeckChatArtifact(fixture.sampleAnswer).status).toBe("failed");
    }
  });

  it("L-2・L-3・L-4・L-5 は現行の旧経路では作成されてしまう（誤作成のベースライン）", () => {
    for (const id of ["L-2", "L-3", "L-4", "L-5"]) {
      const fixture = documentInspectionFixtureCase(id);
      expect(buildProposalDeckChatArtifact(fixture.sampleAnswer).status).toBe("created");
    }
  });

  it("L-4 は素材に無い数値を回答が持ち込む（起草側の信号）", () => {
    const fixture = documentInspectionFixtureCase("L-4");
    const answerNumbers = new Set(extractNumericTokens(fixture.sampleAnswer));
    const materialNumbers = new Set(extractNumericTokens(fixture.materialsText));
    const introduced = [...answerNumbers].filter((token) => !materialNumbers.has(token));
    expect(introduced).toContain("3000");
    expect(introduced).toContain("24");
  });

  it("L-5 は数値照合だけでは検出できない（意味の混同は監査の領分）", async () => {
    const fixture = documentInspectionFixtureCase("L-5");
    const outcome = buildProposalDeckChatArtifact(fixture.sampleAnswer);
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    const bytes = Buffer.from(outcome.artifact.data, "base64");
    const inspection = await inspectDocumentBytes(bytes, "pptx", [fixture.sampleAnswer]);
    expect(inspection.numeric?.stage).toBe("done");
    if (inspection.numeric?.stage === "done") {
      // 月額/年額を取り違えても数値の集合は一致してしまう、という限界の固定。
      expect(inspection.numeric.result.ok).toBe(true);
    }
  });
});
