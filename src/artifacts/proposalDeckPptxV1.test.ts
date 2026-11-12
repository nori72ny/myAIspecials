import { describe, expect, it } from 'vitest';
import { renderProposalDeckPptx } from './proposalDeckPptxV1.js';
import type { ProposalDeck } from './proposalDeckV1.js';

/** zipStore（無圧縮）のローカルヘッダを走査してエントリを取り出す。 */
function unzipStore(bytes: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const size = bytes.readUInt32LE(offset + 18);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    entries.set(name, bytes.subarray(dataStart, dataStart + size).toString('utf8'));
    offset = dataStart + size;
  }
  return entries;
}

function slideXmlList(bytes: Buffer): string[] {
  const entries = unzipStore(bytes);
  const slides: string[] = [];
  for (let index = 1; ; index++) {
    const xml = entries.get(`ppt/slides/slide${index}.xml`);
    if (!xml) break;
    slides.push(xml);
  }
  return slides;
}

const sampleDeck: ProposalDeck = {
  title: '業務効率化ツールの導入提案',
  subtitle: '営業部の事務作業を月40時間削減する計画',
  presenter: '営業企画部',
  date: '2026-11-12',
  summary: {
    headline: '導入で営業の事務作業を月40時間削減できます',
    points: [
      '入力作業の自動化で月40時間を削減',
      '情報の一元化で属人化を解消',
      '初期費用は3か月で回収可能',
    ],
  },
  sections: [
    {
      role: 'challenge',
      message: '営業リソースが非生産的な業務に圧迫されています',
      bullets: [
        { lead: '事務作業の増大', detail: '入力と転記に週10時間を消費' },
        { lead: '情報の属人化', detail: '顧客情報が個人の表計算に分散' },
      ],
    },
    {
      role: 'plan',
      message: '3段階の導入で無理なく定着させます',
      bullets: [
        { lead: '準備', detail: '要件定義と対象業務の選定' },
        { lead: '試験導入', detail: '1チームで効果を測定' },
        { lead: '全社展開', detail: '研修と運用ルールを整備' },
      ],
      visual: { kind: 'steps', title: '導入ステップ' },
    },
    {
      role: 'value',
      message: '効果をカテゴリ別に比較できます',
      bullets: [
        { lead: '時間削減', detail: '月40時間' },
        { lead: '精度向上', detail: '転記ミスを削減' },
      ],
      visual: { kind: 'table', title: '効果一覧' },
    },
    {
      role: 'cost',
      message: '費用対効果は初年度からプラスになります',
      bullets: [{ lead: '初期費用', detail: '導入支援を含む' }],
      visual: { kind: 'bar', title: '月次効果の推移' },
    },
  ],
  closing: {
    ask: '試験導入の開始を承認してください',
    nextSteps: ['対象チームの選定', '試験導入の日程確定'],
  },
  assumptions: ['対象は営業部40名', '既存の表計算運用が前提'],
};

