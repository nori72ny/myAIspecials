/**
 * ProposalDeck Failure Shape V1 — 変換失敗時の「形」の決定的な要約（観測専用）。
 *
 * 設計の経緯: ~/workspace/origin-fix/external-consult-proposal-deck/ADJUDICATION_2026-11-13.md 採用1
 * （失敗段階の分離記録）と、失敗した回答を原文保存なしで恒常フィクスチャ化する方針。
 * - 失敗した回答の原文・見出し文は保存しない。代わりに、見出しの種別ごとの件数、
 *   箇条書き行数、表の行数、【…】単独行の件数、総文字数という「件数だけ」の形を
 *   完了ログへ残す（このモジュールの返す値はすべて数値で、文字列は一切含まない）。
 * - 純関数・決定的。変換そのもの（proposalDeckSkeletonV1）には一切関与しない。
 * - ここの見出し判定は観測用の粗い近似であり、パーサー本体の判定と一致することは
 *   保証しない。0列目の番号付き行は本番の失敗形状では節見出しだったため見出しとして
 *   数え、インデントされた番号付き行は箇条書きとして数える（曖昧さは形の件数側で吸収する）。
 * - fix-5 の観測追加: 見出しの「受理拒否」の件数と理由（長さ超過／コロン／連番
 *   不一致）も数える。受理判定はパーサー本体（FIX5-1 後）に倣い、注記を除いた
 *   見出し本体に対して行い、番号付き見出しは連番の進行も近似する。第5回失敗の
 *   切り分けで最も不足したのが受理段の診断だったため（壁5-A 型かの即断用）。
 *   ここでも返すのは件数だけであり、見出し文そのものは含めない。
 */

export interface ProposalDeckAnswerShape {
  /** 回答全体の文字数（コードポイント単位）。 */
  totalChars: number;
  /** Markdown 見出し行（# 〜 ######）の件数。 */
  markdownHeadingCount: number;
  /** 0列目の番号付き見出し行（「1. …」等）の件数。 */
  numberedHeadingCount: number;
  /** 行全体が【…】だけの単独行の件数。 */
  bracketStandaloneLineCount: number;
  /** 行全体が **…** だけの太字ラベル行の件数。 */
  boldLabelLineCount: number;
  /** 箇条書き行の件数。 */
  bulletLineCount: number;
  /** Markdown 表の行（| で始まる行）の件数。 */
  tableRowCount: number;
  /** 受理拒否と判定された見出し行の総数（番号付き＋Markdown H2、観測用の近似）。 */
  rejectedHeadingCount: number;
  /** 拒否理由の件数: 見出し本体（注記除去後）が40字を超える。 */
  rejectedHeadingTooLongCount: number;
  /** 拒否理由の件数: 見出し本体にコロン（：/:）を含む。 */
  rejectedHeadingColonCount: number;
  /** 拒否理由の件数: 番号が連番の期待値と一致しない（番号付き見出しのみ）。 */
  rejectedHeadingSequenceMismatchCount: number;
}

const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+\S/;
const NUMBERED_HEADING = /^[0-9０-９]{1,2}[.．、]\s*\S/;
const BRACKET_STANDALONE = /^【[^】]+】$/;
const BOLD_LABEL = /^\*\*[^*]+\*\*[:：]?$/;
const BULLET_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const BULLET_DOT = /^\s*・\S/;
const TABLE_ROW = /^\s*\|/;
const SHAPE_NUMBERED_CAPTURE = /^([0-9０-９]{1,2})\s*[.．、)）]\s*(.+)$/;
const SHAPE_MARKDOWN_H2 = /^##\s+(.+)$/;

/** 見出し本体（強調記法と注記を除いた部分）。パーサー本体の剥がし方に倣う。 */
function shapeHeadingCore(headingText: string): string {
  return headingText
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
}

function shapeToHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

