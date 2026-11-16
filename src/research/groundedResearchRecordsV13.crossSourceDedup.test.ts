import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import { GROUNDED_RESEARCH_FACT_SLOT_ENTRIES } from "./groundedResearchFactSlotsV13";
import {
  buildGroundedResearchRecordsPacket,
  checkGroundedResearchRenderedAnswer,
  evaluateGroundedResearchFactSlot,
  renderGroundedResearchFactSlotAnswer,
  renderGroundedResearchFactSlotSentence,
  renderGroundedResearchRecordsAnswer,
  renderGroundedResearchRecomposedAnswer,
  type GroundedResearchAcceptedRecord,
  type GroundedResearchRecordsPacket,
} from "./groundedResearchRecordsV13";

// R-PR-9f (RPR9_MEASUREMENT_ADJUDICATION_2026-11-16): the
// cross-source duplicate layer of the rendering-stage claim dedup.
// The merge fixtures are the restatement pairs actually observed
// in the 2026-11-16 re-measurement (answers.json of
// rpr9-measurement-2026-11-16), where the same claim arrived as
// independent source excerpts whose surface overlap is far too
// dilute for the R-PR-9e semantic layer (skeleton Dice 0.34–0.78):
// B-01 (filing period, two phrasings), B-05 (resident tax base,
// one phrasing carrying a bracketed period spelling), B-06 (salt
// targets, three excerpts including a truncated table fragment),
// B-10 (vaccination start), and B-04 (the slot headline restated
// by a support bullet). The keep fixtures pin the false-kill
// guards: a substituted single-digit value, a different claim on
// the same subject, the different-taxes-same-dates pair (held by
// the subject-tax veto), and different values in the same frame.
// Claim texts and source URLs are the measurement's own; source
// ids follow this file's packet order.

function makeSource(overrides: Partial<OriginResearchSource> = {}): OriginResearchSource {
  return {
    title: "Source title",
    url: "https://example.com/article",
    excerpt: "これは十分な長さの最初の文です。次も十分な長さの文です。",
    sourceType: "web-search",
    domain: "example.com",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-15T10:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "unclassified",
    ...overrides,
  };
}

interface FixtureSource {
  url: string;
  domain: string;
  text: string;
}

function packetOf(sources: readonly FixtureSource[]): GroundedResearchRecordsPacket {
  return buildGroundedResearchRecordsPacket(
    sources.map((source) =>
      makeSource({
        url: source.url,
        domain: source.domain,
        excerpt: `${source.text}詳しくは本文を確認してください。`,
      }),
    ),
  );
}

function recordOf(source: FixtureSource, index: number): GroundedResearchAcceptedRecord {
  return {
    sourceId: `S${index + 1}`,
    sourceIndex: index,
    evidenceIds: [],
    quote: source.text,
    text: source.text,
    quoteStart: 0,
  };
}

function renderFixture(sources: readonly FixtureSource[]): {
  packet: GroundedResearchRecordsPacket;
  accepted: GroundedResearchAcceptedRecord[];
  rendered: string;
} {
  const packet = packetOf(sources);
  const accepted = sources.map((source, index) => recordOf(source, index));
  return { packet, accepted, rendered: renderGroundedResearchRecordsAnswer(accepted, packet, "ja") };
}

function bodyBullets(rendered: string): string[] {
  const listStart = rendered.indexOf("\n## 出典");
  const body = listStart >= 0 ? rendered.slice(0, listStart) : rendered;
  return body.split("\n").filter((line) => line.startsWith("- "));
}

// B-01 (measurement tags S3 / S4): the filing period stated by two
// independent excerpts with almost no shared framing.
const B01_SOURCES: FixtureSource[] = [
  {
    url: "https://smbiz.asahi.com/article/16405783",
    domain: "smbiz.asahi.com",
    text: "税目による違い 所得税及び復興特別所得税の申告期間は、原則として翌年の2月16日から3月15日までですが、土日祝日の関係で年によって前後します。",
  },
  {
    url: "https://www.yayoi-kk.co.jp/shinkoku/oyakudachi/kikan",
    domain: "yayoi-kk.co.jp",
    text: "この金額を、例年2月16日～3月15日（土日祝の場合は翌平日）の間に申告します。",
  },
];

