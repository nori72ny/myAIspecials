import { describe, expect, it } from 'vitest';
import {
  assembleDeckFromDraft,
  assembleDeckFromMaterial,
  checkDeckGates,
  deckSectionRoleForIndex,
  detectDeckMetaVocabulary,
  isDeckAssertionSentence,
  type DeckAssembledDocument,
  type DeckGateViolationCode,
} from './proposalDeckAssemblyV1.js';
import { buildProposalDeck, type ProposalDeckInput } from './proposalDeckPlannerV1.js';
import { checkProposalDeck } from './proposalDeckSelfCheckV1.js';

// 資料レコード再設計 D-PR-4（2フィールド化・昇格・5ゲート・組立）の
// 恒常テスト。設計正本:
// ~/workspace/origin-fix/DECK_RECORDS_REDESIGN_2026-11-15.md
// （§6 見出しの2フィールド化と昇格、§7 5ゲート、§8 メタ語彙）
// - 昇格は「候補が不合格・題目が空・本文の最初の単位が完結した
//   主張文」の3条件が揃ったときだけ発動し、文字列は材料単位の
//   逐語そのもの（同一オブジェクト）であることを固定する。
// - 5ゲートは全て実行され、違反はゲート別のコードで返ること。
// - 主張文判定の受動形の追加（§7.4 の確定事項）は新経路だけに
//   効き、旧自己チェックの判定は変わらないことを固定する。

function codesOf(violations: readonly { code: DeckGateViolationCode }[]): DeckGateViolationCode[] {
  return violations.map((violation) => violation.code);
}

describe('deckSectionRoleForIndex', () => {
  it('assigns the fixed role order by section position (§13-11 (a))', () => {
    expect([0, 1, 2, 3, 4, 5, 8].map(deckSectionRoleForIndex)).toEqual([
      'challenge',
      'solution',
      'value',
      'plan',
      'cost',
      'other',
      'other',
    ]);
  });
});

describe('isDeckAssertionSentence', () => {
  it('accepts the current assertion endings and 。-endings', () => {
    expect(isDeckAssertionSentence('導入で月40時間を削減できます')).toBe(true);
    expect(isDeckAssertionSentence('来月から段階的に導入します。')).toBe(true);
  });

  it('additionally accepts passive closings (the §7.4 determination)', () => {
    expect(isDeckAssertionSentence('月40時間の作業が削減された')).toBe(true);
    expect(isDeckAssertionSentence('月40時間の作業が削減されます')).toBe(true);
    expect(isDeckAssertionSentence('手間が削減されている')).toBe(true);
  });

  it('still rejects noun-ending labels, including ones containing passive forms', () => {
    expect(isDeckAssertionSentence('現状の課題')).toBe(false);
    expect(isDeckAssertionSentence('削減された時間')).toBe(false);
    expect(isDeckAssertionSentence('')).toBe(false);
  });
});

