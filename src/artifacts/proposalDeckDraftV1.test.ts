import { describe, expect, it } from 'vitest';
import {
  buildDeckDraftInstruction,
  convertDeckDraftToMaterial,
  parseDeckDraft,
  DECK_DRAFT_MAX_SECTIONS,
  type DeckFormatViolation,
} from './proposalDeckDraftV1';
import {
  buildDeckDraftUnits,
  checkDeckVerbatim,
} from './proposalDeckRecordsV1';
import { PROPOSAL_DECK_SKELETON_INSTRUCTION } from './proposalDeckSkeletonV1';

// ---------------------------------------------------------------------------
// 起草指示文（設計 §4.1〜§4.4）
// ---------------------------------------------------------------------------

describe('buildDeckDraftInstruction: tag spec and no-create rules', () => {
  const instruction = buildDeckDraftInstruction();

  it('lists all nine fixed line-head tags from §4.1', () => {
    for (const tag of [
      '[導入]',
      '[資料タイトル]',
      '[要点]',
      '[節N_題目]',
      '[節N_主張]',
      '[節N_本文]',
      '[次の一手]',
      '[前提]',
      '[確認事項]',
    ]) {
      expect(instruction).toContain(tag);
    }
    expect(DECK_DRAFT_MAX_SECTIONS).toBe(9);
    expect(instruction).toContain('節は9つまで');
    expect(instruction).toContain('節番号Nは1からの連番');
  });

  it('contains all six no-create rules from §4.3', () => {
    // 1. 架空の固有名詞・価格・実績を作らない（一般名詞で表記する）。
    expect(instruction).toContain('製品名・企業名・具体的な価格・実績数値を作らないでください');
    expect(instruction).toContain('「本サービス」「貴社」のような一般名詞で書きます');
    // 2. 構成案（メタ説明）を書かない。本文そのものを書く。
    expect(instruction).toContain('構成案（スライドの説明、「表紙」「タイトル」「内容」のようなメタ説明）は書かないでください');
    expect(instruction).toContain('各タグには資料に載る本文そのものを書きます');
    // 3. 根拠のない数値は作らず [確認事項] に回す。
    expect(instruction).toContain('数値が必要だが根拠がない箇所は、数値を作らず[確認事項]に回してください');
    // 4. 仮定は [前提] に明示する。
    expect(instruction).toContain('仮定を置いた場合は、[前提]に明示してください');
    // 5. 主張タグには文として閉じた結論を書く。
    expect(instruction).toContain('[節N_主張]には、名詞で終わる題目ではなく、文として閉じた結論を書いてください');
    // 6. タグは省略せず、書けない場合は [確認事項] に不足として挙げる。
    expect(instruction).toContain('タグは省略しないでください');
    expect(instruction).toContain('無理に埋めず、[確認事項]に不足として挙げてください');
  });

  it('keeps the length within the D-PR-2 fixed cap (measured 1,437 chars)', () => {
    expect(instruction.length).toBeLessThanOrEqual(1500);
    // 骨格指示（996字）と同程度のオーダーに収まる（few-shot 必須分を含む）。
    expect(instruction.length).toBeLessThan(PROPOSAL_DECK_SKELETON_INSTRUCTION.length * 1.6);
  });
});