// B-05 (measurement tags S1 / S3): the resident-tax base, the
// second phrasing spelling the period out in a bracketed span.
const B05_SOURCES: FixtureSource[] = [
  {
    url: "https://www.city.hidaka.lg.jp/soshiki/somu/zeimu/shiminzei/zeikin/shikemminzei/28601.html",
    domain: "city.hidaka.lg.jp",
    text: "住民税は前年中の所得に基づいて課税されます。",
  },
  {
    url: "https://www.aizawasec-univ.jp/article/topic_42.html",
    domain: "aizawasec-univ.jp",
    text: "住民税は前年（1月〜12月）の所得を基に計算されます。",
  },
];

// B-06 (measurement tags S1 / S3 / S4): the salt targets stated by
// three excerpts — a municipal page, a ministry-attributed article
// (edition year in brackets), and a truncated table fragment whose
// bracketed age qualifiers and cut-off tail carry only part of the
// value signature.
const B06_SOURCES: FixtureSource[] = [
  {
    url: "https://www.city.kobe.lg.jp/a00685/kenko/health/promotion/eating/shokutokenko/select/salt.html",
    domain: "city.kobe.lg.jp",
    text: "1日あたりの塩分摂取目標量は、「成人男性：7.5グラム未満、成人女性：6.5グラム未満」です。",
  },
  {
    url: "https://wellness.nichirei.co.jp/contents/detail/6",
    domain: "wellness.nichirei.co.jp",
    text: "厚生労働省による「日本人の食事摂取基準（2025年度版）」によれば、推奨される1日の塩分量は男性で7.5g、女性で6.5g未満となっています。",
  },
  {
    url: "https://www.og-dm.jp/blog/too_much_salt",
    domain: "og-dm.jp",
    text: "■食塩相当量の摂取目標量（1日あたり） 男性（18歳以上）…7.5g未満 女性（18歳以上）…",
  },
];

// B-10 (measurement tags S3 / S4): the vaccination start stated by
// two clinics in different verb forms.
const B10_SOURCES: FixtureSource[] = [
  {
    url: "https://caps-clinic.jp/dr365/vaccine/baby-vaccine",
    domain: "caps-clinic.jp",
    text: "赤ちゃんの予防接種は生後2か月から始まります。",
  },
  {
    url: "https://shimokita-kids.com/blog/%E8%B5%A4%E3%81%A1%E3%82%83%E3%82%93%E3%81%AE%E3%83%AF%E3%82%AF%E3%83%81%E3%83%B3%E3%83%87%E3%83%93%E3%83%A5%E3%83%BC%E3%81%AF%E7%94%9F%E5%BE%8C2%E3%81%8B%E6%9C%88%E3%81%8B%E3%82%89%EF%BD%9C%E5%88%9D",
    domain: "shimokita-kids.com",
    text: "予防接種は生後2か月になった日から受けられます。",
  },
];

