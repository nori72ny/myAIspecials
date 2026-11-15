/**
 * 提案資料「資料レコード再設計」の描画アダプタ（D-PR-5）。
 *
 * 設計正本: ~/workspace/origin-fix/DECK_RECORDS_REDESIGN_2026-11-15.md
 * （§5 チャット表示と PPTX の二重描画、§6.2 描画、§7.3 箇条書き
 * 条件、§7.5 PPTX としての表示、§13-6 題目の出所、§13-12 表の
 * 描画への写像）
 *
 * 本モジュールは未配線の部品であり、現行の資料経路（チャット
 * ルーター、現行パーサー、現行自己チェック、現行レンダラー）には
 * 接続しない。D-PR-4 の組立文書（DeckAssembledDocument）を、現行の
 * 資料モデル（ProposalDeck）へ決定的に変換する。配線は D-PR-6 の
 * 担当。
 *
 * 変換の原則:
 * - 掲載文字列は材料単位の逐語のまま移す（保証 G1）。変換側で文章・
 *   数値・固有名詞を創作・改変しない。組立文書に無い要素（副題・
 *   日付・要約見出し・締めの依頼文）は、作らずに空文字とする
 *   （対応する材料が無いことの明示であり、D-PR-6 の配線時に扱いを
 *   決める）。導入文と確認事項は ProposalDeck に対応する欄が無い
 *   ため、資料には載せない（導入文はチャット表示専用、確認事項は
 *   参考情報という D-PR-4 の位置づけどおり）。
 * - 見出しの2要素はそのまま移す: 題目（topic）は節の題目として、
 *   主張文（message）は節の見出しとして ProposalDeck に載る
 *   （§6.1 の2フィールド化。題目は主張文判定の対象外のまま）。
 * - 構造的に ProposalDeck を満たせない組立文書（タイトルなし、
 *   要点が3点でない、主張文のない節、次の一手なし）は、無理に
 *   埋めず deck を null にして理由コードを返す（fail-closed）。
 *
 * lead/detail 分割（本 PR で固定する規則）:
 * 本文の逐語単位は、箇条書き（lead/detail）へ「分割位置だけ」を
 * 決めて分ける。分割はテキストの分割（partition）であり、
 * lead + detail は元の単位テキストと正確に一致する（文字の追加・
 * 削除・置換・強調記法の除去は一切しない）。規則は次の優先順で、
 * 最初に成立したものだけを適用する:
 * - S1 区切りコロン: 最初に現れる「：」または「:」のうち、両隣が
 *   数字でないもの（時刻・比率の「10:30」「3：5」は区切りとみな
 *   さない）の直後で分ける。区切り文字は lead の末尾に残す。
 *   ただし区切りの前に1字以上、後ろに1字以上ある場合に限る。
 * - S2 文の区切り: S1 が無い場合、最初の「。」（後続の閉じ括弧・
 *   引用符は lead 側に含める）の直後で分ける。ただし「。」の後ろ
 *   に続きのテキストがある場合に限る（文末の「。」では分けない）。
 * - S3 分割なし: S1・S2 がいずれも無ければ、単位全体を lead とし
 *   detail は空にする（現行フォールバックの区切りなし箇条書きと
 *   同じ扱い）。
 * 60字ルール（§7.3、現行自己チェックの BULLET_TOO_LONG =
 * lead + detail で60字まで）は、D-PR-4 で保留されたとおり本 PR で
 * 適用する。ただし分割はテキストを保全するため、60字を超える
 * 単位は分割しても60字には収まらない。その場合は切り捨てず、
 * 変換結果の overlongBullets に位置と字数を記録し、現行自己
 * チェック側で BULLET_TOO_LONG として表面化させる（§7.5 の
 * 「原文を削って収めることはしない」方針。規則の衝突は緩和せず
 * 記録する）。
 *
 * 表の変換（§13-12 の裁定 (a): visual の table として描画する）:
 * 表の単位は、行・列へ決定的に変換して節の箇条書きにし、その節に
 * visual（kind = 'table'）を設定する（現行レンダラーは table の
 * visual を持つ節の箇条書きを表として描く）。変換規則:
 * - T1: 単位テキストを行に分け、各行の前後の空白を除く（空行は
 *   除く）。行頭・行末の「|」を1つずつ外し、「|」でセルに分ける。
 *   セルは前後の空白を除いた逐語であり、強調記法の除去はしない
 *   （現行フォールバックの tableLinesToBullets との意図的な差異:
 *   新経路はセル単位の書き換えをしない、§7.2）。
 * - T2: 全セルが空の行は除く。区切り行（全セルが「---」形）は
 *   構造として除く。
 * - T3: 区切り行がある表では、先頭行は見出し行（列名）であり
 *   データではないため箇条書きにはしない（現行フォールバックと
 *   同じ扱い。変換結果の header に逐語のまま返し、透明性を保つ）。
 *   区切り行が無い表では全行をデータ行とする。
 * - T4: データ行は lead = 第1セル、detail = 残りのセルを「：」で
 *   連結したもの（セルが1つだけの行は detail 空）とする。第1セル
 *   が空の行は箇条書きにせず、件数だけを skippedEmptyLeadRows に
 *   記録する（現行フォールバックと同じ扱い）。
 * - T5: 表のデータ行が1行以上変換できた節にだけ visual を設定
 *   する。本文単位と表が混在する節では、出現順のまま箇条書きが
 *   並び、表の行も同じ表描画に含まれる（現行レンダラーの table
 *   描画は節の箇条書き全体を表にするため）。
 * 表のデータ行数が多い節は、変換後の箇条書きが現行条件（1節
 * 4件まで）を超えることがある。その場合も行を切り捨てず、現行
 * 自己チェックの TOO_MANY_BULLETS として表面化させる（60字
 * ルールと同じく、衝突は記録し緩和しない）。
 *
 * 保証範囲: 本変換の合格（ok）は「ProposalDeck の構造を満たし、
 * 掲載文字列がすべて材料の逐語（箇条書きは単位の分割、表は
 * セルの逐語）である」ことだけを意味する。資料の品質・視覚的な
 * 完成度は保証しない（設計 §7.6）。節の topic の2段見出しとして
 * の描画は D-PR-6 で proposalDeckPptxV1 側に対応が入った（本変換
 * は topic をモデルに保持するところまでを引き続き担う）。
 */

