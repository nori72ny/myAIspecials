/**
 * D-PR-6: チャット表示レンダラ（材料レコード → Markdown）。
 * 掲載文字列がすべて材料の逐語であること、2段見出しの形、表の
 * 逐語保持、材料種別の定型注記を固定する。
 */
import { describe, expect, it } from 'vitest';
import type {
  DeckAssembledDocument,
  DeckAssembledSection,
} from './proposalDeckAssemblyV1.js';
import {
  DECK_RECORDS_CHAT_SOURCE_NOTE,
  renderDeckRecordsChatMarkdown,
} from './proposalDeckChatRenderV1.js';
import type { DeckMaterialUnit } from './proposalDeckRecordsV1.js';

function unit(
  id: string,
  text: string,
  kind: DeckMaterialUnit['kind'] = 'sentence',
): DeckMaterialUnit {
  return {
    id,
    text,
    sourceKind: id.startsWith('D') ? 'model-draft' : 'user-material',
    kind,
  };
}

function section(partial: Partial<DeckAssembledSection>): DeckAssembledSection {
  return {
    role: 'challenge',
    topicUnit: null,
    topicText: null,
    messageUnit: null,
    bodyUnits: [],
    promoted: false,
    ...partial,
  };
}

const TABLE_TEXT = '| 項目 | 効果 |\n| --- | --- |\n| 仕訳 | 月40時間削減 |';

function sampleDocument(): DeckAssembledDocument {
  return {
    mode: 'A',
    titleText: 'クラウド会計サービスのご提案',
    titleUnit: unit('M1', 'クラウド会計サービスのご提案'),
    summaryUnits: [
      unit('M2', '経理の手間を月40時間削減できます', 'bullet'),
      unit('M3', '初期費用を3か月で回収できます', 'bullet'),
      unit('M4', '来月から段階的に導入できます', 'bullet'),
    ],
    sections: [
      section({
        topicText: '現状の課題',
        topicUnit: unit('M5', '現状の課題'),
        messageUnit: unit('M6', '経理担当者が少なく、月末に業務が集中しています。'),
        bodyUnits: [
          unit('M7', '紙の領収書の管理に時間がかかっています。'),
          unit('M8', TABLE_TEXT, 'table'),
        ],
      }),
      section({
        role: 'solution',
        messageUnit: unit('M9', '仕訳の自動化で月末作業の手間を減らせます。'),
        bodyUnits: [unit('M10', '領収書を撮影するだけで取り込めます', 'bullet')],
      }),
    ],
    nextStepUnits: [unit('M11', 'まずは無料相談をお申し込みください', 'bullet')],
    introduction: null,
    assumptions: [],
    questions: [],
  };
}

describe('renderDeckRecordsChatMarkdown (D-PR-6, §5)', () => {
  it('renders title, source note, summary, two-tier section headings and next steps', () => {
    const markdown = renderDeckRecordsChatMarkdown(sampleDocument());
    expect(markdown).toContain('# クラウド会計サービスのご提案');
    expect(markdown).toContain(DECK_RECORDS_CHAT_SOURCE_NOTE.A);
    expect(markdown).toContain('## 要点');
    expect(markdown).toContain('- 経理の手間を月40時間削減できます');
    // 2段見出し: 題目（###）が主張文（##）の上に来る。
    const topicIndex = markdown.indexOf('### 現状の課題');
    const messageIndex = markdown.indexOf(
      '## 経理担当者が少なく、月末に業務が集中しています。',
    );
    expect(topicIndex).toBeGreaterThan(-1);
    expect(messageIndex).toBeGreaterThan(topicIndex);
    // 題目の無い節は主張文だけが見出しになる。
    expect(markdown).toContain('## 仕訳の自動化で月末作業の手間を減らせます。');
    expect(markdown).toContain('## 次の一手');
    expect(markdown).toContain('- まずは無料相談をお申し込みください');
  });

  it('keeps table units verbatim as their own block', () => {
    const markdown = renderDeckRecordsChatMarkdown(sampleDocument());
    expect(markdown).toContain(TABLE_TEXT);
  });

  it('renders mode B introduction, assumptions and questions, with the draft source note', () => {
    const document: DeckAssembledDocument = {
      ...sampleDocument(),
      mode: 'B',
      introduction: '本資料では、経理の手間を減らす進め方をご提案します。',
      assumptions: ['対象は経理部門に限ります'],
      questions: ['正式なサービス名が不足しています'],
    };
    const markdown = renderDeckRecordsChatMarkdown(document);
    expect(markdown.startsWith('本資料では、経理の手間を減らす進め方をご提案します。')).toBe(true);
    expect(markdown).toContain(DECK_RECORDS_CHAT_SOURCE_NOTE.B);
    expect(markdown).toContain('## 前提');
    expect(markdown).toContain('- 対象は経理部門に限ります');
    expect(markdown).toContain('## 確認事項');
    expect(markdown).toContain('- 正式なサービス名が不足しています');
  });

  it('renders partial documents by skipping missing parts and switching the note', () => {
    const document: DeckAssembledDocument = {
      mode: 'A',
      titleText: null,
      titleUnit: null,
      summaryUnits: [unit('M2', '経理の手間を月40時間削減できます', 'bullet')],
      sections: [
        section({
          topicText: '現状の課題',
          topicUnit: unit('M5', '現状の課題'),
          bodyUnits: [unit('M7', '紙の領収書の管理に時間がかかっています。')],
        }),
      ],
      nextStepUnits: [],
      introduction: null,
      assumptions: [],
      questions: [],
    };
    const markdown = renderDeckRecordsChatMarkdown(document, { partial: true });
    expect(markdown).not.toMatch(/^# /m);
    expect(markdown).toContain('ご提示の素材をもとに、作成できた範囲をお示しします。');
    expect(markdown).toContain('- 経理の手間を月40時間削減できます');
    // 主張文の無い節は題目を見出しにする。
    expect(markdown).toContain('## 現状の課題');
    expect(markdown).not.toContain('## 次の一手');
  });

  it('contains only verbatim material strings (G1 on the chat surface)', () => {
    const document = sampleDocument();
    const markdown = renderDeckRecordsChatMarkdown(document);
    const materialTexts = [
      document.titleText as string,
      ...document.summaryUnits.map((u) => u.text),
      ...document.sections.flatMap((s) => [
        ...(s.topicText !== null ? [s.topicText] : []),
        ...(s.messageUnit !== null ? [s.messageUnit.text] : []),
        ...s.bodyUnits.map((u) => u.text),
      ]),
      ...document.nextStepUnits.map((u) => u.text),
    ];
    for (const text of materialTexts) {
      expect(markdown).toContain(text);
    }
  });
});