describe('renderProposalDeckPptx', () => {
  it('builds a pptx package with cover + summary + sections + closing slides', () => {
    const bytes = renderProposalDeckPptx(sampleDeck);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    const entries = unzipStore(bytes);
    expect(entries.has('ppt/presentation.xml')).toBe(true);
    expect(entries.get('docProps/app.xml')).toContain('<Slides>7</Slides>');
    expect(slideXmlList(bytes)).toHaveLength(7);
  });

  it('renders deterministically (same deck, same bytes)', () => {
    expect(renderProposalDeckPptx(sampleDeck).equals(renderProposalDeckPptx(sampleDeck))).toBe(true);
  });

  it('renders the cover with the 40pt title token size, ink and accent colors', () => {
    const cover = slideXmlList(renderProposalDeckPptx(sampleDeck))[0];
    expect(cover).toContain('業務効率化ツールの導入提案');
    expect(cover).toContain('sz="4000"');
    expect(cover).toContain('val="17324D"');
    expect(cover).toContain('val="0F6CBD"');
    expect(cover).toContain('営業部の事務作業を月40時間削減する計画');
    expect(cover).toContain('sz="1800"');
    expect(cover).toContain('営業企画部');
    expect(cover).toContain('2026-11-12');
    expect(cover).toContain('sz="1200"');
  });

  it('renders the summary slide with a 28pt headline and the three points', () => {
    const summary = slideXmlList(renderProposalDeckPptx(sampleDeck))[1];
    expect(summary).toContain('導入で営業の事務作業を月40時間削減できます');
    expect(summary).toContain('sz="2800"');
    for (const point of sampleDeck.summary.points) expect(summary).toContain(point);
  });

  it('renders a plain section as headline plus lead/detail bullets at body size', () => {
    const body = slideXmlList(renderProposalDeckPptx(sampleDeck))[2];
    expect(body).toContain('営業リソースが非生産的な業務に圧迫されています');
    expect(body).toContain('sz="2800"');
    expect(body).toContain('事務作業の増大');
    expect(body).toContain('入力と転記に週10時間を消費');
    expect(body).toContain('sz="1600"');
    expect(body).not.toContain('prst="chevron"');
    expect(body).not.toContain('name="TableFrame"');
  });

  it('renders steps visuals as pentagon/chevron shapes filled with category colors', () => {
    const steps = slideXmlList(renderProposalDeckPptx(sampleDeck))[3];
    expect(steps).toContain('導入ステップ');
    expect(steps).toContain('prst="pentagon"');
    expect(steps).toContain('prst="chevron"');
    // カテゴリ色の定義順: teal → indigo → violet
    expect(steps).toContain('val="0F766E"');
    expect(steps).toContain('val="4338CA"');
    expect(steps).toContain('val="6D28D9"');
    expect(steps).toContain('準備');
    expect(steps).toContain('全社展開');
  });

  it('renders a table visual as a ruled grid carrying the bullets', () => {
    const table = slideXmlList(renderProposalDeckPptx(sampleDeck))[4];
    expect(table).toContain('効果一覧');
    expect(table).toContain('name="TableFrame"');
    expect(table).toContain('name="TableColLine"');
    expect(table).toContain('時間削減');
    expect(table).toContain('月40時間');
    expect(table).toContain('精度向上');
  });

  it('renders a bar visual as axes plus a zero baseline without inventing values', () => {
    const bar = slideXmlList(renderProposalDeckPptx(sampleDeck))[5];
    expect(bar).toContain('月次効果の推移');
    expect(bar).toContain('name="BarAxisY"');
    expect(bar).toContain('name="BarBaseline"');
    expect(bar).toContain('初期費用');
    expect(bar).toContain('導入支援を含む');
  });

  it('renders the closing slide with the ask, numbered steps and assumptions', () => {
    const closing = slideXmlList(renderProposalDeckPptx(sampleDeck))[6];
    expect(closing).toContain('試験導入の開始を承認してください');
    expect(closing).toContain('sz="2800"');
    expect(closing).toContain('1. ');
    expect(closing).toContain('対象チームの選定');
    expect(closing).toContain('2. ');
    expect(closing).toContain('試験導入の日程確定');
    expect(closing).toContain('前提条件');
    expect(closing).toContain('対象は営業部40名');
  });

  it('marks every text run with the Noto Sans JP typeface', () => {
    for (const slide of slideXmlList(renderProposalDeckPptx(sampleDeck))) {
      expect(slide).toContain('<a:latin typeface="Noto Sans JP"/>');
      expect(slide).toContain('<a:ea typeface="Noto Sans JP"/>');
    }
  });

  it('lets a visual colorToken override the chart colors', () => {
    const deck: ProposalDeck = {
      ...sampleDeck,
      sections: [{
        role: 'plan',
        message: '手順は3つです',
        bullets: [{ lead: '一', detail: '' }, { lead: '二', detail: '' }],
        visual: { kind: 'steps', colorToken: 'ink' },
      }],
    };
    const steps = slideXmlList(renderProposalDeckPptx(deck))[2];
    expect(steps).toContain('val="17324D"');
    expect(steps).not.toContain('val="0F766E"');
  });

  it('escapes XML special characters instead of breaking the markup', () => {
    const deck: ProposalDeck = { ...sampleDeck, title: 'A<B>&"C"\'D', sections: [] };
    const cover = slideXmlList(renderProposalDeckPptx(deck))[0];
    expect(cover).toContain('A&lt;B&gt;&amp;&quot;C&quot;&apos;D');
    expect(cover).not.toContain('<a:t>A<B>');
  });

  it('never throws on broken input and still emits the three fixed slides', () => {
    for (const broken of [undefined, null, {}, { sections: 'nope' }, { summary: null, closing: 42 }]) {
      const bytes = renderProposalDeckPptx(broken as never);
      expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
      expect(slideXmlList(bytes)).toHaveLength(3);
    }
  });
});