import {
  PROPOSAL_DESIGN_TOKENS,
  type ProposalDeck,
  type ProposalDeckBullet,
  type ProposalDeckSection,
} from './proposalDeckV1.js';
import type { DeckAssembledDocument } from './proposalDeckAssemblyV1.js';
import type { DeckMaterialUnit } from './proposalDeckRecordsV1.js';

// ---------------------------------------------------------------------------
// lead/detail 分割（本 PR で固定する規則 S1〜S3）
// ---------------------------------------------------------------------------

export interface DeckBulletSplit {
  lead: string;
  detail: string;
}

const DECK_SPLIT_DIGIT_PATTERN = /[0-9０-９]/;

/** 「。」の後ろに吸収する閉じ括弧・引用符（D-PR-4 の完結文パターンと同じ集合）。 */
const DECK_SENTENCE_CLOSING_CHARS: ReadonlySet<string> = new Set([
  '」',
  '』',
  '）',
  ')',
  '】',
  '〕',
  '"',
  '”',
]);

/**
 * 逐語単位を lead（先頭の要点部分）と detail（補足）へ決定的に
 * 分割する。lead + detail は入力テキストと正確に一致する（分割
 * 位置の決定だけを行い、テキストは改変しない）。空文字列は
 * lead・detail ともに空を返す。
 */
export function splitDeckBulletText(text: string): DeckBulletSplit {
  if (text === '') return { lead: '', detail: '' };

  // S1: 区切りコロン（数字に挟まれたものは時刻・比率として除く）。
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '：' && char !== ':') continue;
    if (index === 0 || index === text.length - 1) continue;
    if (
      DECK_SPLIT_DIGIT_PATTERN.test(text[index - 1]) &&
      DECK_SPLIT_DIGIT_PATTERN.test(text[index + 1])
    ) {
      continue;
    }
    return { lead: text.slice(0, index + 1), detail: text.slice(index + 1) };
  }

  // S2: 最初の「。」の直後（閉じ括弧・引用符は lead 側）。後ろに
  // 続きがある場合のみ。
  const sentenceEnd = text.indexOf('。');
  if (sentenceEnd !== -1) {
    let splitAt = sentenceEnd + 1;
    while (splitAt < text.length && DECK_SENTENCE_CLOSING_CHARS.has(text[splitAt])) {
      splitAt += 1;
    }
    if (splitAt < text.length) {
      return { lead: text.slice(0, splitAt), detail: text.slice(splitAt) };
    }
  }

  // S3: 分割なし（単位全体が lead）。
  return { lead: text, detail: '' };
}

