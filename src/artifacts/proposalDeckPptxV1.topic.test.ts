/**
 * D-PR-6: PPTX レンダラーの2段見出し（topic＋message）描画。
 * topic がある節では topic が小さく slate で主張文の上に描かれ、
 * topic が無い節（旧経路の deck）の描画は従来と同一であることを固定する。
 */
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

function deckWithSections(
  sections: ProposalDeck['sections'],
): ProposalDeck {
  return {
    title: '経理の手間を減らす仕組みのご提案',
    subtitle: '',
    date: '',
    summary: {
      headline: '',
      points: ['要点の1つ目です', '要点の2つ目です', '要点の3つ目です'],
    },
    sections,
    closing: { ask: '', nextSteps: ['まずは無料相談をお申し込みください'] },
    assumptions: [],
  };
}

describe('renderProposalDeckPptx topic (D-PR-6, §6.2)', () => {
  it('renders the topic above the message as a small slate label', () => {
    const deck = deckWithSections([
      {
        role: 'challenge',
        topic: '現状の課題',
        message: '経理担当者が少なく、月末に業務が集中しています。',
        bullets: [{ lead: '紙の領収書の管理', detail: '時間がかかっています' }],
      },
      {
        role: 'solution',
        topic: '解決策',
        message: '仕訳の自動化で月末作業の手間を減らせます。',
        bullets: [{ lead: '領収書の取り込み', detail: '撮影するだけです' }],
      },
      {
        role: 'value',
        message: '月40時間の作業を削減できます。',
        bullets: [{ lead: '残業代', detail: '年間120万円削減できます' }],
      },
    ]);
    const slides = slideXmlList(renderProposalDeckPptx(deck));
    // 表紙・要約・節3・締め = 6枚。節スライドは 3〜5 枚目。
    expect(slides).toHaveLength(6);
    const first = slides[2];
    expect(first).toContain('name="Topic"');
    expect(first).toContain('現状の課題');
    expect(first).toContain('経理担当者が少なく、月末に業務が集中しています。');
    // topic は主張文より前（上）に置かれる。
    expect(first.indexOf('現状の課題')).toBeLessThan(
      first.indexOf('経理担当者が少なく、月末に業務が集中しています。'),
    );
    // topic は slate（334155）・本文最小サイズ（14pt = sz 1400）で描かれる。
    expect(first).toContain('sz="1400"');
    expect(first).toContain('334155');
    const second = slides[3];
    expect(second).toContain('name="Topic"');
    expect(second).toContain('解決策');
    // topic の無い節は従来どおり Topic 図形を持たない。
    const third = slides[4];
    expect(third).not.toContain('name="Topic"');
    expect(third).toContain('月40時間の作業を削減できます。');
  });

  it('keeps decks without any topic byte-identical in structure (no Topic shapes)', () => {
    const deck = deckWithSections([
      {
        role: 'challenge',
        message: '経理担当者が少なく、月末に業務が集中しています。',
        bullets: [{ lead: '紙の領収書の管理', detail: '時間がかかっています' }],
      },
      {
        role: 'solution',
        message: '仕訳の自動化で月末作業の手間を減らせます。',
        bullets: [{ lead: '領収書の取り込み', detail: '撮影するだけです' }],
      },
      {
        role: 'value',
        message: '月40時間の作業を削減できます。',
        bullets: [{ lead: '残業代', detail: '年間120万円削減できます' }],
      },
    ]);
    const slides = slideXmlList(renderProposalDeckPptx(deck));
    expect(slides).toHaveLength(6);
    for (const slide of slides) {
      expect(slide).not.toContain('name="Topic"');
    }
    // 見出し図形の ID は従来どおり（Background=2, Headline=3, Rule=4）。
    expect(slides[2]).toContain('<p:cNvPr id="3" name="Headline"/>');
  });

  it('renders the topic on visual slides too', () => {
    const deck = deckWithSections([
      {
        role: 'challenge',
        topic: '現状の課題',
        message: '経理担当者が少なく、月末に業務が集中しています。',
        bullets: [{ lead: '紙の領収書の管理', detail: '時間がかかっています' }],
      },
      {
        role: 'solution',
        topic: '進め方',
        message: '段階導入で無理なく定着させます。',
        bullets: [{ lead: '準備', detail: '対象業務の選定' }],
        visual: { kind: 'steps', title: '導入ステップ' },
      },
      {
        role: 'value',
        message: '月40時間の作業を削減できます。',
        bullets: [{ lead: '残業代', detail: '年間120万円削減できます' }],
      },
    ]);
    const slides = slideXmlList(renderProposalDeckPptx(deck));
    expect(slides[3]).toContain('name="Topic"');
    expect(slides[3]).toContain('進め方');
    expect(slides[3]).toContain('段階導入で無理なく定着させます。');
  });
});
