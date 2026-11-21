/**
 * チャットの調査フォールバック（部分回答）の出典セクションを、構造化
 * カードとして描くためのパーサ。
 *
 * 部分回答の本文は生成側（src/research/groundedResearchV11.ts の
 * buildGroundedResearchPartialAnswer → buildSourceCardsSection）が
 * Markdown 文字列として組み立てるため、チャットの表示層には本文しか
 * 届かない。その Markdown のまま描くと「S1・ドメイン」の見出し＋
 * リンク＋引用のテキスト羅列になり、通常経路（詳しく調べるモードの
 * ResearchSourcesSection）が使う出典カードと見た目が揃わない
 * （2026-11-21 デザイン一次評価の指摘）。そこで、生成側が決まった
 * 書式で出す出典セクションだけを厳密に読み取り、カード描画に渡す。
 *
 * 書式が少しでも想定と違えば null を返し、呼び出し側は従来どおり
 * Markdown のまま描く（表示が壊れる方向には倒れない）。
 */

export type PartialAnswerSourceCard = {
  id: string;
  domain: string;
  title: string;
  url: string;
  /** 引用の要旨（区切り記号を除いた本文）。引用なしカードでは undefined。 */
  quote?: string;
};

export type PartialAnswerSourcesSection = {
  heading: string;
  retrievedLine?: string;
  cards: PartialAnswerSourceCard[];
};

export type PartialAnswerSplit = {
  before: string;
  section: PartialAnswerSourcesSection;
  after: string;
};

const SECTION_HEADINGS = ['## 確認できた範囲', '## What could be confirmed'] as const;
const RETRIEVED_LINE_PREFIXES = ['取得日：', 'Retrieved: '] as const;
const CARD_HEADING_PATTERN = /^### (S\d+)(?: · (.+))?$/;
const CARD_LINK_PATTERN = /^\[(.*)\]\(([^)\s]+)\)$/;
const JA_QUOTE_PATTERN = /^『(.*)』$/;
const EN_QUOTE_PATTERN = /^"(.*)"$/;

/**
 * 部分回答の本文を「出典セクションより前」「出典セクション」
 * 「出典セクションより後」に分ける。出典セクションが無い、または
 * 書式が想定と違う場合は null。
 */
export function splitPartialAnswerSources(content: string): PartialAnswerSplit | null {
  const lines = content.split('\n');
  const headingIndex = lines.findIndex((line) => (SECTION_HEADINGS as readonly string[]).includes(line));
  if (headingIndex < 0) return null;

  // セクションは次の H2 見出し（あれば）まで。以後の行は after として
  // そのまま Markdown 描画に戻す。
  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) { sectionEnd = index; break; }
  }
  // 空行を除いた行の並びとして読む（生成側は各要素を空行で区切る）。
  const sectionLines = lines.slice(headingIndex + 1, sectionEnd).filter((line) => line.trim() !== '');

  let cursor = 0;
  let retrievedLine: string | undefined;
  if (cursor < sectionLines.length && RETRIEVED_LINE_PREFIXES.some((prefix) => sectionLines[cursor].startsWith(prefix))) {
    retrievedLine = sectionLines[cursor];
    cursor += 1;
  }

  const cards: PartialAnswerSourceCard[] = [];
  while (cursor < sectionLines.length) {
    const headingMatch = sectionLines[cursor].match(CARD_HEADING_PATTERN);
    if (!headingMatch) return null;
    const linkMatch = sectionLines[cursor + 1]?.match(CARD_LINK_PATTERN);
    if (!linkMatch) return null;
    const card: PartialAnswerSourceCard = {
      id: headingMatch[1],
      domain: headingMatch[2] ?? '',
      title: linkMatch[1],
      url: linkMatch[2],
    };
    cursor += 2;
    const quoteMatch = sectionLines[cursor]?.match(JA_QUOTE_PATTERN) ?? sectionLines[cursor]?.match(EN_QUOTE_PATTERN);
    if (quoteMatch) {
      card.quote = quoteMatch[1];
      cursor += 1;
    }
    cards.push(card);
  }
  if (cards.length === 0) return null;

  return {
    before: lines.slice(0, headingIndex).join('\n').trim(),
    section: {
      heading: lines[headingIndex].slice(3),
      ...(retrievedLine ? { retrievedLine } : {}),
      cards,
    },
    after: lines.slice(sectionEnd).join('\n').trim(),
  };
}