// ---------------------------------------------------------------------------
// 表の変換（本 PR で固定する規則 T1〜T5）
// ---------------------------------------------------------------------------

export interface DeckTableRows {
  /** 見出し行（列名）のセル列。区切り行が無い表では null。 */
  header: readonly string[] | null;
  /** データ行のセル列（出現順）。 */
  rows: readonly (readonly string[])[];
}

const DECK_TABLE_SEPARATOR_CELL_PATTERN = /^:?-+:?$/;

function parseDeckTableLine(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((cell) => cell.trim());
}

function isDeckTableSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => DECK_TABLE_SEPARATOR_CELL_PATTERN.test(cell));
}

/**
 * 表の単位テキストを行・列へ決定的に変換する（規則 T1〜T3）。
 * セルは逐語（前後の空白を除くのみで、強調記法は除去しない）。
 */
export function parseDeckTableRows(text: string): DeckTableRows {
  const allRows = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(parseDeckTableLine)
    .filter((cells) => cells.some((cell) => cell !== ''));
  const hasSeparator = allRows.some(isDeckTableSeparatorRow);
  let header: readonly string[] | null = null;
  const rows: (readonly string[])[] = [];
  allRows.forEach((cells, index) => {
    if (isDeckTableSeparatorRow(cells)) return;
    if (hasSeparator && index === 0) {
      header = cells;
      return;
    }
    rows.push(cells);
  });
  return { header, rows };
}

export interface DeckTableConversion {
  /** 見出し行（列名）のセル列。描画には使わない（透明性のために返す）。 */
  header: readonly string[] | null;
  /** データ行から変換した箇条書き（出現順）。 */
  bullets: readonly ProposalDeckBullet[];
  /** 第1セルが空のため箇条書きにしなかったデータ行の件数。 */
  skippedEmptyLeadRows: number;
}

/**
 * 表の単位を箇条書きへ変換する（規則 T4）。lead = 第1セル、
 * detail = 残りのセルを「：」で連結したもの。セルの文字列
 * 自体は改変しない。
 */
export function convertDeckTableUnit(unit: DeckMaterialUnit): DeckTableConversion {
  const { header, rows } = parseDeckTableRows(unit.text);
  const bullets: ProposalDeckBullet[] = [];
  let skippedEmptyLeadRows = 0;
  for (const cells of rows) {
    const [lead = '', ...rest] = cells;
    if (lead === '') {
      skippedEmptyLeadRows += 1;
      continue;
    }
    bullets.push({ lead, detail: rest.join('：') });
  }
  return { header, bullets, skippedEmptyLeadRows };
}

// ---------------------------------------------------------------------------
// 組立文書 → ProposalDeck の変換
// ---------------------------------------------------------------------------

export type DeckRenderIssueCode =
  | 'TITLE_MISSING'
  | 'SUMMARY_POINTS_INVALID'
  | 'SECTIONS_EMPTY'
  | 'SECTION_MESSAGE_MISSING'
  | 'NEXT_STEPS_MISSING';

export interface DeckRenderIssue {
  code: DeckRenderIssueCode;
  /** 関連する節の位置（0始まり）。無関係なら null。 */
  sectionIndex: number | null;
}

/** 60字ルール（§7.3）を超えた箇条書きの位置と字数。切り捨てはしない。 */
export interface DeckRenderOverlongBullet {
  sectionIndex: number;
  bulletIndex: number;
  /** lead + detail の字数（コードポイント単位、現行自己チェックと同じ数え方）。 */
  charCount: number;
}

export interface DeckRenderConversionResult {
  /** ProposalDeck を構築できれば true。 */
  ok: boolean;
  /** 変換後の資料モデル。構築できない場合は null。 */
  deck: ProposalDeck | null;
  /** 構築できない理由（全て集める）。 */
  issues: readonly DeckRenderIssue[];
  /** visual（table）を設定した節の位置。 */
  tableSectionIndexes: readonly number[];
  /** 表の見出し行（節の位置つき。描画には使わない透明性のための情報）。 */
  tableHeaders: readonly { sectionIndex: number; header: readonly string[] }[];
  /** 第1セルが空のため落とした表の行の総数。 */
  skippedTableRows: number;
  /** 60字ルールを超えた箇条書き（切り捨てずに記録する）。 */
  overlongBullets: readonly DeckRenderOverlongBullet[];
}