describe('buildDeckDraftInstruction: few-shot (§4.4, three kinds)', () => {
  const instruction = buildDeckDraftInstruction();
  const example1 = instruction.slice(instruction.indexOf('例1'), instruction.indexOf('例2'));
  const example2 = instruction.slice(instruction.indexOf('例2'), instruction.indexOf('例3'));
  const example3 = instruction.slice(instruction.indexOf('例3'));

  it('includes a success example with every tag filled', () => {
    expect(instruction).toContain('例1（材料が足りている場合）');
    for (const tag of ['[導入]', '[資料タイトル]', '[要点]', '[節1_主張]', '[節1_本文]', '[節2_主張]', '[次の一手]', '[前提]']) {
      expect(example1).toContain(tag);
    }
  });

  it('includes a no-assertion example that declares the gap in [確認事項] instead of forcing one', () => {
    expect(instruction).toContain('例2（主張文の材料がない節がある場合');
    // 主張タグを作らず、不足を [確認事項] に挙げる形を示す。
    expect(example2).not.toContain('[節1_主張]');
    expect(example2).toContain('[確認事項]');
    expect(example2).toContain('主張文を書くための材料');
  });

  it('includes an insufficient-material example that returns the gaps', () => {
    expect(instruction).toContain('例3（テーマだけで具体条件がない場合）');
    expect(example3).toContain('[確認事項]');
    expect(example3).toContain('確定している料金');
    expect(example3).toContain('本サービス');
  });

  it('uses no real company names, product names, or prices in the examples', () => {
    const examples = instruction.slice(instruction.indexOf('例1'));
    expect(examples).not.toContain('株式会社');
    expect(examples).not.toContain('円');
  });
});

// ---------------------------------------------------------------------------
// タグパーサ（設計 §4.1、§7.1 ゲート1）
// ---------------------------------------------------------------------------

const VALID_DRAFT = [
  '[導入]',
  '本資料では、店舗の在庫管理を見直す進め方をご提案します。',
  '[資料タイトル]',
  '在庫管理の見直し提案',
  '[要点]',
  '在庫の過不足が減り、欠品を防げます',
  '数え直しの手間が減ります',
  '発注の判断が早くなります',
  '[節1_題目]',
  '現状の課題',
  '[節1_主張]',
  '在庫の把握が担当者の記憶に頼っており、欠品が起きています。',
  '[節1_本文]',
  '棚卸しは月に一度だけです',
  '発注の基準が決まっていません',
  '[節2_題目]',
  '見直しの進め方',
  '[節2_主張]',
  '記録の方法を統一すれば、在庫を正確に把握できます。',
  '[節2_本文]',
  '記録先を一つの台帳に統一します',
  '週に一度、在庫を確認します',
  '[次の一手]',
  '台帳の試行を始める',
  '[前提]',
  '対象は店舗の在庫管理に限ります',
  '[確認事項]',
  '現在の在庫点数の確定情報が不足しています',
].join('\n');

function violationsWith(
  violations: readonly DeckFormatViolation[],
  code: DeckFormatViolation['code'],
): DeckFormatViolation[] {
  return violations.filter((violation) => violation.code === code);
}

describe('parseDeckDraft: well-formed draft', () => {
  it('parses all tags and multiple sections with no violations', () => {
    const parsed = parseDeckDraft(VALID_DRAFT);
    expect(parsed.violations).toEqual([]);
    expect(parsed.unassignedLineCount).toBe(0);
    expect(parsed.blocks.map((block) => block.tag)).toEqual([
      '導入',
      '資料タイトル',
      '要点',
      '節1_題目',
      '節1_主張',
      '節1_本文',
      '節2_題目',
      '節2_主張',
      '節2_本文',
      '次の一手',
      '前提',
      '確認事項',
    ]);
    const summary = parsed.blocks.find((block) => block.kind === 'summary');
    expect(summary?.lines).toEqual([
      '在庫の過不足が減り、欠品を防げます',
      '数え直しの手間が減ります',
      '発注の判断が早くなります',
    ]);
    const assertion2 = parsed.blocks.find((block) => block.tag === '節2_主張');
    expect(assertion2?.section).toBe(2);
    expect(assertion2?.lines).toEqual(['記録の方法を統一すれば、在庫を正確に把握できます。']);
  });

  it('accepts content written on the same line as its tag', () => {
    const parsed = parseDeckDraft(VALID_DRAFT.replace('[資料タイトル]\n在庫管理の見直し提案', '[資料タイトル] 在庫管理の見直し提案'));
    expect(parsed.violations).toEqual([]);
    const title = parsed.blocks.find((block) => block.kind === 'title');
    expect(title?.lines).toEqual(['在庫管理の見直し提案']);
  });
});