describe("cross-source claim dedup — measured restatements merge (R-PR-9f)", () => {
  it("merges the B-01 filing-period pair into one bullet with both citations", () => {
    const { packet, accepted, rendered } = renderFixture(B01_SOURCES);
    const bullets = bodyBullets(rendered);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain("[S1](https://smbiz.asahi.com/article/16405783)");
    expect(bullets[0]).toContain("[S2](https://www.yayoi-kk.co.jp/shinkoku/oyakudachi/kikan)");
    expect(renderGroundedResearchRecordsAnswer(accepted, packet, "ja")).toBe(rendered);
    expect(checkGroundedResearchRenderedAnswer(rendered, packet, accepted)).toEqual({ ok: true });
  });

  it("merges the B-05 resident-tax pair (bracketed period spelling) into one bullet", () => {
    const { packet, accepted, rendered } = renderFixture(B05_SOURCES);
    const bullets = bodyBullets(rendered);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain("[S1]");
    expect(bullets[0]).toContain("[S2]");
    expect(checkGroundedResearchRenderedAnswer(rendered, packet, accepted)).toEqual({ ok: true });
  });

  it("merges the B-06 salt-target triple into one bullet with all three citations", () => {
    const { packet, accepted, rendered } = renderFixture(B06_SOURCES);
    const bullets = bodyBullets(rendered);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain("[S1]");
    expect(bullets[0]).toContain("[S2]");
    expect(bullets[0]).toContain("[S3]");
    expect(checkGroundedResearchRenderedAnswer(rendered, packet, accepted)).toEqual({ ok: true });
  });

  it("merges the B-10 vaccination-start pair into one bullet with both citations", () => {
    const { packet, accepted, rendered } = renderFixture(B10_SOURCES);
    const bullets = bodyBullets(rendered);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain("[S1]");
    expect(bullets[0]).toContain("[S2]");
    expect(checkGroundedResearchRenderedAnswer(rendered, packet, accepted)).toEqual({ ok: true });
  });

  it("applies through the recomposition renderer, which shares this dedup path (R-PR-9d)", () => {
    const packet = packetOf(B05_SOURCES);
    const material = B05_SOURCES.map((source, index) => recordOf(source, index));
    const rendered = renderGroundedResearchRecomposedAnswer(material, packet, "ja");
    const bullets = bodyBullets(rendered);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain("[S1]");
    expect(bullets[0]).toContain("[S2]");
  });
});

describe("cross-source claim dedup — the slot headline is a dedup peer (R-PR-9f, B-04)", () => {
  const FURUSATO_ENTRY = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find(
    (entry) => entry.id === "furusato-nozei-self-burden",
  )!;
  const B04_QUOTE =
    "寄附金額のうち2,000円を除く全額が税金から控除されるため、実質的な自己負担は2,000円のみとなります。";
  const B04_RESTATING_BULLET = "寄附金額から2,000円を除いた全額が税金から控除され、自己負担は2,000円です。";
  const B04_CAP_BULLET = "寄附金の控除対象額は総所得金額等の40％までです。";
  const B04_RESIDENT_BULLET = "住民税の特例分により、控除できなかった額は所得割額の20％まで全額控除されます。";

  it("drops the support bullet that restates the slot sentence, keeping the distinct support facts", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "ふるさと納税の限度額",
        url: "https://www.town.yoshinogari.lg.jp/lifeinfo/soshiki/kikaku_chosei/2/1/furu/540032.html",
        domain: "town.yoshinogari.lg.jp",
        excerpt: `${B04_QUOTE}ふるさと納税は、自治体に対する寄附です。`,
      }),
      makeSource({
        title: "No.1155 ふるさと納税(寄附金控除)",
        url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm",
        domain: "nta.go.jp",
        excerpt: `${B04_CAP_BULLET}${B04_RESIDENT_BULLET}寄附金額のうち自己負担は2,000円のみとなります。`,
      }),
    ]);
    const evaluation = evaluateGroundedResearchFactSlot(
      JSON.stringify({ fields: { amount: { value: "2,000円", src: "S1", quote: B04_QUOTE } } }),
      packet,
      FURUSATO_ENTRY,
    );
    expect(evaluation.code).toBeNull();
    const sentence = renderGroundedResearchFactSlotSentence(
      FURUSATO_ENTRY,
      evaluation.candidate!,
      packet.sources[0]!,
      "ja",
    );
    // The measurement's headline, verbatim.
    expect(sentence).toBe("2026年11月15日時点で、ふるさと納税の自己負担額は2,000円です。");
    const supportRecords: GroundedResearchAcceptedRecord[] = [
      { sourceId: "S1", sourceIndex: 0, evidenceIds: [], quote: B04_RESTATING_BULLET, text: B04_RESTATING_BULLET, quoteStart: 0 },
      { sourceId: "S2", sourceIndex: 1, evidenceIds: [], quote: B04_CAP_BULLET, text: B04_CAP_BULLET, quoteStart: 0 },
      { sourceId: "S2", sourceIndex: 1, evidenceIds: [], quote: B04_RESIDENT_BULLET, text: B04_RESIDENT_BULLET, quoteStart: 0 },
    ];
    const rendered = renderGroundedResearchFactSlotAnswer(
      FURUSATO_ENTRY,
      sentence!,
      evaluation,
      packet.sources[0]!,
      supportRecords,
      packet,
      "ja",
    );
    // The headline and its verbatim evidence quote stay (the quote
    // is the designed evidence block); the restating bullet is gone.
    expect(rendered).toContain("2026年11月15日時点で、ふるさと納税の自己負担額は2,000円です。 [S1]");
    expect(rendered).toContain(`根拠の引用文：「${B04_QUOTE}」`);
    expect(rendered).not.toContain(B04_RESTATING_BULLET);
    // The distinct support facts (the caps) are not the slot's
    // claim and keep their bullets.
    expect(rendered).toContain(B04_CAP_BULLET);
    expect(rendered).toContain(B04_RESIDENT_BULLET);
  });
});