describe('detectDeckMetaVocabulary', () => {
  it('detects meta explanations, slide references and label lines (§8)', () => {
    expect(detectDeckMetaVocabulary('各スライドの内容について説明します')).toBe(true);
    expect(detectDeckMetaVocabulary('この節の内容を説明します')).toBe(true);
    expect(detectDeckMetaVocabulary('要点をまとめました')).toBe(true);
    expect(detectDeckMetaVocabulary('表紙の次に要点を示します')).toBe(true);
    expect(detectDeckMetaVocabulary('タイトル：経理の手間を減らす')).toBe(true);
    expect(detectDeckMetaVocabulary('内容')).toBe(true);
  });

  it('does not flag ordinary body text', () => {
    expect(detectDeckMetaVocabulary('経理の手間を月40時間削減できます')).toBe(false);
    expect(detectDeckMetaVocabulary('紙の領収書の管理に時間がかかっています')).toBe(false);
  });

  it('flags any mention of スライド in body scope (initial §8 policy, pinned)', () => {
    expect(detectDeckMetaVocabulary('スライド作成の手間を減らせます')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// モードA: 決定的配置の正常系
// ---------------------------------------------------------------------------

const DETERMINISTIC_MATERIAL = [
  'クラウド会計サービスのご提案',
  '',
  '要点',
  '',
  '- 経理の手間を月40時間削減できます',
  '- 初期費用を3か月で回収できます',
  '- 来月から段階的に導入できます',
  '',
  '現状の課題',
  '',
  '経理担当者が少なく、月末に業務が集中しています。紙の領収書の管理に時間がかかっています。仕訳の転記作業が発生しています。',
  '',
  '解決策',
  '',
  '仕訳の自動化で月末作業の手間を減らせます。領収書を撮影するだけで取り込めます。転記作業が不要になります。',
  '',
  '導入効果',
  '',
  '月40時間の作業を削減できます。残業代を年間120万円削減できます。月末の締め作業が2日早くなります。',
  '',
  '次の一手',
  '',
  '- まずは無料相談をお申し込みください',
].join('\n');

describe('assembleDeckFromMaterial (deterministic placement)', () => {
  it('assembles a valid document and passes all five gates in fixed order', () => {
    const result = assembleDeckFromMaterial({ materialText: DETERMINISTIC_MATERIAL });
    expect(result.ok).toBe(true);
    expect(result.placementFormatKind).toBe('deterministic');
    expect(result.gates.map((gate) => gate.gate)).toEqual([
      'format',
      'fidelity',
      'sufficiency',
      'semantic',
      'renderability',
    ]);
    expect(result.gates.every((gate) => gate.ok)).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.promotionCount).toBe(0);
    expect(result.metaDetectionCount).toBe(0);

    const document = result.document;
    expect(document?.mode).toBe('A');
    expect(document?.titleText).toBe('クラウド会計サービスのご提案');
    expect(document?.summaryUnits.map((unit) => unit.text)).toEqual([
      '経理の手間を月40時間削減できます',
      '初期費用を3か月で回収できます',
      '来月から段階的に導入できます',
    ]);
    expect(document?.sections.map((section) => section.role)).toEqual([
      'challenge',
      'solution',
      'value',
    ]);
    expect(document?.nextStepUnits.map((unit) => unit.text)).toEqual([
      'まずは無料相談をお申し込みください',
    ]);
  });

  it('keeps topic and message as separate fields; the topic is not assertion-checked', () => {
    const result = assembleDeckFromMaterial({ materialText: DETERMINISTIC_MATERIAL });
    const first = result.document?.sections[0];
    // 題目「現状の課題」は名詞止めのラベルだが、主張文判定の対象外
    // であるため違反にならない（§6.1）。
    expect(first?.topicText).toBe('現状の課題');
    expect(first?.messageUnit?.text).toBe('経理担当者が少なく、月末に業務が集中しています。');
    expect(codesOf(result.violations)).not.toContain('HEADLINE_NOT_ASSERTION');
  });

  it('reports insufficiency with the shared missing codes when elements are short', () => {
    const material = [
      'ご提案のタイトル',
      '',
      '要点',
      '',
      '- 要点の一つ目です',
      '- 要点の二つ目です',
      '',
      '現状の課題',
      '',
      '経理担当者が少なく月末に業務が集中しています。紙の管理に時間がかかっています。',
      '',
      '解決策',
      '',
      '仕訳の自動化で月末作業の手間を減らせます。転記作業が不要になります。',
    ].join('\n');
    const result = assembleDeckFromMaterial({ materialText: material });
    expect(result.ok).toBe(false);
    expect(result.missing).toContainEqual({ code: 'MISSING_KEY_POINTS', count: 1 });
    expect(result.missing).toContainEqual({ code: 'MISSING_SECTION_CONTENT', count: 1 });
    expect(result.missing).toContainEqual({ code: 'MISSING_NEXT_ACTION', count: 1 });
    // 節2件では総スライド数5になり、描画可能性ゲートでも落ちる。
    expect(codesOf(result.violations)).toContain('SLIDE_COUNT_OUT_OF_RANGE');
  });

  it('does not count duplicated summary points toward the three points', () => {
    const material = [
      'ご提案のタイトル',
      '',
      '要点',
      '',
      '- 同じ要点の文です',
      '- 同じ要点の文です',
      '- 別の要点の文です',
      '',
      '現状の課題',
      '',
      '経理担当者が少なく月末に業務が集中しています。紙の管理に時間がかかっています。',
    ].join('\n');
    const result = assembleDeckFromMaterial({ materialText: material });
    expect(result.missing).toContainEqual({ code: 'MISSING_KEY_POINTS', count: 1 });
  });

  it('flags more than three distinct summary points as SUMMARY_POINTS, not as missing', () => {
    const material = [
      'ご提案のタイトル',
      '',
      '要点',
      '',
      '- 要点の一つ目です',
      '- 要点の二つ目です',
      '- 要点の三つ目です',
      '- 要点の四つ目です',
      '',
      '現状の課題',
      '',
      '経理担当者が少なく月末に業務が集中しています。紙の管理に時間がかかっています。',
    ].join('\n');
    const result = assembleDeckFromMaterial({ materialText: material });
    const sufficiency = result.gates.find((gate) => gate.gate === 'sufficiency');
    expect(codesOf(sufficiency?.violations ?? [])).toContain('SUMMARY_POINTS');
    expect(result.missing.map((entry) => entry.code)).not.toContain('MISSING_KEY_POINTS');
  });
});

// ---------------------------------------------------------------------------
// モードA: モデル配置計画（JSON形・テキスト形）
// ---------------------------------------------------------------------------

const PLACEMENT_MATERIAL = [
  '経理の手間を減らす仕組みのご提案',
  '',
  '経理の手間を月40時間削減できます。',
  '',
  '初期費用を3か月で回収できます。',
  '',
  '来月から段階的に導入できます。',
  '',
  '現状の課題',
  '',
  '経理担当者が少なく月末に業務が集中しています。',
  '',
  '紙の領収書の管理に時間がかかっています。',
  '',
  '仕訳を自動化すれば月末作業を減らせます。',
  '',
  '領収書を撮影するだけで取り込めます。',
  '',
  '転記作業が不要になります。',
  '',
  '導入効果',
  '',
  '月40時間の作業を削減できます。',
  '',
  '残業代を年間120万円削減できます。',
  '',
  'まずは無料相談をお申し込みください。',
].join('\n');

const PLACEMENT_JSON =
  '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
  '{"topic_ref":"M5","headline_ref":"M6","body_refs":["M7"]},' +
  '{"topic_ref":null,"headline_ref":"M8","body_refs":["M9","M10"]},' +
  '{"topic_ref":"M11","headline_ref":"M12","body_refs":["M13"]}],' +
  '"next_step_refs":["M14"],"missing":[]}';

const PLACEMENT_TEXT = [
  'TITLE: M1',
  'SUMMARY: M2, M3, M4',
  'SECTION',
  'TOPIC: M5',
  'HEADLINE: M6',
  'BODY: M7',
  'END',
  'SECTION',
  'HEADLINE: M8',
  'BODY: M9, M10',
  'END',
  'SECTION',
  'TOPIC: M11',
  'HEADLINE: M12',
  'BODY: M13',
  'END',
  'NEXT: M14',
].join('\n');

describe('assembleDeckFromMaterial (model placement)', () => {
  it('assembles from a JSON placement plan', () => {
    const result = assembleDeckFromMaterial({
      materialText: PLACEMENT_MATERIAL,
      placementOutputText: PLACEMENT_JSON,
    });
    expect(result.ok).toBe(true);
    expect(result.placementFormatKind).toBe('json');
    expect(result.document?.sections.map((section) => section.topicText)).toEqual([
      '現状の課題',
      null,
      '導入効果',
    ]);
    expect(result.document?.sections[1].messageUnit?.text).toBe(
      '仕訳を自動化すれば月末作業を減らせます。',
    );
  });

  it('assembles from the text form of the same plan', () => {
    const result = assembleDeckFromMaterial({
      materialText: PLACEMENT_MATERIAL,
      placementOutputText: PLACEMENT_TEXT,
    });
    expect(result.ok).toBe(true);
    expect(result.placementFormatKind).toBe('text');
    expect(result.document?.titleText).toBe('経理の手間を減らす仕組みのご提案');
  });

  it('returns only the format gate when the placement output cannot be parsed', () => {
    const result = assembleDeckFromMaterial({
      materialText: PLACEMENT_MATERIAL,
      placementOutputText: '配置計画ではない文章です。',
    });
    expect(result.ok).toBe(false);
    expect(result.document).toBeNull();
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].gate).toBe('format');
    expect(codesOf(result.violations)).toEqual(['DECK_PLAN_PARSE_FAILED']);
    // 形式の失敗は不足とは扱わない（§9 の切り分け）。
    expect(result.missing).toEqual([]);
  });

  it('invalidates an unknown ID reference in gate 1 and recomputes the missing title', () => {
    const plan = PLACEMENT_JSON.replace('"title_ref":"M1"', '"title_ref":"M99"');
    const result = assembleDeckFromMaterial({
      materialText: PLACEMENT_MATERIAL,
      placementOutputText: plan,
    });
    expect(result.ok).toBe(false);
    expect(result.unknownIdCount).toBe(1);
    const format = result.gates.find((gate) => gate.gate === 'format');
    expect(codesOf(format?.violations ?? [])).toContain('DECK_PLAN_UNKNOWN_ID');
    expect(result.document?.titleText).toBeNull();
    expect(result.missing).toContainEqual({ code: 'MISSING_TITLE', count: 1 });
  });
});

// ---------------------------------------------------------------------------
// 逐語昇格（§6.3）
// ---------------------------------------------------------------------------

const PROMOTION_MATERIAL = [
  '経理の手間を減らす仕組みのご提案',
  '',
  '経理の手間を月40時間削減できます。',
  '',
  '初期費用を3か月で回収できます。',
  '',
  '来月から段階的に導入できます。',
  '',
  '現状の課題',
  '',
  '経理担当者が少なく月末に業務が集中しています。',
  '',
  '紙の領収書の管理に時間がかかっています。',
  '',
  '費用の考え方',
  '',
  '費用は導入規模に応じて決まります。',
  '',
  '料金は月額と年額から選べます。',
  '',
  '導入効果',
  '',
  '月40時間の作業を削減できます。',
  '',
  '残業代を年間120万円削減できます。',
  '',
  'まずは無料相談をお申し込みください。',
].join('\n');

describe('verbatim promotion (§6.3)', () => {
  it('promotes the first body unit and sends the failed candidate to the topic, verbatim', () => {
    const plan =
      '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
      '{"topic_ref":"M5","headline_ref":"M6","body_refs":["M7"]},' +
      '{"topic_ref":null,"headline_ref":"M8","body_refs":["M9","M10"]},' +
      '{"topic_ref":"M11","headline_ref":"M12","body_refs":["M13"]}],' +
      '"next_step_refs":["M14"],"missing":[]}';
    const result = assembleDeckFromMaterial({
      materialText: PROMOTION_MATERIAL,
      placementOutputText: plan,
    });
    expect(result.ok).toBe(true);
    expect(result.promotionCount).toBe(1);
    const section = result.document?.sections[1];
    expect(section?.promoted).toBe(true);
    // 昇格した主張文は材料単位そのもの（コピーでも改変でもない）。
    const sourceUnit = result.units.find((unit) => unit.id === 'M9');
    expect(section?.messageUnit).toBe(sourceUnit);
    expect(section?.messageUnit?.text).toBe('費用は導入規模に応じて決まります。');
    // 元の候補文は題目へ送られ、逐語のまま残る。
    expect(section?.topicText).toBe('費用の考え方');
    expect(section?.topicUnit?.id).toBe('M8');
    // 昇格で消費した単位は本文から除かれる（二重掲載しない）。
    expect(section?.bodyUnits.map((unit) => unit.id)).toEqual(['M10']);
  });

  it('does not promote when the topic is already occupied (§13-7 (a))', () => {
    const material = [
      'ご提案のタイトル',
      '',
      '要点の一つ目です。',
      '',
      '要点の二つ目です。',
      '',
      '要点の三つ目です。',
      '',
      '費用',
      '',
      '費用の考え方',
      '',
      '費用は導入規模に応じて決まります。',
      '',
      '導入で作業時間を削減できます。',
      '',
      '補足の本文です。',
      '',
      'まずは相談をお申し込みください',
    ].join('\n');
    const plan =
      '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
      '{"topic_ref":"M5","headline_ref":"M6","body_refs":["M7"]},' +
      '{"topic_ref":null,"headline_ref":"M8","body_refs":["M9"]}],' +
      '"next_step_refs":["M10"],"missing":[]}';
    const result = assembleDeckFromMaterial({ materialText: material, placementOutputText: plan });
    expect(result.promotionCount).toBe(0);
    const section = result.document?.sections[0];
    expect(section?.promoted).toBe(false);
    expect(section?.topicText).toBe('費用');
    expect(section?.messageUnit?.text).toBe('費用の考え方');
    const semantic = result.gates.find((gate) => gate.gate === 'semantic');
    expect(codesOf(semantic?.violations ?? [])).toContain('HEADLINE_NOT_ASSERTION');
  });

  it('does not promote a bullet unit (only complete sentence units are eligible)', () => {
    const material = [
      'ご提案のタイトル',
      '',
      '要点の一つ目です。',
      '',
      '要点の二つ目です。',
      '',
      '要点の三つ目です。',
      '',
      '費用の考え方',
      '',
      '- 費用は規模に応じて決まります。',
      '',
      '導入で作業時間を削減できます。',
      '',
      '補足の本文です。',
      '',
      'まずは相談をお申し込みください',
    ].join('\n');
    const plan =
      '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
      '{"topic_ref":null,"headline_ref":"M5","body_refs":["M6"]},' +
      '{"topic_ref":null,"headline_ref":"M7","body_refs":["M8"]}],' +
      '"next_step_refs":["M9"],"missing":[]}';
    const result = assembleDeckFromMaterial({ materialText: material, placementOutputText: plan });
    expect(result.promotionCount).toBe(0);
    expect(codesOf(result.violations)).toContain('HEADLINE_NOT_ASSERTION');
  });

  it('looks at the first body unit only (no search beyond it, at most once per section)', () => {
    const material = [
      'ご提案のタイトル',
      '',
      '要点の一つ目です。',
      '',
      '要点の二つ目です。',
      '',
      '要点の三つ目です。',
      '',
      '費用の考え方',
      '',
      '費用の内訳は規模次第',
      '',
      '費用は導入規模に応じて決まります。',
      '',
      '導入で作業時間を削減できます。',
      '',
      '補足の本文です。',
      '',
      'まずは相談をお申し込みください',
    ].join('\n');
    const plan =
      '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
      '{"topic_ref":null,"headline_ref":"M5","body_refs":["M6","M7"]},' +
      '{"topic_ref":null,"headline_ref":"M8","body_refs":["M9"]}],' +
      '"next_step_refs":["M10"],"missing":[]}';
    const result = assembleDeckFromMaterial({ materialText: material, placementOutputText: plan });
    expect(result.promotionCount).toBe(0);
    expect(result.document?.sections[0].messageUnit?.text).toBe('費用の考え方');
    expect(codesOf(result.violations)).toContain('HEADLINE_NOT_ASSERTION');
  });

  it('does not promote when there is no headline candidate (missing stays missing)', () => {
    const material = [
      'ご提案のタイトル',
      '',
      '要点の一つ目です。',
      '',
      '要点の二つ目です。',
      '',
      '要点の三つ目です。',
      '',
      '費用は導入規模に応じて決まります。',
      '',
      '補足の本文です。',
      '',
      'まずは相談をお申し込みください',
    ].join('\n');
    const plan =
      '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
      '{"topic_ref":null,"headline_ref":null,"body_refs":["M5","M6"]}],' +
      '"next_step_refs":["M7"],"missing":[]}';
    const result = assembleDeckFromMaterial({ materialText: material, placementOutputText: plan });
    expect(result.promotionCount).toBe(0);
    expect(result.document?.sections[0].messageUnit).toBeNull();
    expect(result.missing).toContainEqual({ code: 'MISSING_ASSERTION_HEADLINES', count: 1 });
  });

  it('does not backfill a meta-dropped headline by promotion (§8)', () => {
    const material = [
      'ご提案のタイトル',
      '',
      '要点の一つ目です。',
      '',
      '要点の二つ目です。',
      '',
      '要点の三つ目です。',
      '',
      'この節の内容について説明します。',
      '',
      '費用は導入規模に応じて決まります。',
      '',
      '補足の本文です。',
      '',
      '導入で作業時間を削減できます。',
      '',
      '補足の本文その二です。',
      '',
      'まずは相談をお申し込みください',
    ].join('\n');
    const plan =
      '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
      '{"topic_ref":null,"headline_ref":"M5","body_refs":["M6","M7"]},' +
      '{"topic_ref":null,"headline_ref":"M8","body_refs":["M9"]}],' +
      '"next_step_refs":["M10"],"missing":[]}';
    const result = assembleDeckFromMaterial({ materialText: material, placementOutputText: plan });
    expect(result.promotionCount).toBe(0);
    expect(result.metaDetectionCount).toBe(1);
    expect(result.document?.sections[0].messageUnit).toBeNull();
    expect(codesOf(result.violations)).toContain('DECK_META_VOCABULARY');
    expect(result.missing).toContainEqual({ code: 'MISSING_ASSERTION_HEADLINES', count: 1 });
  });
});

// ---------------------------------------------------------------------------
// ゲート3の残り（本文単位の上限・プレースホルダー）
// ---------------------------------------------------------------------------

describe('sufficiency gate details', () => {
  const SMALL_MATERIAL_HEAD = [
    'ご提案のタイトル',
    '',
    '要点の一つ目です。',
    '',
    '要点の二つ目です。',
    '',
    '要点の三つ目です。',
    '',
  ];

  it('flags more than four body units in one section as TOO_MANY_BULLETS', () => {
    const material = [
      ...SMALL_MATERIAL_HEAD,
      '導入で作業時間を削減できます。',
      '',
      '本文の一つ目です。',
      '',
      '本文の二つ目です。',
      '',
      '本文の三つ目です。',
      '',
      '本文の四つ目です。',
      '',
      '本文の五つ目です。',
      '',
      'まずは相談をお申し込みください',
    ].join('\n');
    const plan =
      '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
      '{"topic_ref":null,"headline_ref":"M5","body_refs":["M6","M7","M8","M9","M10"]}],' +
      '"next_step_refs":["M11"],"missing":[]}';
    const result = assembleDeckFromMaterial({ materialText: material, placementOutputText: plan });
    const sufficiency = result.gates.find((gate) => gate.gate === 'sufficiency');
    expect(codesOf(sufficiency?.violations ?? [])).toContain('TOO_MANY_BULLETS');
  });

  it('flags a remaining placeholder in a placed unit', () => {
    const material = [
      ...SMALL_MATERIAL_HEAD,
      '導入で作業時間を削減できます。',
      '',
      '工数が〇〇パーセント減ります。',
      '',
      'まずは相談をお申し込みください',
    ].join('\n');
    const plan =
      '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
      '{"topic_ref":null,"headline_ref":"M5","body_refs":["M6"]}],' +
      '"next_step_refs":["M7"],"missing":[]}';
    const result = assembleDeckFromMaterial({ materialText: material, placementOutputText: plan });
    const sufficiency = result.gates.find((gate) => gate.gate === 'sufficiency');
    const violation = sufficiency?.violations.find((entry) => entry.code === 'PLACEHOLDER_REMAINING');
    expect(violation?.unitId).toBe('M6');
  });
});

// ---------------------------------------------------------------------------
// ゲート4の役割適格性（質問形・条件付き）
// ---------------------------------------------------------------------------

describe('semantic gate role eligibility', () => {
  it('flags a conditional message and a question-form next step', () => {
    const material = [
      'ご提案のタイトル',
      '',
      '要点の一つ目です。',
      '',
      '要点の二つ目です。',
      '',
      '要点の三つ目です。',
      '',
      '予算が確保できた場合は導入します。',
      '',
      '本文の文です。',
      '',
      '導入をご希望でしょうか',
    ].join('\n');
    const plan =
      '{"title_ref":"M1","summary_refs":["M2","M3","M4"],"sections":[' +
      '{"topic_ref":null,"headline_ref":"M5","body_refs":["M6"]}],' +
      '"next_step_refs":["M7"],"missing":[]}';
    const result = assembleDeckFromMaterial({ materialText: material, placementOutputText: plan });
    const semantic = result.gates.find((gate) => gate.gate === 'semantic');
    const eligibility = (semantic?.violations ?? []).filter(
      (entry) => entry.code === 'DECK_FORM_NOT_ELIGIBLE',
    );
    expect(eligibility.map((entry) => entry.role)).toEqual(['section-message', 'next-steps']);
    // 条件付きの文は「。」で閉じているため、主張文判定自体は合格する
    // （適格性は閉じ方とは別の検査であること）。
    expect(codesOf(semantic?.violations ?? [])).not.toContain('HEADLINE_NOT_ASSERTION');
  });

  it('accepts a passive-closing message in the records path while the legacy check still rejects it', () => {
    const material = PLACEMENT_MATERIAL.replace(
      '月40時間の作業を削減できます。',
      '月40時間の作業が削減された',
    );
    const result = assembleDeckFromMaterial({
      materialText: material,
      placementOutputText: PLACEMENT_JSON,
    });
    const semantic = result.gates.find((gate) => gate.gate === 'semantic');
    expect(codesOf(semantic?.violations ?? [])).not.toContain('HEADLINE_NOT_ASSERTION');

    // 旧自己チェックは併存であり、判定は変えていない（無句読点の
    // 受動形は旧経路では引き続き不合格）。
    const legacyInput: ProposalDeckInput = {
      title: 'ご提案',
      summary: { headline: 'まとめの文です', points: ['要点1', '要点2', '要点3'] },
      sections: [
        { role: 'challenge', message: '月40時間の作業が削減された', bullets: [] },
        { role: 'solution', message: '導入で削減できます', bullets: [] },
        { role: 'value', message: '効果があります', bullets: [] },
      ],
      closing: { ask: 'ご承認をお願いします', nextSteps: ['相談を申し込む'] },
    };
    const legacyCodes = checkProposalDeck(buildProposalDeck(legacyInput)).violations.map(
      (violation) => violation.code,
    );
    expect(legacyCodes.filter((code) => code === 'HEADLINE_NOT_ASSERTION')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 二要素モデル（ProposalDeck 側の topic、D-PR-4 のモデル変更）
// ---------------------------------------------------------------------------

describe('two-field headline model on ProposalDeck', () => {
  const baseInput: ProposalDeckInput = {
    title: 'ご提案',
    summary: { headline: 'まとめの文です', points: ['要点1', '要点2', '要点3'] },
    sections: [
      { role: 'challenge', message: '現状の手作業で時間が失われています', bullets: [] },
      { role: 'solution', message: '導入で削減できます', bullets: [] },
      { role: 'value', message: '効果があります', bullets: [] },
    ],
    closing: { ask: 'ご承認をお願いします', nextSteps: ['相談を申し込む'] },
  };

  it('carries the topic through the planner when provided, and omits it otherwise', () => {
    const withTopic = buildProposalDeck({
      ...baseInput,
      sections: baseInput.sections?.map((section, index) =>
        index === 0 ? { ...section, topic: '現状の課題' } : section,
      ),
    });
    expect(withTopic.sections[0].topic).toBe('現状の課題');
    const withoutTopic = buildProposalDeck(baseInput);
    expect(withoutTopic.sections[0].topic).toBeUndefined();
  });

  it('does not subject the topic to the legacy assertion check', () => {
    const deck = buildProposalDeck({
      ...baseInput,
      sections: baseInput.sections?.map((section, index) =>
        index === 0 ? { ...section, topic: '現状の課題' } : section,
      ),
    });
    const legacyCodes = checkProposalDeck(deck).violations.map((violation) => violation.code);
    expect(legacyCodes).not.toContain('HEADLINE_NOT_ASSERTION');
  });
});

// ---------------------------------------------------------------------------
// モードB: タグ起草からの組立
// ---------------------------------------------------------------------------

const VALID_DRAFT = [
  '[導入]',
  '本資料では、経理の手間を減らす進め方をご提案します。',
  '[資料タイトル]',
  '経理の手間を減らす仕組みのご提案',
  '[要点]',
  '経理の手間を月40時間削減できます',
  '初期費用を3か月で回収できます',
  '来月から段階的に導入できます',
  '[節1_題目]',
  '現状の課題',
  '[節1_主張]',
  '経理担当者が少なく、月末に業務が集中しています。',
  '[節1_本文]',
  '紙の領収書の管理に時間がかかっています',
  '仕訳の転記作業が発生しています',
  '[節2_題目]',
  '解決策',
  '[節2_主張]',
  '仕訳の自動化で月末作業の手間を減らせます。',
  '[節2_本文]',
  '領収書を撮影するだけで取り込めます',
  '転記作業が不要になります',
  '[節3_題目]',
  '導入効果',
  '[節3_主張]',
  '月40時間の作業を削減できます。',
  '[節3_本文]',
  '残業代を年間120万円削減できます',
  '月末の締め作業が2日早くなります',
  '[次の一手]',
  'まずは無料相談をお申し込みください',
  '[前提]',
  '対象は経理業務に限ります',
].join('\n');

describe('assembleDeckFromDraft (mode B)', () => {
  it('assembles a valid draft and passes all gates', () => {
    const result = assembleDeckFromDraft({ draftText: VALID_DRAFT });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('B');
    expect(result.placementFormatKind).toBe('tags');
    const document = result.document;
    expect(document?.titleText).toBe('経理の手間を減らす仕組みのご提案');
    // モードBのタイトル・題目は単位化されない（逐語は文字列で持つ）。
    expect(document?.titleUnit).toBeNull();
    expect(document?.sections[0].topicText).toBe('現状の課題');
    expect(document?.sections[0].topicUnit).toBeNull();
    expect(document?.sections[0].messageUnit?.text).toBe(
      '経理担当者が少なく、月末に業務が集中しています。',
    );
    expect(document?.sections.map((section) => section.role)).toEqual([
      'challenge',
      'solution',
      'value',
    ]);
    expect(document?.introduction).toBe('本資料では、経理の手間を減らす進め方をご提案します。');
    expect(document?.assumptions).toEqual(['対象は経理業務に限ります']);
  });

  it('fails gate 1 and gate 3 when a section assertion tag is missing', () => {
    const draft = VALID_DRAFT.replace('[節2_主張]\n仕訳の自動化で月末作業の手間を減らせます。\n', '');
    const result = assembleDeckFromDraft({ draftText: draft });
    expect(result.ok).toBe(false);
    const format = result.gates.find((gate) => gate.gate === 'format');
    expect(format?.ok).toBe(false);
    expect(codesOf(format?.violations ?? [])).toContain('DECK_FORMAT_TAG_MISSING');
    expect(result.document?.sections[1].messageUnit).toBeNull();
    expect(result.missing).toContainEqual({ code: 'MISSING_ASSERTION_HEADLINES', count: 1 });
  });

  it('drops a meta-vocabulary body unit and reports it in gate 4', () => {
    const draft = VALID_DRAFT.replace(
      '仕訳の転記作業が発生しています',
      '仕訳の転記作業が発生しています\n各スライドの内容について説明します',
    );
    const result = assembleDeckFromDraft({ draftText: draft });
    expect(result.ok).toBe(false);
    expect(result.metaDetectionCount).toBe(1);
    const semantic = result.gates.find((gate) => gate.gate === 'semantic');
    const meta = (semantic?.violations ?? []).find(
      (entry) => entry.code === 'DECK_META_VOCABULARY',
    );
    expect(meta?.role).toBe('section-body');
    // 検出単位は掲載から落ち、別の文で埋めない。
    expect(result.document?.sections[0].bodyUnits.map((unit) => unit.text)).toEqual([
      '紙の領収書の管理に時間がかかっています',
      '仕訳の転記作業が発生しています',
    ]);
  });

  it('does not apply the meta gate to topics (§8 scope)', () => {
    const draft = VALID_DRAFT.replace('[節1_題目]\n現状の課題', '[節1_題目]\nスライドの構成');
    const result = assembleDeckFromDraft({ draftText: draft });
    expect(result.metaDetectionCount).toBe(0);
    expect(result.document?.sections[0].topicText).toBe('スライドの構成');
    expect(result.ok).toBe(true);
  });

  it('does not promote in mode B when the body is made of bullet units', () => {
    const draft = [
      '[導入]',
      'ご提案の原稿です。',
      '[資料タイトル]',
      '費用の考え方のご提案',
      '[要点]',
      '要点の一つ目です',
      '要点の二つ目です',
      '要点の三つ目です',
      '[節1_主張]',
      '費用の考え方',
      '[節1_本文]',
      '費用は導入規模に応じて決まります。',
      '[次の一手]',
      'まずは無料相談をお申し込みください',
    ].join('\n');
    const result = assembleDeckFromDraft({ draftText: draft });
    expect(result.promotionCount).toBe(0);
    expect(result.document?.sections[0].promoted).toBe(false);
    expect(codesOf(result.violations)).toContain('HEADLINE_NOT_ASSERTION');
  });
});

// ---------------------------------------------------------------------------
// ゲート2・ゲート5の直接検証（組立を通さない文書への二重の防壁）
// ---------------------------------------------------------------------------

describe('checkDeckGates as a direct barrier', () => {
  it('catches a tampered placed text in gate 2 (verbatim and numeric)', () => {
    const assembled = assembleDeckFromMaterial({ materialText: DETERMINISTIC_MATERIAL });
    const document = assembled.document as DeckAssembledDocument;
    const target = document.sections[2].bodyUnits.find((unit) => unit.text.includes('120'));
    expect(target).toBeDefined();
    const tamperedUnit = { ...(target as NonNullable<typeof target>), text: '残業代を年間999万円削減できます' };
    const tampered: DeckAssembledDocument = {
      ...document,
      sections: document.sections.map((section, index) =>
        index === 2
          ? {
              ...section,
              bodyUnits: section.bodyUnits.map((unit) =>
                unit.id === tamperedUnit.id ? tamperedUnit : unit,
              ),
            }
          : section,
      ),
    };
    const checked = checkDeckGates(tampered, {
      units: assembled.units,
      formatViolations: [],
      metaDetections: [],
      extraVerbatimTexts: [],
      numericMaterialTexts: assembled.units.map((unit) => unit.text),
    });
    const fidelity = checked.gates.find((gate) => gate.gate === 'fidelity');
    expect(fidelity?.ok).toBe(false);
    expect(codesOf(fidelity?.violations ?? [])).toContain('DECK_TEXT_NOT_VERBATIM');
    const numericViolations = (fidelity?.violations ?? []).filter(
      (entry) => entry.code === 'NUMERIC_TOKEN_NOT_PRESERVED',
    );
    // 120 の欠落と 999 の混入の2件として現れる。
    expect(numericViolations.map((entry) => entry.token).sort()).toEqual(['120', '999']);
  });

  it('catches an out-of-range slide count in gate 5', () => {
    const assembled = assembleDeckFromMaterial({ materialText: DETERMINISTIC_MATERIAL });
    const document = assembled.document as DeckAssembledDocument;
    const sliced: DeckAssembledDocument = {
      ...document,
      sections: document.sections.slice(0, 2),
    };
    const checked = checkDeckGates(sliced, {
      units: assembled.units,
      formatViolations: [],
      metaDetections: [],
      extraVerbatimTexts: [],
      numericMaterialTexts: assembled.units.map((unit) => unit.text),
    });
    const renderability = checked.gates.find((gate) => gate.gate === 'renderability');
    expect(renderability?.ok).toBe(false);
    expect(codesOf(renderability?.violations ?? [])).toContain('SLIDE_COUNT_OUT_OF_RANGE');
  });

  it('checks table renderability in gate 5 (separator row required)', () => {
    const assembled = assembleDeckFromMaterial({ materialText: DETERMINISTIC_MATERIAL });
    const document = assembled.document as DeckAssembledDocument;
    const tableUnit = {
      id: 'M900',
      text: '| 項目 | 値 |\n| 価格 | 3,500円 |',
      sourceKind: 'user-material' as const,
      kind: 'table' as const,
    };
    const withTable: DeckAssembledDocument = {
      ...document,
      sections: document.sections.map((section, index) =>
        index === 0 ? { ...section, bodyUnits: [...section.bodyUnits, tableUnit] } : section,
      ),
    };
    const context = {
      units: [...assembled.units, tableUnit],
      formatViolations: [],
      metaDetections: [],
      extraVerbatimTexts: [],
      numericMaterialTexts: [...assembled.units.map((unit) => unit.text), tableUnit.text],
    };
    const malformed = checkDeckGates(withTable, context);
    const renderability = malformed.gates.find((gate) => gate.gate === 'renderability');
    expect(codesOf(renderability?.violations ?? [])).toContain('DECK_TABLE_NOT_RENDERABLE');

    const wellFormedUnit = {
      ...tableUnit,
      text: '| 項目 | 値 |\n| --- | --- |\n| 価格 | 3,500円 |',
    };
    const wellFormed: DeckAssembledDocument = {
      ...document,
      sections: document.sections.map((section, index) =>
        index === 0 ? { ...section, bodyUnits: [...section.bodyUnits, wellFormedUnit] } : section,
      ),
    };
    const checked = checkDeckGates(wellFormed, {
      ...context,
      units: [...assembled.units, wellFormedUnit],
      numericMaterialTexts: [...assembled.units.map((unit) => unit.text), wellFormedUnit.text],
    });
    const gate5 = checked.gates.find((gate) => gate.gate === 'renderability');
    expect(codesOf(gate5?.violations ?? [])).not.toContain('DECK_TABLE_NOT_RENDERABLE');
  });
});
