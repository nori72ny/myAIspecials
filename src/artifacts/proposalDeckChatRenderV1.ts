/**
 * 提案資料「資料レコード再設計」のチャット表示レンダラ（D-PR-6）。
 *
 * 設計正本: ~/workspace/origin-fix/DECK_RECORDS_REDESIGN_2026-11-15.md
 * （§5 チャット表示と PPTX の二重描画、§6.2 描画、§2.4 材料の
 * 種別表示）
 *
 * D-PR-4 の組立文書（DeckAssembledDocument）から、チャット本文に
 * 出す Markdown を決定的に組み立てる。モデルの生の出力（モードBの
 * タグ付き起草、モードAの配置計画）はそのまま表示せず、掲載文字列
 * はすべて材料レコードの逐語である（保証 G1 はチャット表示でも
 * 維持する）。D-PR-5 の申し送り（チャット表示レンダラは未着手）を
 * 本 PR で担当する。
 *
 * 表示の形（設計 §5）: 導入文 → タイトル（見出し）→ 材料種別の
 * 定型注記 → 要点（箇条書き）→ 各節（題目＋主張文＋本文）→ 次の
 * 一手 → 前提 → 確認事項。現行経路の表示（モデル回答の Markdown
 * そのまま）とは別に、新経路でのみ使う。
 *
 * 節の見出しは §6.2 の2段構えを Markdown で表す: 題目を小見出し
 * （###）として主張文の見出し（##）の上に置く。題目が無い節は
 * 主張文だけを見出しにする。題目だけがあって主張文が無い節
 * （不足時の部分表示でのみ現れる）は、題目を見出し（##）にする。
 *
 * 本文の単位は箇条書きとして逐語で並べる。表の単位は、単位
 * テキスト（Markdown 表の行そのもの）を逐語のまま独立した
 * ブロックとして置く（セル単位の書き換えはしない、設計 §7.2）。
 *
 * 材料種別の注記（設計 §2.4）: チャット表示には、材料の種別が
 * 分かる決定的な定型文を残す。モードA（ユーザー素材）は
 * 「本資料はご提示の素材をもとに作成しました。」、モードB
 * （モデル起草）は「本資料は汎用的な起草です。製品名・価格は
 * 未確定です。」（いずれも設計 §2.4 の例示文）。不足時の部分表示
 * では、資料が未完成であることが伝わるよう文面を切り替える。
 */

import type {
  DeckAssembledDocument,
  DeckAssembledSection,
} from './proposalDeckAssemblyV1.js';
import type { DeckMaterialUnit } from './proposalDeckRecordsV1.js';

/** 材料種別の定型注記（設計 §2.4 の例示文。完成した資料向け）。 */
export const DECK_RECORDS_CHAT_SOURCE_NOTE: Readonly<Record<'A' | 'B', string>> = {
  A: '本資料はご提示の素材をもとに作成しました。',
  B: '本資料は汎用的な起草です。製品名・価格は未確定です。',
};

/** 材料種別の定型注記（不足時の部分表示向け）。 */
export const DECK_RECORDS_CHAT_SOURCE_NOTE_PARTIAL: Readonly<Record<'A' | 'B', string>> = {
  A: 'ご提示の素材をもとに、作成できた範囲をお示しします。',
  B: 'テーマをもとに起草できた範囲をお示しします。製品名・価格は未確定です。',
};

/** 本文単位列を Markdown のブロック列にする（表は逐語ブロック、他は箇条書き）。 */
function renderDeckBodyBlocks(units: readonly DeckMaterialUnit[]): string[] {
  const blocks: string[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push(bullets.join('\n'));
      bullets = [];
    }
  };
  for (const unit of units) {
    if (unit.kind === 'table') {
      flushBullets();
      blocks.push(unit.text);
    } else {
      bullets.push(`- ${unit.text}`);
    }
  }
  flushBullets();
  return blocks;
}

function renderDeckSectionBlocks(section: DeckAssembledSection): string[] {
  const blocks: string[] = [];
  const message = section.messageUnit?.text ?? null;
  if (section.topicText !== null && message !== null) {
    // 2段見出し: 題目（小見出し）を主張文（見出し）の上に置く（§6.2）。
    blocks.push(`### ${section.topicText}`);
    blocks.push(`## ${message}`);
  } else if (message !== null) {
    blocks.push(`## ${message}`);
  } else if (section.topicText !== null) {
    blocks.push(`## ${section.topicText}`);
  }
  blocks.push(...renderDeckBodyBlocks(section.bodyUnits));
  return blocks;
}

/**
 * 組立文書をチャット表示用の Markdown へ決定的に変換する。
 * 完成した資料（全ゲート合格）にも、不足時の部分表示にも使う
 * （無い要素は黙って省く。省いたことは不足の提示側が伝える）。
 */
export function renderDeckRecordsChatMarkdown(
  document: DeckAssembledDocument,
  options?: { partial?: boolean },
): string {
  const partial = options?.partial === true;
  const blocks: string[] = [];

  if (document.introduction !== null && document.introduction !== '') {
    blocks.push(document.introduction);
  }
  if (document.titleText !== null && document.titleText !== '') {
    blocks.push(`# ${document.titleText}`);
  }
  blocks.push(
    partial
      ? DECK_RECORDS_CHAT_SOURCE_NOTE_PARTIAL[document.mode]
      : DECK_RECORDS_CHAT_SOURCE_NOTE[document.mode],
  );

  if (document.summaryUnits.length > 0) {
    blocks.push('## 要点');
    blocks.push(document.summaryUnits.map((unit) => `- ${unit.text}`).join('\n'));
  }

  for (const section of document.sections) {
    blocks.push(...renderDeckSectionBlocks(section));
  }

  if (document.nextStepUnits.length > 0) {
    blocks.push('## 次の一手');
    blocks.push(document.nextStepUnits.map((unit) => `- ${unit.text}`).join('\n'));
  }

  if (document.assumptions.length > 0) {
    blocks.push('## 前提');
    blocks.push(document.assumptions.map((text) => `- ${text}`).join('\n'));
  }

  if (document.questions.length > 0) {
    blocks.push('## 確認事項');
    blocks.push(document.questions.map((text) => `- ${text}`).join('\n'));
  }

  return blocks.join('\n\n');
}
