import { describe, expect, it } from 'vitest';
import {
  convertAssembledDeckToProposalDeck,
  convertDeckTableUnit,
  parseDeckTableRows,
  splitDeckBulletText,
} from './proposalDeckRenderV1.js';
import {
  assembleDeckFromDraft,
  assembleDeckFromMaterial,
  type DeckAssembledDocument,
  type DeckAssembledSection,
} from './proposalDeckAssemblyV1.js';
import {
  checkDeckVerbatim,
  type DeckMaterialUnit,
} from './proposalDeckRecordsV1.js';
import { checkProposalDeck } from './proposalDeckSelfCheckV1.js';

// 資料レコード再設計 D-PR-5（描画アダプタ）の恒常テスト。
// 設計正本: ~/workspace/origin-fix/DECK_RECORDS_REDESIGN_2026-11-15.md
// （§5 二重描画、§6.1 2フィールド化、§7.3 箇条書き条件、
// §7.5 表示、§13-12 表の写像）
// - lead/detail 分割はテキストの分割であり、lead + detail が元の
//   単位テキストと正確に一致すること（改変ゼロ）を規則ごとに固定。
// - 表は行・列へ決定的に変換し、セルは逐語（強調記法も除去しない）。
// - 変換後の ProposalDeck が現行自己チェック（checkProposalDeck）を
//   通ることを固定。現行条件と衝突する形（60字超の単位、表の行数
//   超過、受動形の見出し）は、緩和も切り捨てもせず、衝突として
//   表面化することを固定する。

// ---------------------------------------------------------------------------
// lead/detail 分割（規則 S1〜S3）
// ---------------------------------------------------------------------------

