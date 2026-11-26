/**
 * 4-A（回答表示の外部比較 2026-11-26 §4）：出典のみ着地の「答えの形」化。
 *
 * 調査の統合回答が作れなかった着地は、従来は「導入文＋引用の並び＋
 * 出典カード／出典リスト」の材料提示だけで、利用者は引用の山から
 * 自分で答えを掘る形になっていた。外部の標準形（不確かでも文章で
 * 答え、留保は注記として示す）と、デザイン統合の既定方針（失敗時は
 * 状態見出し＋説明＋行動）に合わせ、表示層で次の形に組み替える：
 *
 *   1. 状態の1行（要約した答えが作れなかったこと）
 *   2. 「分かったこと（出典の記述）」— 出典の引用そのもの
 *   3. 従来どおりの出典カード／出典リスト
 *
 * 組み替えは、生成側が決まった書式で出す2つの着地だけを対象にする：
 * - 部分回答（buildGroundedResearchPartialAnswer）：導入文＋
 *   「## 確認できた範囲」の出典カード。カード化は
 *   partialAnswerSourceCards が担い、ここでは導入文が部分回答の
 *   定型かどうかだけを判定する。
 * - 再構成の逐語引用着地（groundedResearchReconstruction の
 *   packet-sentences 形）：定型の導入文＋引用行＋「## 出典」リスト。
 *   値の投票が成立した着地（答えの行から始まる）は対象にしない。
 *
 * 書式が想定と少しでも違えば対象外とし、従来どおり表示する
 * （表示が壊れる方向には倒れない）。新しい事実は作らない：状態行は
 * 着地の理由そのもので、引用は出典の記述のまま転記する。
 */

export const SOURCES_ONLY_STATUS_LINE = {
  ja: '要約した答えは作れませんでした。出典の記述で分かったことをお伝えします。',
  en: 'A summarized answer could not be produced. Here is what the retrieved sources themselves state.',
} as const;

export const SOURCES_ONLY_FOUND_HEADING = {
  ja: '分かったこと（出典の記述）',
  en: 'What the sources state',
} as const;

const PARTIAL_LEAD_MARKERS = [
  '要約した回答を作成できなかったため',
  'a summarized answer could not be produced',
] as const;

const RECONSTRUCTION_LEADS = [
  '取得した出典の記述から、ご質問に関係する内容をそのままお伝えします。',
  'Here is what the retrieved sources themselves state on your question:',
] as const;

const SOURCES_HEADINGS = ['## 出典', '## Sources'] as const;

/** 部分回答の導入文（定型）かどうか。 */
export function isSourcesOnlyPartialLead(before: string): boolean {
  return PARTIAL_LEAD_MARKERS.some((marker) => before.includes(marker));
}

export type ReconstructionLandingSplit = {
  /** 引用行のブロック（Markdown のまま描く）。 */
  quotesMarkdown: string;
  /** 「## 出典」以降（Markdown のまま描く）。 */
  sourcesMarkdown: string;
};

/**
 * 再構成の逐語引用着地を、導入文・引用ブロック・出典リストに分ける。
 * 対象の形でなければ null。
 */
export function splitReconstructionLanding(content: string): ReconstructionLandingSplit | null {
  const blocks = content.split(/\n{2,}/);
  if (blocks.length < 3) return null;
  const lead = blocks[0].trim();
  if (!(RECONSTRUCTION_LEADS as readonly string[]).includes(lead)) return null;
  const sourcesStart = blocks.findIndex((block, index) => index > 0
    && SOURCES_HEADINGS.some((heading) => block.startsWith(`${heading}\n`) || block.trim() === heading));
  if (sourcesStart < 2) return null;
  const quotesMarkdown = blocks.slice(1, sourcesStart).join('\n\n').trim();
  if (!quotesMarkdown) return null;
  // 引用ブロックは引用行（「…」または "…" で始まり [S#] リンクを含む）
  // だけで構成されることを確認する。違う形なら組み替えない。
  const quoteLines = quotesMarkdown.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const looksLikeQuote = (line: string) => (line.startsWith('「') || line.startsWith('"')) && /\]\(https?:\/\/[^)\s]+\)/.test(line);
  if (quoteLines.length === 0 || !quoteLines.every(looksLikeQuote)) return null;
  return {
    quotesMarkdown,
    sourcesMarkdown: blocks.slice(sourcesStart).join('\n\n').trim(),
  };
}

/**
 * 再構成着地を「答えの形」の Markdown に組み替える。対象外は null。
 * 状態行＋「分かったこと」見出し＋引用＋出典リスト、の順に並べる。
 */
export function reshapeReconstructionLanding(content: string, language: 'ja' | 'en'): string | null {
  const split = splitReconstructionLanding(content);
  if (!split) return null;
  const status = language === 'en' ? SOURCES_ONLY_STATUS_LINE.en : SOURCES_ONLY_STATUS_LINE.ja;
  const heading = language === 'en' ? SOURCES_ONLY_FOUND_HEADING.en : SOURCES_ONLY_FOUND_HEADING.ja;
  return [status, `## ${heading}`, split.quotesMarkdown, split.sourcesMarkdown].join('\n\n');
}
