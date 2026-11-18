import { describe, expect, it, vi } from "vitest";
import {
  detectOriginPublicationClaims,
  logOriginPublicationGateShadow,
  type OriginPublicationClaimKind,
} from "./OriginPublicationGate";
import { JAPANESE_LAW_NAMES } from "./japaneseLawNames";

// Unit tests for the direct-answer publication gate detector (stage 1,
// shadow mode). The detector is deterministic: these tests pin the
// claim-shape patterns, the statute-name extraction rules, and the
// e-Gov list check (adoption 2 of EXTERNAL_CONSULT_STALE_ADOPTION
// _2026-11-17). Behaviour on real measured answers lives in the
// fixture test next to this file.

function countsOf(text: string) {
  return detectOriginPublicationClaims(text).counts;
}
function kindCount(text: string, kind: OriginPublicationClaimKind) {
  return countsOf(text)[kind];
}

describe("detectOriginPublicationClaims — claim shapes", () => {
  it("detects a statutory capacity tied to a legislative body (D-15 shape)", () => {
    const summary = detectOriginPublicationClaims("衆議院は465名、参議院は245名です。");
    expect(summary.counts["statutory-capacity"]).toBe(2);
  });

  it("detects a statutory capacity tied to a capacity keyword", () => {
    expect(kindCount("参議院の定数は248名です。", "statutory-capacity")).toBe(1);
    expect(kindCount("この教室の定員は40人です。", "statutory-capacity")).toBe(1);
  });

  it("detects the P-02 wording: bare 議員 keyword and 人 unit (G1)", () => {
    // The exact delivered text of expansion run P-02 run3. Before G1 it
    // matched neither pattern: no 数 keyword for the keyword pattern and
    // no 名／議席 unit for the institution-anchor pattern. Both patterns
    // now reach it; their overlapping spans merge into one claim.
    expect(kindCount("参議院の議員は242人です。", "statutory-capacity")).toBe(1);
    // Each widened pattern also reaches the shape on its own.
    expect(kindCount("議員は242人です。", "statutory-capacity")).toBe(1);
    expect(kindCount("参議院は248人です。", "statutory-capacity")).toBe(1);
    expect(kindCount("委員会の委員は12人です。", "statutory-capacity")).toBe(1);
    // The gate stops unverified assertions, not wrong ones: the correct
    // current figure fires in exactly the same way.
    expect(kindCount("参議院の議員は248人です。", "statutory-capacity")).toBe(1);
  });

  it("detects age conditions and merges overlapping spans", () => {
    // 満20歳 and 20歳以上 overlap; they are one claim, counted once.
    expect(kindCount("10年用は満20歳以上で取得できます。", "age-condition")).toBe(1);
    expect(kindCount("20歳未満の方は申請できません。", "age-condition")).toBe(1);
    expect(kindCount("対象は18歳からです。", "age-condition")).toBe(1);
    expect(kindCount("65歳以下の方が対象です。", "age-condition")).toBe(1);
  });

  it("detects amounts and fees", () => {
    expect(kindCount("手数料は16,000円です。", "amount-fee")).toBe(1);
    expect(kindCount("予算は30万円で、ドル換算では350ドルです。", "amount-fee")).toBe(2);
  });

  it("detects enforcement-date assertions", () => {
    expect(kindCount("この法律は2021年4月1日から施行されました。", "law-enforcement")).toBe(1);
    expect(kindCount("施行日は2020年4月1日です。", "law-enforcement")).toBe(1);
    expect(kindCount("2019年に施行された制度です。", "law-enforcement")).toBe(1);
  });

  it("does not fire enforcement for a bare 施行令／施行規則 mention", () => {
    expect(kindCount("詳細は施行令で定められています。", "law-enforcement")).toBe(0);
  });

  it("detects position/status assertions", () => {
    expect(kindCount("現在の内閣総理大臣は次の通りです。首相は記者会見で述べた。", "position-status")).toBe(2);
  });

  it("returns spans only — hits never carry matched text", () => {
    const summary = detectOriginPublicationClaims("参議院の定数は245名です。デジタル資産保護法は2021年4月1日から施行されました。");
    expect(summary.totalCount).toBeGreaterThan(0);
    for (const hit of summary.hits) {
      expect(Object.keys(hit).sort()).toEqual(["index", "kind", "length"]);
    }
  });

  it("handles empty and claim-free text", () => {
    const empty = detectOriginPublicationClaims("");
    expect(empty.totalCount).toBe(0);
    expect(empty.lawCheck).toEqual({ candidateCount: 0, verifiedCount: 0, unverifiedCount: 0 });
    expect(detectOriginPublicationClaims("今日は良い天気ですね。散歩に行きましょう。").totalCount).toBe(0);
  });
});