describe('parseDeckDraft: format violations (§7.1 gate 1)', () => {
  it('flags an unknown tag and leaves its lines unassigned', () => {
    const parsed = parseDeckDraft(`${VALID_DRAFT}\n[メモ]\n覚え書きの行`);
    const unknown = violationsWith(parsed.violations, 'DECK_FORMAT_UNKNOWN_TAG');
    expect(unknown).toEqual([{ code: 'DECK_FORMAT_UNKNOWN_TAG', tag: 'メモ', section: null, line: 29 }]);
    expect(parsed.unassignedLineCount).toBe(1);
  });

  it('flags a malformed section tag as unknown', () => {
    const parsed = parseDeckDraft(VALID_DRAFT.replace('[節1_主張]', '[節X_主張]'));
    const unknown = violationsWith(parsed.violations, 'DECK_FORMAT_UNKNOWN_TAG');
    expect(unknown.map((violation) => violation.tag)).toEqual(['節X_主張']);
    // 主張が未知タグに化けたため、節1の主張は欠落としても数える。
    const missing = violationsWith(parsed.violations, 'DECK_FORMAT_TAG_MISSING');
    expect(missing.map((violation) => violation.tag)).toContain('節1_主張');
  });

  it('flags a duplicated single required tag', () => {
    const parsed = parseDeckDraft(`${VALID_DRAFT}\n[要点]\n追加の要点`);
    const duplicated = violationsWith(parsed.violations, 'DECK_FORMAT_TAG_DUPLICATED');
    expect(duplicated).toEqual([{ code: 'DECK_FORMAT_TAG_DUPLICATED', tag: '要点', section: null, line: 29 }]);
  });

  it('flags a duplicated optional tag and a duplicated section tag', () => {
    const withAssumptions = parseDeckDraft(`${VALID_DRAFT}\n[前提]\n二つ目の前提`);
    expect(violationsWith(withAssumptions.violations, 'DECK_FORMAT_TAG_DUPLICATED').map((v) => v.tag)).toEqual(['前提']);
    const withAssertion = parseDeckDraft(`${VALID_DRAFT}\n[節1_主張]\n二つ目の主張です。`);
    expect(violationsWith(withAssertion.violations, 'DECK_FORMAT_TAG_DUPLICATED').map((v) => v.tag)).toEqual(['節1_主張']);
  });

  it('flags a gap in section numbering', () => {
    const draft = VALID_DRAFT.replaceAll('節2_', '節3_');
    const parsed = parseDeckDraft(draft);
    const gaps = violationsWith(parsed.violations, 'DECK_FORMAT_SECTION_SEQUENCE_GAP');
    expect(gaps).toEqual([{ code: 'DECK_FORMAT_SECTION_SEQUENCE_GAP', tag: null, section: 2, line: null }]);
    // 連番欠けで存在しない節2は、必須タグ欠落の対象にしない。
    const missing = violationsWith(parsed.violations, 'DECK_FORMAT_TAG_MISSING');
    expect(missing.filter((violation) => violation.section === 2)).toEqual([]);
  });

  it('flags numbering that does not start at 1', () => {
    // 節2_ を先に 節3_ へずらしてから 節1_ を 節2_ にし、節の集合を {2, 3} にする。
    const draft = VALID_DRAFT.replaceAll('節2_', '節3_').replaceAll('節1_', '節2_');
    const parsed = parseDeckDraft(draft);
    const gaps = violationsWith(parsed.violations, 'DECK_FORMAT_SECTION_SEQUENCE_GAP');
    expect(gaps.map((violation) => violation.section)).toEqual([1]);
  });

  it('flags a missing required single tag', () => {
    const draft = VALID_DRAFT.replace('[次の一手]\n台帳の試行を始める\n', '');
    const parsed = parseDeckDraft(draft);
    const missing = violationsWith(parsed.violations, 'DECK_FORMAT_TAG_MISSING');
    expect(missing).toEqual([{ code: 'DECK_FORMAT_TAG_MISSING', tag: '次の一手', section: null, line: null }]);
  });

  it('flags a section whose assertion tag is missing', () => {
    const draft = VALID_DRAFT.replace('[節1_主張]\n在庫の把握が担当者の記憶に頼っており、欠品が起きています。\n', '');
    const parsed = parseDeckDraft(draft);
    const missing = violationsWith(parsed.violations, 'DECK_FORMAT_TAG_MISSING');
    expect(missing).toEqual([{ code: 'DECK_FORMAT_TAG_MISSING', tag: '節1_主張', section: 1, line: null }]);
  });

  it('flags a draft with no sections at all as missing section 1 assertion and body', () => {
    const draft = ['[導入]', '案内文です。', '[資料タイトル]', '題名', '[要点]', '要点です', '[次の一手]', '始める'].join('\n');
    const parsed = parseDeckDraft(draft);
    const missing = violationsWith(parsed.violations, 'DECK_FORMAT_TAG_MISSING');
    expect(missing.map((violation) => violation.tag)).toEqual(['節1_主張', '節1_本文']);
  });

  it('flags every required tag as missing for an empty draft', () => {
    const parsed = parseDeckDraft('');
    const missing = violationsWith(parsed.violations, 'DECK_FORMAT_TAG_MISSING');
    expect(missing.map((violation) => violation.tag)).toEqual([
      '導入',
      '資料タイトル',
      '要点',
      '節1_主張',
      '節1_本文',
      '次の一手',
    ]);
    expect(parsed.blocks).toEqual([]);
  });

  it('counts lines before the first tag as unassigned', () => {
    const parsed = parseDeckDraft(`前置きの行\n${VALID_DRAFT}`);
    expect(parsed.unassignedLineCount).toBe(1);
    expect(parsed.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 起草→材料レコード変換（設計 §4.2）
// ---------------------------------------------------------------------------

describe('convertDeckDraftToMaterial: unit splitting (§4.2)', () => {
  const conversion = convertDeckDraftToMaterial(parseDeckDraft(VALID_DRAFT));

  it('makes one unit per summary line, body line, and next-step line, and one per assertion', () => {
    expect(conversion.summaryUnits.map((unit) => unit.text)).toEqual([
      '在庫の過不足が減り、欠品を防げます',
      '数え直しの手間が減ります',
      '発注の判断が早くなります',
    ]);
    expect(conversion.summaryUnits.every((unit) => unit.kind === 'bullet')).toBe(true);
    expect(conversion.nextStepUnits.map((unit) => unit.text)).toEqual(['台帳の試行を始める']);
    expect(conversion.sections).toHaveLength(2);
    expect(conversion.sections[0].assertionUnit?.text).toBe('在庫の把握が担当者の記憶に頼っており、欠品が起きています。');
    expect(conversion.sections[0].assertionUnit?.kind).toBe('sentence');
    expect(conversion.sections[0].bodyUnits.map((unit) => unit.text)).toEqual([
      '棚卸しは月に一度だけです',
      '発注の基準が決まっていません',
    ]);
    expect(conversion.sections[1].bodyUnits.map((unit) => unit.text)).toEqual([
      '記録先を一つの台帳に統一します',
      '週に一度、在庫を確認します',
    ]);
  });

  it('assigns D-IDs in document order across all units, all model-draft', () => {
    expect(conversion.units.map((unit) => unit.id)).toEqual([
      'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10',
    ]);
    expect(conversion.units.every((unit) => unit.sourceKind === 'model-draft')).toBe(true);
    expect(conversion.units[3]).toBe(conversion.sections[0].assertionUnit);
    expect(conversion.units).toHaveLength(10);
  });

  it('keeps the section topic as a candidate, not a unit', () => {
    expect(conversion.sections[0].topicCandidate).toBe('現状の課題');
    expect(conversion.sections[1].topicCandidate).toBe('見直しの進め方');
    expect(conversion.units.map((unit) => unit.text)).not.toContain('現状の課題');
    expect(conversion.units.map((unit) => unit.text)).not.toContain('見直しの進め方');
  });

  it('keeps introduction, title, assumptions, and questions as draft-level info, not units', () => {
    expect(conversion.introduction).toBe('本資料では、店舗の在庫管理を見直す進め方をご提案します。');
    expect(conversion.title).toBe('在庫管理の見直し提案');
    expect(conversion.assumptions).toEqual(['対象は店舗の在庫管理に限ります']);
    expect(conversion.questions).toEqual(['現在の在庫点数の確定情報が不足しています']);
    const unitTexts = conversion.units.map((unit) => unit.text);
    expect(unitTexts).not.toContain('在庫管理の見直し提案');
    expect(unitTexts).not.toContain('対象は店舗の在庫管理に限ります');
  });

  it('returns null topic and assertion for a section that has only a body', () => {
    const draft = VALID_DRAFT
      .replace('[節2_題目]\n見直しの進め方\n', '')
      .replace('[節2_主張]\n記録の方法を統一すれば、在庫を正確に把握できます。\n', '');
    const result = convertDeckDraftToMaterial(parseDeckDraft(draft));
    expect(result.sections[1].topicCandidate).toBeNull();
    expect(result.sections[1].assertionUnit).toBeNull();
    expect(result.sections[1].bodyUnits).toHaveLength(2);
  });

  it('converts only the first block when a tag is duplicated', () => {
    const parsed = parseDeckDraft(`${VALID_DRAFT}\n[要点]\n後からの要点`);
    const result = convertDeckDraftToMaterial(parsed);
    expect(result.summaryUnits.map((unit) => unit.text)).not.toContain('後からの要点');
    expect(result.summaryUnits).toHaveLength(3);
  });

  it('compacts a multi-line assertion block into a single unit without changing words', () => {
    const draft = VALID_DRAFT.replace(
      '在庫の把握が担当者の記憶に頼っており、欠品が起きています。',
      '在庫の把握が担当者の記憶に頼っており、\n欠品が起きています。',
    );
    const result = convertDeckDraftToMaterial(parseDeckDraft(draft));
    expect(result.sections[0].assertionUnit?.text).toBe('在庫の把握が担当者の記憶に頼っており、 欠品が起きています。');
  });
});

describe('convertDeckDraftToMaterial: verbatim guarantee (G1 for mode B)', () => {
  it('every converted unit is verbatim in the original draft (checkDeckVerbatim)', () => {
    const parsed = parseDeckDraft(VALID_DRAFT);
    const conversion = convertDeckDraftToMaterial(parsed);
    // 原文の材料集合は、起草の全内容行（タグ行を除く非空行）をそのまま
    // 単位化したもの。変換後の単位がすべてこの集合の逐語であれば、
    // 変換側が文字列を書き換えていないことが決定的に示せる。
    const contentLines = VALID_DRAFT.split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('['));
    const referenceUnits = buildDeckDraftUnits(contentLines.map((text) => ({ text })));
    const result = checkDeckVerbatim(
      conversion.units.map((unit) => unit.text),
      referenceUnits,
    );
    expect(result.checkedCount).toBe(conversion.units.length);
    expect(result.ok).toBe(true);
    // 対照: 書き換えた文字列は同じ照合で落ちる（照合に検出能力があること）。
    const tampered = checkDeckVerbatim(['在庫の把握は記憶に頼っています。'], referenceUnits);
    expect(tampered.ok).toBe(false);
  });
});