describe('splitDeckBulletText', () => {
  it('S1: splits after a full-width colon, keeping the colon at the end of the lead', () => {
    expect(splitDeckBulletText('導入効果：月40時間を削減できます')).toEqual({
      lead: '導入効果：',
      detail: '月40時間を削減できます',
    });
  });

  it('S1: splits after a half-width colon and preserves the following space in the detail', () => {
    expect(splitDeckBulletText('効果: 月40時間を削減できます')).toEqual({
      lead: '効果:',
      detail: ' 月40時間を削減できます',
    });
  });

  it('S1: does not treat a digit-flanked half-width colon (time) as a separator', () => {
    expect(splitDeckBulletText('開始は10:30からです')).toEqual({
      lead: '開始は10:30からです',
      detail: '',
    });
  });

  it('S1: does not treat a digit-flanked full-width colon (ratio) as a separator', () => {
    expect(splitDeckBulletText('配分は3：5の比率です')).toEqual({
      lead: '配分は3：5の比率です',
      detail: '',
    });
  });

  it('S1: ignores a colon at the very start or the very end', () => {
    expect(splitDeckBulletText('：先頭のコロンは区切りではありません')).toEqual({
      lead: '：先頭のコロンは区切りではありません',
      detail: '',
    });
    expect(splitDeckBulletText('要点は次のとおり：')).toEqual({
      lead: '要点は次のとおり：',
      detail: '',
    });
  });

  it('S1: takes priority over the sentence boundary', () => {
    expect(
      splitDeckBulletText('次の3点です：月40時間を削減できます。初期費用も回収できます'),
    ).toEqual({
      lead: '次の3点です：',
      detail: '月40時間を削減できます。初期費用も回収できます',
    });
  });

  it('S2: splits after the first sentence end when a continuation follows', () => {
    expect(splitDeckBulletText('月40時間を削減できます。さらに品質も向上します')).toEqual({
      lead: '月40時間を削減できます。',
      detail: 'さらに品質も向上します',
    });
  });

  it('S2: absorbs closing brackets into the lead', () => {
    expect(splitDeckBulletText('「月40時間を削減できます。」が結論です')).toEqual({
      lead: '「月40時間を削減できます。」',
      detail: 'が結論です',
    });
  });

  it('S2: does not split at a trailing sentence end', () => {
    expect(splitDeckBulletText('月40時間を削減できます。')).toEqual({
      lead: '月40時間を削減できます。',
      detail: '',
    });
  });

  it('S3: keeps the whole unit as the lead when there is no separator', () => {
    expect(splitDeckBulletText('転記作業が不要になります')).toEqual({
      lead: '転記作業が不要になります',
      detail: '',
    });
  });

  it('returns empty parts for an empty text', () => {
    expect(splitDeckBulletText('')).toEqual({ lead: '', detail: '' });
  });

  it('is a pure partition: lead + detail always reconstructs the input verbatim', () => {
    const samples = [
      '導入効果：月40時間を削減できます',
      '効果: 月40時間を削減できます',
      '開始は10:30からです',
      '配分は3：5の比率です',
      '月40時間を削減できます。さらに品質も向上します',
      '「月40時間を削減できます。」が結論です',
      '月40時間を削減できます。',
      '転記作業が不要になります',
      '：先頭のコロンは区切りではありません',
      '要点は次のとおり：',
      '',
    ];
    for (const sample of samples) {
      const { lead, detail } = splitDeckBulletText(sample);
      expect(lead + detail).toBe(sample);
      if (sample !== '') expect(lead).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// 表の変換（規則 T1〜T5）
// ---------------------------------------------------------------------------

const TABLE_TEXT = [
  '| 項目 | 値 | 備考 |',
  '| --- | --- | --- |',
  '| 月額費用 | 3万円 | 初期費用は別 |',
  '| 導入期間 | 2週間 |',
].join('\n');

function tableUnit(text: string): DeckMaterialUnit {
  return { id: 'M9', text, sourceKind: 'user-material', kind: 'table' };
}

describe('parseDeckTableRows', () => {
  it('separates the header row from the data rows when a separator row exists (T3)', () => {
    const { header, rows } = parseDeckTableRows(TABLE_TEXT);
    expect(header).toEqual(['項目', '値', '備考']);
    expect(rows).toEqual([
      ['月額費用', '3万円', '初期費用は別'],
      ['導入期間', '2週間'],
    ]);
  });

  it('treats every row as data when there is no separator row (T3)', () => {
    const { header, rows } = parseDeckTableRows('| 項目A | 10 |\n| 項目B | 20 |');
    expect(header).toBeNull();
    expect(rows).toEqual([
      ['項目A', '10'],
      ['項目B', '20'],
    ]);
  });

  it('keeps cell text verbatim, including emphasis markers (T1, unlike the legacy fallback)', () => {
    const { rows } = parseDeckTableRows('| --- | --- |\n| **月額費用** | 3万円 |');
    expect(rows).toEqual([['**月額費用**', '3万円']]);
  });
});

describe('convertDeckTableUnit', () => {
  it('converts data rows to bullets: lead is the first cell, detail joins the rest with ： (T4)', () => {
    const converted = convertDeckTableUnit(tableUnit(TABLE_TEXT));
    expect(converted.header).toEqual(['項目', '値', '備考']);
    expect(converted.bullets).toEqual([
      { lead: '月額費用', detail: '3万円：初期費用は別' },
      { lead: '導入期間', detail: '2週間' },
    ]);
    expect(converted.skippedEmptyLeadRows).toBe(0);
  });

  it('returns no bullets for a header-only table', () => {
    const converted = convertDeckTableUnit(tableUnit('| 項目 | 値 |\n| --- | --- |'));
    expect(converted.header).toEqual(['項目', '値']);
    expect(converted.bullets).toEqual([]);
  });

  it('skips data rows whose first cell is empty and counts them (T4)', () => {
    const converted = convertDeckTableUnit(
      tableUnit('| 項目 | 値 |\n| --- | --- |\n| | 5万円 |\n| 導入期間 | 2週間 |'),
    );
    expect(converted.bullets).toEqual([{ lead: '導入期間', detail: '2週間' }]);
    expect(converted.skippedEmptyLeadRows).toBe(1);
  });

  it('gives an empty detail for single-column rows (T4)', () => {
    const converted = convertDeckTableUnit(tableUnit('| 見出し |\n| --- |\n| 値だけ |'));
    expect(converted.header).toEqual(['見出し']);
    expect(converted.bullets).toEqual([{ lead: '値だけ', detail: '' }]);
  });
});

// ---------------------------------------------------------------------------
// 組立文書 → ProposalDeck（手組みの組立文書）
// ---------------------------------------------------------------------------

let unitSeq = 0;
function makeUnit(
  text: string,
  kind: DeckMaterialUnit['kind'] = 'sentence',
): DeckMaterialUnit {
  unitSeq += 1;
  return { id: `M${unitSeq}`, text, sourceKind: 'user-material', kind };
}

function makeSection(input: {
  role: DeckAssembledSection['role'];
  topic?: string | null;
  message: string | null;
  body?: readonly DeckMaterialUnit[];
}): DeckAssembledSection {
  const topicUnit = input.topic != null ? makeUnit(input.topic) : null;
  return {
    role: input.role,
    topicUnit,
    topicText: input.topic ?? null,
    messageUnit: input.message != null ? makeUnit(input.message) : null,
    bodyUnits: input.body ?? [],
    promoted: false,
  };
}

function makeDocument(
  overrides: Partial<DeckAssembledDocument> = {},
): DeckAssembledDocument {
  return {
    mode: 'A',
    titleText: 'ご提案のタイトル',
    titleUnit: makeUnit('ご提案のタイトル'),
    summaryUnits: [
      makeUnit('要点の一つ目です'),
      makeUnit('要点の二つ目です'),
      makeUnit('要点の三つ目です'),
    ],
    sections: [
      makeSection({
        role: 'challenge',
        topic: '現状の課題',
        message: '経理担当者が少なく、月末に業務が集中しています。',
        body: [makeUnit('紙の領収書の管理に時間がかかっています。')],
      }),
      makeSection({
        role: 'solution',
        topic: '解決策',
        message: '仕訳の自動化で月末作業の手間を減らせます。',
        body: [makeUnit('領収書を撮影するだけで取り込めます')],
      }),
      makeSection({
        role: 'value',
        topic: null,
        message: '月40時間の作業を削減できます。',
        body: [makeUnit('残業代を年間120万円削減できます')],
      }),
    ],
    nextStepUnits: [makeUnit('まずは無料相談をお申し込みください', 'bullet')],
    introduction: null,
    assumptions: ['対象は経理業務に限ります'],
    questions: [],
    ...overrides,
  };
}

describe('convertAssembledDeckToProposalDeck (hand-built documents)', () => {
  it('converts the two headline fields: topic as the section topic, message as the headline', () => {
    const result = convertAssembledDeckToProposalDeck(makeDocument());
    expect(result.ok).toBe(true);
    const deck = result.deck;
    expect(deck?.title).toBe('ご提案のタイトル');
    expect(deck?.summary.points).toEqual([
      '要点の一つ目です',
      '要点の二つ目です',
      '要点の三つ目です',
    ]);
    expect(deck?.sections[0].topic).toBe('現状の課題');
    expect(deck?.sections[0].message).toBe('経理担当者が少なく、月末に業務が集中しています。');
    expect(deck?.sections.map((section) => section.role)).toEqual([
      'challenge',
      'solution',
      'value',
    ]);
    expect(deck?.closing.nextSteps).toEqual(['まずは無料相談をお申し込みください']);
    expect(deck?.assumptions).toEqual(['対象は経理業務に限ります']);
    expect(result.tableSectionIndexes).toEqual([]);
    expect(result.overlongBullets).toEqual([]);
  });

  it('omits the topic field when the section has no topic', () => {
    const result = convertAssembledDeckToProposalDeck(makeDocument());
    expect(result.deck?.sections[2].topic).toBeUndefined();
  });

  it('leaves fields without material empty instead of fabricating them', () => {
    const result = convertAssembledDeckToProposalDeck(makeDocument());
    expect(result.deck?.subtitle).toBe('');
    expect(result.deck?.date).toBe('');
    expect(result.deck?.summary.headline).toBe('');
    expect(result.deck?.closing.ask).toBe('');
    expect(result.deck?.presenter).toBeUndefined();
  });

  it('passes the legacy self-check for a well-formed document', () => {
    const result = convertAssembledDeckToProposalDeck(makeDocument());
    const check = checkProposalDeck(result.deck as NonNullable<typeof result.deck>);
    expect(check.ok).toBe(true);
    expect(check.violations).toEqual([]);
  });

  it('keeps every placed string verbatim: whole-unit fields match units, bullets partition units', () => {
    const document = makeDocument();
    const result = convertAssembledDeckToProposalDeck(document);
    const deck = result.deck as NonNullable<typeof result.deck>;
    const units: DeckMaterialUnit[] = [
      ...(document.titleUnit ? [document.titleUnit] : []),
      ...document.summaryUnits,
      ...document.sections.flatMap((section) => [
        ...(section.topicUnit ? [section.topicUnit] : []),
        ...(section.messageUnit ? [section.messageUnit] : []),
        ...section.bodyUnits,
      ]),
      ...document.nextStepUnits,
    ];
    const wholeUnitTexts = [
      deck.title,
      ...deck.summary.points,
      ...deck.sections.flatMap((section) =>
        section.topic !== undefined ? [section.topic, section.message] : [section.message],
      ),
      ...deck.closing.nextSteps,
    ];
    expect(checkDeckVerbatim(wholeUnitTexts, units).ok).toBe(true);
    deck.sections.forEach((section, sectionIndex) => {
      const bodyUnits = document.sections[sectionIndex].bodyUnits;
      expect(section.bullets.map((bullet) => bullet.lead + bullet.detail)).toEqual(
        bodyUnits.map((unit) => unit.text),
      );
    });
  });

  it('renders a section containing a table unit as a visual table, preserving order with text units', () => {
    const document = makeDocument();
    const tableSection = makeSection({
      role: 'cost',
      topic: '費用',
      message: '費用は月額3万円から始められます。',
      body: [makeUnit('料金の内訳は次のとおりです'), makeUnit(TABLE_TEXT, 'table')],
    });
    const withTable: DeckAssembledDocument = {
      ...document,
      sections: [document.sections[0], tableSection, document.sections[2]],
    };
    const result = convertAssembledDeckToProposalDeck(withTable);
    expect(result.ok).toBe(true);
    expect(result.tableSectionIndexes).toEqual([1]);
    expect(result.tableHeaders).toEqual([
      { sectionIndex: 1, header: ['項目', '値', '備考'] },
    ]);
    const section = result.deck?.sections[1];
    expect(section?.visual).toEqual({ kind: 'table' });
    expect(section?.bullets).toEqual([
      { lead: '料金の内訳は次のとおりです', detail: '' },
      { lead: '月額費用', detail: '3万円：初期費用は別' },
      { lead: '導入期間', detail: '2週間' },
    ]);
    const check = checkProposalDeck(result.deck as NonNullable<typeof result.deck>);
    expect(check.ok).toBe(true);
  });

  it('does not set a table visual when the table yields no data rows', () => {
    const document = makeDocument();
    const headerOnly = makeSection({
      role: 'cost',
      topic: '費用',
      message: '費用は月額3万円から始められます。',
      body: [makeUnit('| 項目 | 値 |\n| --- | --- |', 'table')],
    });
    const result = convertAssembledDeckToProposalDeck({
      ...document,
      sections: [document.sections[0], headerOnly, document.sections[2]],
    });
    expect(result.ok).toBe(true);
    expect(result.tableSectionIndexes).toEqual([]);
    expect(result.deck?.sections[1].visual).toBeUndefined();
    expect(result.deck?.sections[1].bullets).toEqual([]);
  });

  it('fails closed with SECTION_MESSAGE_MISSING when a section has no message', () => {
    const document = makeDocument();
    const noMessage = makeSection({
      role: 'solution',
      topic: '解決策',
      message: null,
      body: [makeUnit('領収書を撮影するだけで取り込めます')],
    });
    const result = convertAssembledDeckToProposalDeck({
      ...document,
      sections: [document.sections[0], noMessage, document.sections[2]],
    });
    expect(result.ok).toBe(false);
    expect(result.deck).toBeNull();
    expect(result.issues).toEqual([{ code: 'SECTION_MESSAGE_MISSING', sectionIndex: 1 }]);
  });

  it('fails closed for a missing title, a wrong point count, no sections and no next steps', () => {
    const document = makeDocument();
    const broken: DeckAssembledDocument = {
      ...document,
      titleText: null,
      titleUnit: null,
      summaryUnits: document.summaryUnits.slice(0, 2),
      sections: [],
      nextStepUnits: [],
    };
    const result = convertAssembledDeckToProposalDeck(broken);
    expect(result.ok).toBe(false);
    expect(result.deck).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'TITLE_MISSING',
      'SUMMARY_POINTS_INVALID',
      'SECTIONS_EMPTY',
      'NEXT_STEPS_MISSING',
    ]);
  });

  it('is deterministic: the same document converts to a deeply equal deck', () => {
    const document = makeDocument();
    const first = convertAssembledDeckToProposalDeck(document);
    const second = convertAssembledDeckToProposalDeck(document);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// 現行自己チェックとの衝突（緩和せず、切り捨てず、表面化させる）
// ---------------------------------------------------------------------------

describe('conflicts with the legacy self-check (surfaced, never loosened)', () => {
  it('keeps a unit longer than 60 chars whole and surfaces BULLET_TOO_LONG', () => {
    const longText =
      '本サービスを導入することで、経理担当者の月末作業にかかる時間を毎月40時間削減し、残業代の削減と締め作業の早期化にもつながります。';
    const charCount = [...longText].length;
    expect(charCount).toBeGreaterThan(60);
    const document = makeDocument();
    const longSection = makeSection({
      role: 'challenge',
      topic: '現状の課題',
      message: '経理担当者が少なく、月末に業務が集中しています。',
      body: [makeUnit(longText)],
    });
    const result = convertAssembledDeckToProposalDeck({
      ...document,
      sections: [longSection, document.sections[1], document.sections[2]],
    });
    // 変換自体は行い、テキストは切り捨てない（§7.5）。
    expect(result.ok).toBe(true);
    const bullet = result.deck?.sections[0].bullets[0];
    expect((bullet?.lead ?? '') + (bullet?.detail ?? '')).toBe(longText);
    expect(result.overlongBullets).toEqual([
      { sectionIndex: 0, bulletIndex: 0, charCount },
    ]);
    const check = checkProposalDeck(result.deck as NonNullable<typeof result.deck>);
    expect(check.violations.map((violation) => violation.code)).toEqual(['BULLET_TOO_LONG']);
  });

  it('keeps all table rows and surfaces TOO_MANY_BULLETS when a table exceeds four rows', () => {
    const bigTable = [
      '| 項目 | 値 |',
      '| --- | --- |',
      '| 項目1 | 1 |',
      '| 項目2 | 2 |',
      '| 項目3 | 3 |',
      '| 項目4 | 4 |',
      '| 項目5 | 5 |',
    ].join('\n');
    const document = makeDocument();
    const tableSection = makeSection({
      role: 'cost',
      topic: '費用',
      message: '費用は月額3万円から始められます。',
      body: [makeUnit(bigTable, 'table')],
    });
    const result = convertAssembledDeckToProposalDeck({
      ...document,
      sections: [document.sections[0], tableSection, document.sections[2]],
    });
    expect(result.ok).toBe(true);
    expect(result.deck?.sections[1].bullets).toHaveLength(5);
    const check = checkProposalDeck(result.deck as NonNullable<typeof result.deck>);
    expect(check.violations.map((violation) => violation.code)).toEqual(['TOO_MANY_BULLETS']);
  });

  it('converts a passive-closing message that the records gate accepts, and the legacy check flags it', () => {
    // 資料レコード側の主張文判定（§7.4）は受動形の閉じを認めるが、
    // 併存する旧自己チェックの isAssertion は認めない（D-PR-4 で
    // 意図した切り分け）。変換は逐語のまま行い、旧チェック側で
    // HEADLINE_NOT_ASSERTION として表面化する。
    const document = makeDocument();
    const passive = makeSection({
      role: 'solution',
      topic: '解決策',
      message: '月40時間の作業が削減された',
      body: [makeUnit('領収書を撮影するだけで取り込めます')],
    });
    const result = convertAssembledDeckToProposalDeck({
      ...document,
      sections: [document.sections[0], passive, document.sections[2]],
    });
    expect(result.ok).toBe(true);
    expect(result.deck?.sections[1].message).toBe('月40時間の作業が削減された');
    const check = checkProposalDeck(result.deck as NonNullable<typeof result.deck>);
    expect(check.violations.map((violation) => violation.code)).toEqual([
      'HEADLINE_NOT_ASSERTION',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 組立（D-PR-4）からの連結: 現行自己チェックをそのまま通ること
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

describe('end to end from assembly (D-PR-4) to the legacy self-check', () => {
  it('mode A: an assembled document converts to a deck that passes the legacy self-check, numerics included', () => {
    const assembled = assembleDeckFromMaterial({ materialText: DETERMINISTIC_MATERIAL });
    expect(assembled.ok).toBe(true);
    const document = assembled.document as DeckAssembledDocument;
    const result = convertAssembledDeckToProposalDeck(document);
    expect(result.ok).toBe(true);
    expect(result.overlongBullets).toEqual([]);
    const deck = result.deck as NonNullable<typeof result.deck>;
    expect(deck.title).toBe('クラウド会計サービスのご提案');
    expect(deck.sections[0].topic).toBe('現状の課題');
    expect(deck.sections[0].message).toBe('経理担当者が少なく、月末に業務が集中しています。');

    const placedTexts = [
      document.titleText,
      ...document.summaryUnits.map((unit) => unit.text),
      ...document.sections.flatMap((section) => [
        section.topicText,
        section.messageUnit?.text ?? null,
        ...section.bodyUnits.map((unit) => unit.text),
      ]),
      ...document.nextStepUnits.map((unit) => unit.text),
    ].filter((text): text is string => text !== null);
    const check = checkProposalDeck(deck, { numericSourceTexts: placedTexts });
    expect(check.ok).toBe(true);
    expect(check.violations).toEqual([]);
  });

  it('mode B: an assembled draft converts to a deck that passes the legacy self-check', () => {
    const assembled = assembleDeckFromDraft({ draftText: VALID_DRAFT });
    expect(assembled.ok).toBe(true);
    const document = assembled.document as DeckAssembledDocument;
    const result = convertAssembledDeckToProposalDeck(document);
    expect(result.ok).toBe(true);
    const deck = result.deck as NonNullable<typeof result.deck>;
    expect(deck.title).toBe('経理の手間を減らす仕組みのご提案');
    expect(deck.sections[0].topic).toBe('現状の課題');
    expect(deck.sections[0].message).toBe('経理担当者が少なく、月末に業務が集中しています。');
    expect(deck.assumptions).toEqual(['対象は経理業務に限ります']);
    const check = checkProposalDeck(deck);
    expect(check.ok).toBe(true);
    expect(check.violations).toEqual([]);
  });
});