describe("statute-name check against the bundled e-Gov list", () => {
  it("verifies real statute names", () => {
    for (const name of ["労働基準法", "公職選挙法", "旅券法", "民法", "刑法", "商法", "日本国憲法", "道路交通法", "借地借家法"]) {
      const summary = detectOriginPublicationClaims(`${name}では次のように定められています。`);
      expect(summary.lawCheck, name).toEqual({ candidateCount: 1, verifiedCount: 1, unverifiedCount: 0 });
    }
  });

  it("verifies well-known aliases and short forms", () => {
    for (const alias of ["労基法", "基準法", "労契法", "公選法", "選挙法", "独禁法", "均等法", "個人情報保護法", "資金決済法", "外為法", "金商法", "景表法", "特商法", "入管法", "マイナンバー法", "プロバイダ責任制限法", "労働者派遣法", "パートタイム労働法", "憲法"]) {
      const summary = detectOriginPublicationClaims(`${alias}の規定によります。`);
      expect(summary.lawCheck.verifiedCount, alias).toBe(1);
      expect(summary.lawCheck.unverifiedCount, alias).toBe(0);
    }
  });

  it("verifies temporal variants of real statutes （旧民法・改正民法・旧商法）", () => {
    for (const variant of ["旧民法", "改正民法", "旧商法"]) {
      const summary = detectOriginPublicationClaims(`${variant}の規定ではそうなっていました。`);
      expect(summary.lawCheck.unverifiedCount, variant).toBe(0);
    }
  });

  it("checks 施行令／施行規則 citations by their base statute", () => {
    const summary = detectOriginPublicationClaims("手続きは旅券法施行令と公職選挙法施行規則に定められています。");
    expect(summary.lawCheck.candidateCount).toBe(2);
    expect(summary.lawCheck.verifiedCount).toBe(2);
    expect(summary.lawCheck.unverifiedCount).toBe(0);
  });

  it("flags a fabricated statute as unverified — never as nonexistent (I-04 shape)", () => {
    const summary = detectOriginPublicationClaims("デジタル資産保護法は、2021年4月1日から施行された日本の法令です。");
    expect(summary.counts["law-name"]).toBe(1);
    expect(summary.counts["law-enforcement"]).toBe(1);
    expect(summary.lawCheck).toEqual({ candidateCount: 1, verifiedCount: 0, unverifiedCount: 1 });
  });

  it("does not treat non-law 法 words as statute candidates", () => {
    const text = "この計算方法と英文法を確認し、対処法をまとめました。ポモドーロ法も有効です。理学療法の説明も含まれます。";
    const summary = detectOriginPublicationClaims(text);
    expect(summary.lawCheck.candidateCount).toBe(0);
  });

  it("does not treat field-of-law names as statute candidates", () => {
    const summary = detectOriginPublicationClaims("労働法の分野では、税法や行政法も関係します。");
    expect(summary.lawCheck.candidateCount).toBe(0);
  });

  it("does not treat law-firm names as statute candidates", () => {
    const summary = detectOriginPublicationClaims("弁護士法人デイライト法律事務所や浅野総合法律事務所に相談できます。");
    expect(summary.lawCheck.candidateCount).toBe(0);
  });

  it("finds the statute name at the correct boundary after particles", () => {
    const summary = detectOriginPublicationClaims("2019年の公職選挙法改正により設定されました。");
    expect(summary.lawCheck).toEqual({ candidateCount: 1, verifiedCount: 1, unverifiedCount: 0 });
  });

  it("bundles a substantial current-law list with provenance", () => {
    expect(JAPANESE_LAW_NAMES.length).toBeGreaterThan(2_000);
    expect(JAPANESE_LAW_NAMES).toContain("労働基準法");
    expect(JAPANESE_LAW_NAMES).not.toContain("デジタル資産保護法");
  });
});

describe("logOriginPublicationGateShadow", () => {
  it("logs kinds and counts only — never the answer text", () => {
    const logger = vi.fn();
    const sentinel = "秘密のセンチネル文字列";
    const summary = logOriginPublicationGateShadow({
      requestId: "req-1",
      answerText: `${sentinel} デジタル資産保護法は2021年4月1日から施行されました。定数は245名です。`,
      logger,
    });
    expect(summary).not.toBeNull();
    expect(logger).toHaveBeenCalledTimes(1);
    const [message, fields] = logger.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("publication gate (shadow)");
    expect(fields.requestId).toBe("req-1");
    expect(fields.publicationGateLawNameCount).toBe(1);
    expect(fields.publicationGateLawEnforcementCount).toBe(1);
    expect(fields.publicationGateStatutoryCapacityCount).toBe(1);
    expect(fields.lawNameUnverifiedCount).toBe(1);
    expect(JSON.stringify(fields)).not.toContain(sentinel);
    expect(JSON.stringify(fields)).not.toContain("デジタル資産保護法");
  });

  it("logs a zero summary for a claim-free answer", () => {
    const logger = vi.fn();
    logOriginPublicationGateShadow({ requestId: "req-2", answerText: "こんにちは。", logger });
    const [, fields] = logger.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields.publicationGateTotalCount).toBe(0);
    expect(fields.lawNameCandidateCount).toBe(0);
  });

  it("never throws: a detector failure is logged and detection is skipped", () => {
    const logger = vi.fn();
    const evil = { get length(): number { throw new Error("boom"); } } as unknown as string;
    const summary = logOriginPublicationGateShadow({ requestId: "req-3", answerText: evil, logger });
    expect(summary).toBeNull();
    const [message, fields] = logger.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("publication gate (shadow) failed");
    expect(fields.gateError).toBe("Error");
  });
});