/** コードポイント単位の文字数（現行自己チェックの charCount と同じ数え方）。 */
function deckCharCount(text: string): number {
  return [...text].length;
}

/**
 * D-PR-4 の組立文書を現行の ProposalDeck へ決定的に変換する。
 * 同じ入力には同じ出力を返す。構造的に満たせない場合は
 * deck を null にし、理由を issues に全て返す（fail-closed）。
 * 60字超過・表の行数超過は変換自体は行い、記録と現行自己
 * チェックへの表面化に委ねる（緩和も切り捨てもしない）。
 */
export function convertAssembledDeckToProposalDeck(
  document: DeckAssembledDocument,
): DeckRenderConversionResult {
  const issues: DeckRenderIssue[] = [];
  const tableSectionIndexes: number[] = [];
  const tableHeaders: { sectionIndex: number; header: readonly string[] }[] = [];
  let skippedTableRows = 0;
  const overlongBullets: DeckRenderOverlongBullet[] = [];
  const maxBulletChars = PROPOSAL_DESIGN_TOKENS.bullets.maxChars;

  if (document.titleText === null || document.titleText === '') {
    issues.push({ code: 'TITLE_MISSING', sectionIndex: null });
  }
  if (document.summaryUnits.length !== 3) {
    issues.push({ code: 'SUMMARY_POINTS_INVALID', sectionIndex: null });
  }
  if (document.sections.length === 0) {
    issues.push({ code: 'SECTIONS_EMPTY', sectionIndex: null });
  }
  if (document.nextStepUnits.length === 0) {
    issues.push({ code: 'NEXT_STEPS_MISSING', sectionIndex: null });
  }

  const sections: ProposalDeckSection[] = [];
  document.sections.forEach((section, sectionIndex) => {
    if (section.messageUnit === null) {
      issues.push({ code: 'SECTION_MESSAGE_MISSING', sectionIndex });
    }
    const bullets: ProposalDeckBullet[] = [];
    let hasTableRows = false;
    for (const unit of section.bodyUnits) {
      if (unit.kind === 'table') {
        const converted = convertDeckTableUnit(unit);
        skippedTableRows += converted.skippedEmptyLeadRows;
        if (converted.header !== null) {
          tableHeaders.push({ sectionIndex, header: converted.header });
        }
        if (converted.bullets.length > 0) hasTableRows = true;
        bullets.push(...converted.bullets);
      } else {
        bullets.push(splitDeckBulletText(unit.text));
      }
    }
    bullets.forEach((bullet, bulletIndex) => {
      const charCount = deckCharCount(bullet.lead) + deckCharCount(bullet.detail);
      if (charCount > maxBulletChars) {
        overlongBullets.push({ sectionIndex, bulletIndex, charCount });
      }
    });
    const convertedSection: ProposalDeckSection = {
      role: section.role,
      message: section.messageUnit?.text ?? '',
      bullets,
    };
    if (section.topicText !== null) {
      convertedSection.topic = section.topicText;
    }
    if (hasTableRows) {
      convertedSection.visual = { kind: 'table' };
      tableSectionIndexes.push(sectionIndex);
    }
    sections.push(convertedSection);
  });

  if (issues.length > 0) {
    return {
      ok: false,
      deck: null,
      issues,
      tableSectionIndexes,
      tableHeaders,
      skippedTableRows,
      overlongBullets,
    };
  }

  const deck: ProposalDeck = {
    title: document.titleText as string,
    // 副題・日付・要約見出し・締めの依頼文は、組立文書に対応する
    // 材料が無いため作らない（空文字。捏造しない）。
    subtitle: '',
    date: '',
    summary: {
      headline: '',
      points: document.summaryUnits.map((unit) => unit.text) as [string, string, string],
    },
    sections,
    closing: {
      ask: '',
      nextSteps: document.nextStepUnits.map((unit) => unit.text),
    },
    assumptions: [...document.assumptions],
  };
  return {
    ok: true,
    deck,
    issues,
    tableSectionIndexes,
    tableHeaders,
    skippedTableRows,
    overlongBullets,
  };
}
