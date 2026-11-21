import { describe, expect, it } from 'vitest';
import type { OriginResearchSource } from '../../../legacy/originResearchSource';
import { buildGroundedResearchPartialAnswer } from '../../../research/groundedResearchV11';
import { splitPartialAnswerSources } from '../partialAnswerSourceCards';

const JA_PARTIAL = [
  '公開情報を2件取得しましたが、要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします。内容の詳細は各出典でご確認ください。',
  '',
  '## 確認できた範囲',
  '',
  '取得日：2026年11月21日',
  '',
  '### S1 · enecho.meti.go.jp',
  '',
  '[日本のガソリン価格について](https://www.enecho.meti.go.jp/example)',
  '',
  '『全国平均小売価格は1リットルあたり170円程度でした。』',
  '',
  '### S2 · example.org',
  '',
  '[Second source](https://example.org/b)',
].join('\n');

describe('splitPartialAnswerSources', () => {
  it('splits a Japanese partial answer into lead, source cards and no tail', () => {
    const split = splitPartialAnswerSources(JA_PARTIAL);
    expect(split).not.toBeNull();
    expect(split!.before).toContain('要約した回答を作成できなかったため');
    expect(split!.after).toBe('');
    expect(split!.section.heading).toBe('確認できた範囲');
    expect(split!.section.retrievedLine).toBe('取得日：2026年11月21日');
    expect(split!.section.cards).toEqual([
      {
        id: 'S1',
        domain: 'enecho.meti.go.jp',
        title: '日本のガソリン価格について',
        url: 'https://www.enecho.meti.go.jp/example',
        quote: '全国平均小売価格は1リットルあたり170円程度でした。',
      },
      {
        id: 'S2',
        domain: 'example.org',
        title: 'Second source',
        url: 'https://example.org/b',
      },
    ]);
  });

  it('splits an English partial answer', () => {
    const content = [
      'I retrieved 1 public source(s), but a summarized answer could not be produced, so the confirmed scope and the source list follow. Please check the sources for the details.',
      '',
      '## What could be confirmed',
      '',
      'Retrieved: 2026-11-21',
      '',
      '### S1 · example.com',
      '',
      '[A title](https://example.com/a)',
      '',
      '"A short quote."',
    ].join('\n');
    const split = splitPartialAnswerSources(content);
    expect(split).not.toBeNull();
    expect(split!.section.heading).toBe('What could be confirmed');
    expect(split!.section.cards).toEqual([
      { id: 'S1', domain: 'example.com', title: 'A title', url: 'https://example.com/a', quote: 'A short quote.' },
    ]);
  });

  it('keeps markdown after the sources section as the tail', () => {
    const split = splitPartialAnswerSources(`${JA_PARTIAL}\n\n## 補足\n\n追加の説明です。`);
    expect(split).not.toBeNull();
    expect(split!.after).toBe('## 補足\n\n追加の説明です。');
    expect(split!.section.cards).toHaveLength(2);
  });

  it('returns null when there is no sources section', () => {
    expect(splitPartialAnswerSources('通常の回答です。\n\n## 出典\n\n- S1: example.com')).toBeNull();
    expect(splitPartialAnswerSources('公開情報を1件取得しましたが、要約した回答を作成できなかったため。')).toBeNull();
  });

  it('returns null when a card block does not match the generated shape', () => {
    const broken = [
      '## 確認できた範囲',
      '',
      '### S1 · example.com',
      '',
      'リンクの無いタイトル行',
    ].join('\n');
    expect(splitPartialAnswerSources(broken)).toBeNull();
  });

  it('parses the exact output of buildGroundedResearchPartialAnswer (generator contract)', () => {
    const source = (overrides: Partial<OriginResearchSource>): OriginResearchSource => ({
      title: 'Source',
      url: 'https://example.com/source',
      excerpt: 'ガソリンの全国平均小売価格は1リットルあたり170円程度でした。',
      sourceType: 'web-search',
      domain: 'example.com',
      evidenceLevel: 'snippet',
      retrievedAt: '2026-11-21T00:00:00.000Z',
      freshness: 'unknown',
      ...overrides,
    });
    const body = buildGroundedResearchPartialAnswer([
      source({ title: 'First', url: 'https://a.example/1', domain: 'a.example' }),
      source({ title: 'Second', url: 'https://b.example/2', domain: 'b.example' }),
    ], 'ja', 'ガソリン価格');
    const split = splitPartialAnswerSources(body);
    expect(split).not.toBeNull();
    expect(split!.section.cards.map((card) => [card.id, card.domain, card.title, card.url])).toEqual([
      ['S1', 'a.example', 'First', 'https://a.example/1'],
      ['S2', 'b.example', 'Second', 'https://b.example/2'],
    ]);
  });
});