describe("cross-source claim dedup — distinct facts are never merged (R-PR-9f guards)", () => {
  it("keeps both bullets when a single-digit value differs (生後2か月 vs 生後6か月)", () => {
    const { rendered } = renderFixture([
      B10_SOURCES[0]!,
      {
        url: "https://shimokita-kids.com/blog/%E8%B5%A4%E3%81%A1%E3%82%83%E3%82%93%E3%81%AE%E3%83%AF%E3%82%AF%E3%83%81%E3%83%B3%E3%83%87%E3%83%93%E3%83%A5%E3%83%BC%E3%81%AF%E7%94%9F%E5%BE%8C2%E3%81%8B%E6%9C%88%E3%81%8B%E3%82%89%EF%BD%9C%E5%88%9D",
        domain: "shimokita-kids.com",
        text: "予防接種は生後6か月になった日から受けられます。",
      },
    ]);
    expect(bodyBullets(rendered)).toHaveLength(2);
  });

  it("keeps both bullets for a different claim on the same subject", () => {
    const { rendered } = renderFixture([
      B05_SOURCES[0]!,
      {
        url: "https://www.city.example.lg.jp/zeimu/annai.html",
        domain: "city.example.lg.jp",
        text: "住民税は市区町村が課税します。",
      },
    ]);
    expect(bodyBullets(rendered)).toHaveLength(2);
  });

  it("keeps both bullets for different taxes stating the same dates (subject-tax veto)", () => {
    const { rendered } = renderFixture([
      {
        url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2020.htm",
        domain: "nta.go.jp",
        text: "所得税の確定申告の期間は2月16日から3月15日です。",
      },
      {
        url: "https://www.city.example.lg.jp/zeimu/juminzei.html",
        domain: "city.example.lg.jp",
        text: "住民税の申告期間は2月16日から3月15日です。",
      },
    ]);
    expect(bodyBullets(rendered)).toHaveLength(2);
  });

  it("keeps both bullets when the values differ inside the same frame (target vs actual intake)", () => {
    const { rendered } = renderFixture([
      {
        url: "https://www.city.kobe.lg.jp/a00685/kenko/health/promotion/eating/shokutokenko/select/salt.html",
        domain: "city.kobe.lg.jp",
        text: "塩分摂取目標量は男性で7.5g未満です。",
      },
      {
        url: "https://survey.example.jp/salt-intake",
        domain: "survey.example.jp",
        text: "塩分の摂取量は男性で平均9.2gです。",
      },
    ]);
    expect(bodyBullets(rendered)).toHaveLength(2);
  });
});
