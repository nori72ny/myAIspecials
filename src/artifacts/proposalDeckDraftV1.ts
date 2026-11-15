/**
 * 提案資料「資料レコード再設計」のモードB（材料なし：タグ形式の起草）
 * の部品（D-PR-2）。
 *
 * 設計正本: ~/workspace/origin-fix/DECK_RECORDS_REDESIGN_2026-11-15.md
 * （§4 モードB、§7.1 ゲート1の形式違反コード）
 *
 * 本モジュールは次の3点だけを提供する未配線の部品であり、現行の
 * 資料経路（チャットルーター、現行パーサー、自己チェック、
 * レンダラー）には接続しない。配線は D-PR-6 の担当。
 *
 * 1. 起草指示文（buildDeckDraftInstruction）: モデルに固定行頭タグで
 *    起草させるための指示。§4.3 の「作らない」ルール6項目と、§4.4 の
 *    few-shot 3種（成功例／主張文なし例／不足を返す例）を含む。
 * 2. タグパーサ（parseDeckDraft）: 行頭タグでブロックに切り、形式
 *    違反（未知タグ・必須タグの重複・節番号の連番欠け・必須タグの
 *    欠落）を決定的に検出する。内容の良し悪しは判定しない（ゲート1
 *    の担当は「構造的に解釈できること」だけであり、形式の合格は
 *    内容の正しさを意味しない。設計 §7.1）。
 * 3. 起草→材料レコード変換（convertDeckDraftToMaterial）: タグ
 *    ブロックを共通材料レコード（DeckMaterialUnit、D-ID、
 *    sourceKind = model-draft）へ変換する。変換は決定的処理のみで、
 *    本文の書き換え・要約・補完を一切しない。モードBの G1 は
 *    「タグブロックの逐語が改変されずに掲載されること」であり
 *    （設計 §4.2）、単位テキストはブロック内の行そのもの（前後の
 *    空白を除いた逐語）とする。箇条書きの記号も含めて一切除去
 *    しない代わりに、起草形式の側で「記号を付けず1行に1項目」と
 *    規定する。
 *
 * D-ID の付与は D-PR-1 の buildDeckDraftUnits を土台とし、二重実装
 * しない。配置・組立・充足判定は後続 PR（D-PR-3 以降）の担当。
 */

import {
  buildDeckDraftUnits,
  type DeckDraftUnitEntry,
  type DeckMaterialUnit,
} from './proposalDeckRecordsV1.js';

// ---------------------------------------------------------------------------
// 起草指示文（設計 §4.1〜§4.4）
// ---------------------------------------------------------------------------

/** 節の上限（設計 §4.1：現行のスライド数範囲から9節まで）。 */
export const DECK_DRAFT_MAX_SECTIONS = 9;

/**
 * モードBの起草指示文（サーバー側のシステム指示へ追加する固定文）。
 *
 * 構成: タグ仕様（§4.1 の表）＋「作らない」ルール6項目（§4.3）＋
 * few-shot 3種（§4.4）。few-shot は架空のテーマ・一般名詞のみで、
 * 実在の企業名・製品名・価格・実績数値を含めない。例1は全タグが
 * 埋まる完全な形、例2・例3は要点を示す部分形（他のタグは例1と
 * 同様に書く旨を明記する）。
 *
 * 長さは D-PR-2 で実測して固定する（テストで上限を固定）。実測
 * 1,437字（内訳: タグ仕様＋ルール 666字、例1 357字、例2 115字、
 * 例3 299字）。現行の骨格指示（PROPOSAL_DECK_SKELETON_INSTRUCTION、
 * 996字）と同程度を目安とし、超過分は few-shot 3種の必須分である
 * （仕様＋ルールだけなら 666字で骨格指示より短い）。
 */