export function summarizeProposalDeckAnswerShape(answerText: string): ProposalDeckAnswerShape {
  const text = typeof answerText === 'string' ? answerText : '';
  const shape: ProposalDeckAnswerShape = {
    totalChars: [...text].length,
    markdownHeadingCount: 0,
    numberedHeadingCount: 0,
    bracketStandaloneLineCount: 0,
    boldLabelLineCount: 0,
    bulletLineCount: 0,
    tableRowCount: 0,
    rejectedHeadingCount: 0,
    rejectedHeadingTooLongCount: 0,
    rejectedHeadingColonCount: 0,
    rejectedHeadingSequenceMismatchCount: 0,
  };
  // 番号付き見出しの連番の進行（パーサー本体の受理近似）。
  let expectedNumber = 1;
  const recordRejection = (core: string, sequenceMismatch: boolean) => {
    shape.rejectedHeadingCount += 1;
    if ([...core].length > 40) shape.rejectedHeadingTooLongCount += 1;
    if (/[：:]/.test(core)) shape.rejectedHeadingColonCount += 1;
    if (sequenceMismatch) shape.rejectedHeadingSequenceMismatchCount += 1;
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (TABLE_ROW.test(line)) {
      shape.tableRowCount += 1;
      continue;
    }
    if (MARKDOWN_HEADING.test(line)) {
      shape.markdownHeadingCount += 1;
      // H2 のみが節見出し候補（H1 はタイトル候補、H3 以下は読み飛ばし）。
      const h2 = line.match(SHAPE_MARKDOWN_H2);
      if (h2) {
        const headingText = h2[1]
          .replace(/\s+#+\s*$/, '')
          .trim()
          .replace(/^\d{1,2}\s*[.．)）]\s*/, '')
          .trim();
        const core = shapeHeadingCore(headingText);
        if (core === '' || [...core].length > 40 || /[：:]/.test(core)) {
          recordRejection(core, false);
        }
      }
      continue;
    }
    if (BRACKET_STANDALONE.test(trimmed)) {
      shape.bracketStandaloneLineCount += 1;
      continue;
    }
    if (NUMBERED_HEADING.test(line)) {
      shape.numberedHeadingCount += 1;
      const capture = trimmed.match(SHAPE_NUMBERED_CAPTURE);
      if (capture) {
        const number = Number.parseInt(shapeToHalfWidthDigits(capture[1]), 10);
        const core = shapeHeadingCore(capture[2].trim());
        const accepted =
          number === expectedNumber &&
          core !== '' &&
          [...core].length <= 40 &&
          !/[：:]/.test(core);
        if (accepted) expectedNumber += 1;
        else recordRejection(core, number !== expectedNumber);
      }
      continue;
    }
    if (BOLD_LABEL.test(trimmed)) {
      shape.boldLabelLineCount += 1;
      continue;
    }
    if (BULLET_MARKER.test(line) || BULLET_DOT.test(line)) {
      shape.bulletLineCount += 1;
    }
  }
  return shape;
}

/**
 * パース段階の失敗コード。
 * - 見出しらしい行が1つも無い（モデルが構造を持たず散文だけを返した）場合は
 *   PROPOSAL_DECK_PARSE_NO_HEADINGS に分離する。
 * - 構造はあるが骨格として読めなかった場合は従来コードを維持する
 *   （詳細な切り分けは ProposalDeckAnswerShape の件数が担う）。
 */
export type ProposalDeckParseFailureCode =
  | 'PROPOSAL_DECK_PARSE_NO_HEADINGS'
  | 'PROPOSAL_DECK_SKELETON_NOT_MATCHED';

export function classifyProposalDeckParseFailureCode(
  answerText: string,
): ProposalDeckParseFailureCode {
  const shape = summarizeProposalDeckAnswerShape(answerText);
  const headingCount =
    shape.markdownHeadingCount +
    shape.numberedHeadingCount +
    shape.bracketStandaloneLineCount +
    shape.boldLabelLineCount;
  return headingCount === 0
    ? 'PROPOSAL_DECK_PARSE_NO_HEADINGS'
    : 'PROPOSAL_DECK_SKELETON_NOT_MATCHED';
}