export function buildDeckDraftInstruction(): string {
  return [
    '提案資料の起草形式（この依頼専用の追加ルール）:',
    'この回答は提案資料の原稿です。前置きや説明を付けず、次の固定タグだけで書いてください。タグは行頭に単独で書き、箇条書きのブロックは記号を付けず1行に1項目を書きます。',
    '[導入] ユーザーへの案内文（1つ）',
    '[資料タイトル] 資料のタイトル（1行・1つ）',
    '[要点] 全体の要点（1行に1点、3点）',
    '[節N_題目] 節の題目（節ごとに0〜1つ）',
    '[節N_主張] 節の結論を言い切る1文（節ごとに1つ）',
    '[節N_本文] 節の本文（1行に1項目、節ごとに1つ）',
    '[次の一手] 具体的な行動（1行に1項目、1つ）',
    '[前提] 仮定を置いた場合の明示（0〜1つ）',
    '[確認事項] 不足している情報（0〜1つ）',
    `節番号Nは1からの連番で、節は${DECK_DRAFT_MAX_SECTIONS}つまでです。`,
    '',
    '作らないこと:',
    '- 提示されていない製品名・企業名・具体的な価格・実績数値を作らないでください。不明な固有名詞は「本サービス」「貴社」のような一般名詞で書きます。',
    '- 構成案（スライドの説明、「表紙」「タイトル」「内容」のようなメタ説明）は書かないでください。各タグには資料に載る本文そのものを書きます。',
    '- 数値が必要だが根拠がない箇所は、数値を作らず[確認事項]に回してください。',
    '- 仮定を置いた場合は、[前提]に明示してください。',
    '- [節N_主張]には、名詞で終わる題目ではなく、文として閉じた結論を書いてください。',
    '- タグは省略しないでください。書ける材料がない場合は無理に埋めず、[確認事項]に不足として挙げてください。',
    '',
    '例1（材料が足りている場合）:',
    '[導入]',
    '本資料では、情報共有の手間を減らす進め方をご提案します。',
    '[資料タイトル]',
    '情報共有の手間を減らす仕組みのご提案',
    '[要点]',
    '記録の手間が減り、共有漏れを防げます',
    '担当者が変わっても経緯を追えます',
    '小さな範囲から導入を始められます',
    '[節1_題目]',
    '現状の課題',
    '[節1_主張]',
    '情報が個人ごとに分散し、探す手間が増えています。',
    '[節1_本文]',
    '連絡手段が複数に分かれています',
    '過去の決定の経緯が残っていません',
    '[節2_題目]',
    '進め方',
    '[節2_主張]',
    '記録先を本サービスに一本化すれば、共有の手間を減らせます。',
    '[節2_本文]',
    '記録先を本サービスに統一します',
    '週に一度、漏れがないか確認します',
    '[次の一手]',
    '一部の部署で試行を始める',
    '[前提]',
    '対象は社内の情報共有に限ります',
    '',
    '例2（主張文の材料がない節がある場合。他のタグは例1と同様に書きます）:',
    '[節1_題目]',
    '費用の考え方',
    '[節1_本文]',
    '費用は規模に応じて変わります',
    '[確認事項]',
    '節1の主張文を書くための材料（費用の確定情報）が不足しています',
    '',
    '例3（テーマだけで具体条件がない場合）:',
    '[導入]',
    'ご依頼のテーマで書ける範囲の汎用案をお示しします。確定情報が不足する点は[確認事項]に挙げています。',
    '[資料タイトル]',
    '本サービスのご提案',
    '[要点]',
    '業務の流れに合わせて段階的に導入できます',
    '運用の負担を抑えて始められます',
    '効果は試行の結果を見て判断できます',
    '[節1_題目]',
    '進め方',
    '[節1_主張]',
    '小さく試行してから広げる進め方が安全です。',
    '[節1_本文]',
    '対象を絞って試行します',
    '結果を確認してから範囲を広げます',
    '[次の一手]',
    '試行の対象範囲を決める',
    '[確認事項]',
    '正式なサービス名、確定している料金、示せる導入効果とその根拠が不足しています',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// タグパーサ（設計 §4.1 のパース規則、§7.1 ゲート1）
// ---------------------------------------------------------------------------

/**
 * 形式違反コード（設計 §7.1 ゲート1）。
 *
 * D-PR-1 では形式違反コードは固定されなかったため、§7.1 の例示に
 * 沿って本 PR で新設する。DECK_FORMAT_TAG_MISSING /
 * DECK_FORMAT_TAG_DUPLICATED / DECK_FORMAT_UNKNOWN_TAG は §7.1 の
 * 例示そのまま。節番号の連番欠けは §7.1 の例示に専用コードが
 * 無かったため、DECK_FORMAT_SECTION_SEQUENCE_GAP を追加した。
 * §7.1 の DECK_PLAN_* 系（配置計画側のコード）は D-PR-3 の担当。
 */
export type DeckFormatViolationCode =
  | 'DECK_FORMAT_TAG_MISSING'
  | 'DECK_FORMAT_TAG_DUPLICATED'
  | 'DECK_FORMAT_UNKNOWN_TAG'
  | 'DECK_FORMAT_SECTION_SEQUENCE_GAP';

export interface DeckFormatViolation {
  code: DeckFormatViolationCode;
  /**
   * 関連するタグの正規表記（例: '要点'、'節2_主張'）。未知タグでは
   * 検出したタグの中身そのもの。節番号の連番欠けでは null。
   */
  tag: string | null;
  /** 関連する節番号。節と無関係な違反では null。 */
  section: number | null;
  /** 関連する行番号（1始まり）。欠落の違反では null。 */
  line: number | null;
}

/** タグブロックの種別。 */
export type DeckDraftTagKind =
  | 'introduction'
  | 'title'
  | 'summary'
  | 'section-topic'
  | 'section-assertion'
  | 'section-body'
  | 'next-steps'
  | 'assumptions'
  | 'questions';

export interface DeckDraftBlock {
  kind: DeckDraftTagKind;
  /** タグの正規表記（例: '導入'、'節2_主張'）。 */
  tag: string;
  /** 節タグの節番号。それ以外は null。 */
  section: number | null;
  /** ブロックの内容行（空行を除き、前後の空白を除いた逐語行）。出現順。 */
  lines: readonly string[];
  /** タグ行の行番号（1始まり）。 */
  line: number;
}

export interface DeckDraftParseResult {
  /** 認識できたブロック（重複分を含む）。出現順。 */
  blocks: readonly DeckDraftBlock[];
  /** 形式違反（決定的な順序で返す。検出順の規定は parseDeckDraft の説明参照）。 */
  violations: readonly DeckFormatViolation[];
  /**
   * どのブロックにも属さなかった非空行の件数（最初のタグより前の行、
   * 未知タグ配下の行）。本文は保持しない（件数のみの観測用）。
   */
  unassignedLineCount: number;
}

interface DeckDraftTagSpec {
  kind: DeckDraftTagKind;
  /** 単一必須タグ（ちょうど1つ必要）か。 */
  requiredSingle: boolean;
  /** 任意タグ（0〜1つ）か。 */
  optionalSingle: boolean;
}

const DECK_DRAFT_FIXED_TAGS: ReadonlyMap<string, DeckDraftTagSpec> = new Map([
  ['導入', { kind: 'introduction', requiredSingle: true, optionalSingle: false }],
  ['資料タイトル', { kind: 'title', requiredSingle: true, optionalSingle: false }],
  ['要点', { kind: 'summary', requiredSingle: true, optionalSingle: false }],
  ['次の一手', { kind: 'next-steps', requiredSingle: true, optionalSingle: false }],
  ['前提', { kind: 'assumptions', requiredSingle: false, optionalSingle: true }],
  ['確認事項', { kind: 'questions', requiredSingle: false, optionalSingle: true }],
]);

const DECK_DRAFT_SECTION_TAG_PATTERN = /^節([1-9]\d*)_(題目|主張|本文)$/;

const DECK_DRAFT_SECTION_KIND_BY_SUFFIX: ReadonlyMap<string, DeckDraftTagKind> = new Map([
  ['題目', 'section-topic'],
  ['主張', 'section-assertion'],
  ['本文', 'section-body'],
]);

interface DeckDraftTagMatch {
  kind: DeckDraftTagKind;
  /** 正規表記（節番号の先行ゼロ等を正規化したもの）。 */
  tag: string;
  section: number | null;
}

/** 行頭タグの中身を解釈する。タグとして読めなければ null。 */
function matchDeckDraftTag(tagInner: string): DeckDraftTagMatch | null {
  const fixed = DECK_DRAFT_FIXED_TAGS.get(tagInner);
  if (fixed !== undefined) {
    return { kind: fixed.kind, tag: tagInner, section: null };
  }
  const sectionMatch = DECK_DRAFT_SECTION_TAG_PATTERN.exec(tagInner);
  if (sectionMatch !== null) {
    const section = Number(sectionMatch[1]);
    const kind = DECK_DRAFT_SECTION_KIND_BY_SUFFIX.get(sectionMatch[2]);
    if (kind !== undefined) {
      return { kind, tag: `節${section}_${sectionMatch[2]}`, section };
    }
  }
  return null;
}

const DECK_DRAFT_TAG_LINE_PATTERN = /^\[([^\]]+)\]\s*(.*)$/;

/**
 * モードBの起草テキストを行頭タグでブロックに切り、形式違反を
 * 検出する。決定的処理であり、同じ入力には常に同じ結果を返す。
 *
 * パース規則（設計 §4.1）:
 * - 行頭の `[タグ]` でブロックを開始する。タグの後ろに同じ行で
 *   続く文字列は、そのブロックの最初の内容行として扱う。
 * - 内容行は空行を除き、前後の空白を除いて保持する（逐語性は
 *   行単位で保つ。変換側はこの行を一切書き換えない）。
 * - `[...]` の形をしていて既知タグに一致しない行頭は未知タグ
 *   （DECK_FORMAT_UNKNOWN_TAG）とし、その配下の行はどのブロック
 *   にも属さない。タグより前の行も同様に属さない。
 *
 * 形式違反の検出（設計 §7.1 ゲート1）:
 * - 未知タグ: 出現順に DECK_FORMAT_UNKNOWN_TAG。
 * - 重複: 同一タグ（節タグは節番号＋種別）が2回以上現れたら、
 *   2回目の出現に DECK_FORMAT_TAG_DUPLICATED を1件。
 * - 連番欠け: 節タグが現れた節番号の集合が 1..最大値 の連番で
 *   なければ、欠けた番号ごとに DECK_FORMAT_SECTION_SEQUENCE_GAP。
 * - 必須タグの欠落: 単一必須タグ（導入・資料タイトル・要点・
 *   次の一手）が無ければ DECK_FORMAT_TAG_MISSING。節が1つも
 *   無ければ、節1の主張・本文を欠落として数える。節タグが1つ
 *   でもある節については、主張・本文が無ければ欠落として数える
 *   （題目は任意）。連番欠けで存在しない節は欠落の対象にしない
 *   （連番欠け側で数える）。
 * - ブロックの中身が空であること自体は形式違反にしない（要点の
 *   件数・空節などの充足はゲート3の担当、設計 §7.3）。
 *
 * 違反の返却順は決定的に固定する: 未知タグ（出現順）→ 重複
 * （2回目の出現順）→ 連番欠け（番号の昇順）→ 欠落（導入・
 * 資料タイトル・要点・節の昇順（主張→本文）・次の一手）。
 */
export function parseDeckDraft(draftText: string): DeckDraftParseResult {
  const violations: DeckFormatViolation[] = [];
  const blocks: DeckDraftBlock[] = [];
  let unassignedLineCount = 0;

  let current: { match: DeckDraftTagMatch; line: number; lines: string[] } | null = null;

  const flushCurrent = () => {
    if (current === null) return;
    blocks.push({
      kind: current.match.kind,
      tag: current.match.tag,
      section: current.match.section,
      lines: current.lines,
      line: current.line,
    });
    current = null;
  };

  const rawLines = draftText.split(/\r\n|\r|\n/);
  for (let index = 0; index < rawLines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = rawLines[index].trim();
    const tagLine = trimmed === '' ? null : DECK_DRAFT_TAG_LINE_PATTERN.exec(trimmed);
    if (tagLine !== null) {
      const match = matchDeckDraftTag(tagLine[1]);
      flushCurrent();
      if (match === null) {
        violations.push({
          code: 'DECK_FORMAT_UNKNOWN_TAG',
          tag: tagLine[1],
          section: null,
          line: lineNumber,
        });
        continue;
      }
      current = { match, line: lineNumber, lines: [] };
      const rest = tagLine[2].trim();
      if (rest !== '') current.lines.push(rest);
      continue;
    }
    if (trimmed === '') continue;
    if (current !== null) {
      current.lines.push(trimmed);
    } else {
      unassignedLineCount += 1;
    }
  }
  flushCurrent();

  // 重複: 同一タグの2回目以降の出現（違反は2回目に1件だけ数える）。
  const seenTags = new Map<string, number>();
  for (const block of blocks) {
    const count = (seenTags.get(block.tag) ?? 0) + 1;
    seenTags.set(block.tag, count);
    if (count === 2) {
      violations.push({
        code: 'DECK_FORMAT_TAG_DUPLICATED',
        tag: block.tag,
        section: block.section,
        line: block.line,
      });
    }
  }

  // 節番号の集合と連番欠け。
  const sectionNumbers = new Set<number>();
  for (const block of blocks) {
    if (block.section !== null) sectionNumbers.add(block.section);
  }
  const maxSection = sectionNumbers.size === 0 ? 0 : Math.max(...sectionNumbers);
  for (let n = 1; n <= maxSection; n += 1) {
    if (!sectionNumbers.has(n)) {
      violations.push({
        code: 'DECK_FORMAT_SECTION_SEQUENCE_GAP',
        tag: null,
        section: n,
        line: null,
      });
    }
  }

  // 必須タグの欠落。
  const presentTags = new Set(blocks.map((block) => block.tag));
  const missingFixedOrder = ['導入', '資料タイトル', '要点'];
  for (const tag of missingFixedOrder) {
    if (!presentTags.has(tag)) {
      violations.push({ code: 'DECK_FORMAT_TAG_MISSING', tag, section: null, line: null });
    }
  }
  const sectionsToCheck = sectionNumbers.size === 0 ? [1] : [...sectionNumbers].sort((a, b) => a - b);
  for (const n of sectionsToCheck) {
    for (const suffix of ['主張', '本文']) {
      const tag = `節${n}_${suffix}`;
      if (!presentTags.has(tag)) {
        violations.push({ code: 'DECK_FORMAT_TAG_MISSING', tag, section: n, line: null });
      }
    }
  }
  if (!presentTags.has('次の一手')) {
    violations.push({ code: 'DECK_FORMAT_TAG_MISSING', tag: '次の一手', section: null, line: null });
  }

  return { blocks, violations, unassignedLineCount };
}

// ---------------------------------------------------------------------------
// 起草→材料レコード変換（設計 §4.2）
// ---------------------------------------------------------------------------

export interface DeckDraftSectionConversion {
  /** 節番号。 */
  sectionNumber: number;
  /**
   * [節N_題目] の逐語（題目フィールドの候補として保持する。材料
   * 単位にはしない、設計 §4.2）。題目ブロックが無ければ null。
   */
  topicCandidate: string | null;
  /** [節N_主張] の単位（1単位）。主張ブロックが無い・空なら null。 */
  assertionUnit: DeckMaterialUnit | null;
  /** [節N_本文] の単位列（各行1単位）。 */
  bodyUnits: readonly DeckMaterialUnit[];
}

export interface DeckDraftConversion {
  /**
   * 材料レコードの全単位（D-ID、sourceKind = model-draft）。
   * 起草内の出現順に並ぶ（要点→節の主張・本文→次の一手、という
   * 固定順ではなく、ブロックの出現順そのもの）。
   */
  units: readonly DeckMaterialUnit[];
  /** [導入] の逐語（行を改行で結んだもの）。単位化しない。無ければ null。 */
  introduction: string | null;
  /** [資料タイトル] の逐語（1行に圧縮）。単位化しない。無ければ null。 */
  title: string | null;
  /** [要点] の単位列（各行1単位）。 */
  summaryUnits: readonly DeckMaterialUnit[];
  /** 節ごとの変換結果（節番号の昇順）。 */
  sections: readonly DeckDraftSectionConversion[];
  /** [次の一手] の単位列（各行1単位）。 */
  nextStepUnits: readonly DeckMaterialUnit[];
  /** [前提] の各行（起草レベルの情報として保持し、単位化しない）。 */
  assumptions: readonly string[];
  /** [確認事項] の各行（同上）。 */
  questions: readonly string[];
}

/** 複数行ブロックを1つの値へ圧縮する（空白の圧縮のみ。語の改変はしない）。 */
function compactDeckDraftBlockText(lines: readonly string[]): string {
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * タグブロックを共通材料レコードへ変換する（設計 §4.2）。
 *
 * - [要点] の各行、[節N_主張] の1文、[節N_本文] の各行、[次の一手]
 *   の各行を、それぞれ1単位とする（D-ID は起草内の出現順）。
 *   [節N_主張] は1単位が原則であり、複数行に分かれた場合は空白の
 *   圧縮で1単位にまとめる（V13 の散文圧縮と同種の整形のみで、語の
 *   改変はしない）。
 * - [節N_題目] は題目フィールドの候補として保持し、単位にしない。
 * - [導入]・[資料タイトル]・[前提]・[確認事項] は起草レベルの情報
 *   として構造化して保持し、単位にしない。
 * - 同一タグが重複している場合は、最初のブロックだけを変換対象に
 *   する（重複自体はパーサが形式違反として数える。変換は決定的に
 *   最初のものを採る）。
 * - 形式違反がある起草でも変換自体は行う（違反の扱いはゲート1の
 *   判定側の責務であり、変換は純粋な写像として保つ）。
 */
export function convertDeckDraftToMaterial(parsed: DeckDraftParseResult): DeckDraftConversion {
  const firstBlockByTag = new Map<string, DeckDraftBlock>();
  for (const block of parsed.blocks) {
    if (!firstBlockByTag.has(block.tag)) firstBlockByTag.set(block.tag, block);
  }

  const entries: DeckDraftUnitEntry[] = [];
  const entryRoles: Array<
    | { role: 'summary' }
    | { role: 'assertion'; section: number }
    | { role: 'body'; section: number }
    | { role: 'next-steps' }
  > = [];
  const pushEntry = (
    text: string,
    kind: DeckDraftUnitEntry['kind'],
    role: (typeof entryRoles)[number],
  ) => {
    if (text === '') return;
    entries.push({ text, kind });
    entryRoles.push(role);
  };

  // 単位化するブロックは起草内の出現順に処理し、D-ID の順序を
  // 出現順と一致させる。
  const processedTags = new Set<string>();
  for (const block of parsed.blocks) {
    if (firstBlockByTag.get(block.tag) !== block) continue;
    if (processedTags.has(block.tag)) continue;
    processedTags.add(block.tag);
    switch (block.kind) {
      case 'summary':
        for (const line of block.lines) pushEntry(line, 'bullet', { role: 'summary' });
        break;
      case 'section-assertion':
        pushEntry(compactDeckDraftBlockText(block.lines), 'sentence', {
          role: 'assertion',
          section: block.section ?? 0,
        });
        break;
      case 'section-body':
        for (const line of block.lines) {
          pushEntry(line, 'bullet', { role: 'body', section: block.section ?? 0 });
        }
        break;
      case 'next-steps':
        for (const line of block.lines) pushEntry(line, 'bullet', { role: 'next-steps' });
        break;
      default:
        break;
    }
  }

  const units = buildDeckDraftUnits(entries);

  const summaryUnits: DeckMaterialUnit[] = [];
  const nextStepUnits: DeckMaterialUnit[] = [];
  const assertionBySection = new Map<number, DeckMaterialUnit>();
  const bodyBySection = new Map<number, DeckMaterialUnit[]>();
  units.forEach((unit, index) => {
    const role = entryRoles[index];
    if (role === undefined) return;
    switch (role.role) {
      case 'summary':
        summaryUnits.push(unit);
        break;
      case 'next-steps':
        nextStepUnits.push(unit);
        break;
      case 'assertion':
        assertionBySection.set(role.section, unit);
        break;
      case 'body': {
        const list = bodyBySection.get(role.section) ?? [];
        list.push(unit);
        bodyBySection.set(role.section, list);
        break;
      }
    }
  });

  const sectionNumbers = new Set<number>();
  for (const block of parsed.blocks) {
    if (block.section !== null) sectionNumbers.add(block.section);
  }
  const sections: DeckDraftSectionConversion[] = [...sectionNumbers]
    .sort((a, b) => a - b)
    .map((sectionNumber) => {
      const topicBlock = firstBlockByTag.get(`節${sectionNumber}_題目`);
      return {
        sectionNumber,
        topicCandidate:
          topicBlock === undefined ? null : compactDeckDraftBlockText(topicBlock.lines) || null,
        assertionUnit: assertionBySection.get(sectionNumber) ?? null,
        bodyUnits: bodyBySection.get(sectionNumber) ?? [],
      };
    });

  const introductionBlock = firstBlockByTag.get('導入');
  const titleBlock = firstBlockByTag.get('資料タイトル');
  const assumptionsBlock = firstBlockByTag.get('前提');
  const questionsBlock = firstBlockByTag.get('確認事項');

  return {
    units,
    introduction: introductionBlock === undefined ? null : introductionBlock.lines.join('\n') || null,
    title: titleBlock === undefined ? null : compactDeckDraftBlockText(titleBlock.lines) || null,
    summaryUnits,
    sections,
    nextStepUnits,
    assumptions: assumptionsBlock === undefined ? [] : [...assumptionsBlock.lines],
    questions: questionsBlock === undefined ? [] : [...questionsBlock.lines],
  };
}
