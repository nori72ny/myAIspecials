/**
 * 提案資料「資料レコード再設計」の組立と自己チェック5ゲート（D-PR-4）。
 *
 * 設計正本: ~/workspace/origin-fix/DECK_RECORDS_REDESIGN_2026-11-15.md
 * （§5 二重描画の前段、§6 見出しの2フィールド化と昇格ルール、§7
 * 自己チェックの5ゲート再編、§8 構成案メタ語彙ゲート、§13の裁定）
 *
 * 本モジュールは未配線の部品であり、現行の資料経路（チャット
 * ルーター、現行パーサー、現行自己チェック checkProposalDeck、
 * レンダラー）には接続しない。現行自己チェックとは併存させ、
 * 置き換えない（設計 §12 D-PR-4）。配線は D-PR-6、描画は D-PR-5
 * の担当。
 *
 * 提供するもの:
 * 1. 二要素の見出しモデルを持つ組立文書（DeckAssembledDocument）。
 *    節は 題目（topic、任意）＋ 主張文（message、必須）＋ 本文単位
 *    を持つ。題目は主張ではないため主張文判定の対象にしない
 *    （設計 §6.1）。ProposalDeck 側のモデルにも topic を追加し、
 *    プランナーが受けられるようにした（proposalDeckV1 /
 *    proposalDeckPlannerV1）。2段見出しの描画自体は D-PR-5。
 * 2. 逐語昇格ルール（設計 §6.3）: 主張文候補が主張文判定に不合格
 *    の場合に限り、本文の最初の単位が完結した文で主張文判定に
 *    合格すれば、その単位を主張文へ昇格させ、元の候補文を題目へ
 *    送る。細部は統括裁定 §13-7 (a) に従い、題目が既に占有されて
 *    いる節では昇格しない。候補自体が無い節でも発動しない（不足
 *    は不足として扱う）。昇格は1節につき1回まで、本文の第2単位
 *    以降は探索せず、文の改変は一切行わない。
 * 3. 自己チェックの5ゲート（設計 §7）。順序は固定し、全ゲートの
 *    違反を集めてから判定する（現行の fail-fast でない方式を維持）。
 *    - ゲート1 形式: D-PR-2（モードBタグ）／D-PR-3（モードA配置
 *      計画）の形式違反をそのまま集約する。
 *    - ゲート2 原文忠実性: 掲載テキストがすべて材料単位の逐語で
 *      あることと、数値トークンの多重集合一致を、D-PR-1 の照合
 *      部品で組立後に再確認する（二重の防壁）。数値照合の対象
 *      範囲は統括裁定（方式 (a)）: 配置に採用した材料全体の数値
 *      について多重集合一致を要求する。採用されなかった単位の
 *      数値は範囲外（網羅性の保証ではない）。単位・対象・期間の
 *      対応は保証しない（設計 §7.2）。
 *    - ゲート3 資料としての充足: 必須要素を実質件数で数える。
 *      不足コードは D-PR-3 の不足再計算（DeckMissingCode）と
 *      共用し、配置段階の「必須役割の欠落」に加えて、要点
 *      ちょうど3点・本文のある節3件以上・空節と重複の除外と
 *      いった充足条件そのものをここで判定する（D-PR-3 の再計算
 *      は充足条件までは扱わない、という境界を引き継ぐ）。
 *      プレースホルダー残存と1節の本文単位4件までも現行条件
 *      として維持する。箇条書き60字ルールは、lead/detail への
 *      分割（D-PR-5 の描画側）で初めて意味を持つ制約であり、
 *      分割前の逐語単位には適用しない（長さを理由に材料を落と
 *      さない。設計 §7.5 の「原文を削って収めることはしない」
 *      方針と同旨）。
 *    - ゲート4 意味上の適格性: 決定的に判定できる範囲だけを扱う。
 *      主張文判定は「文の閉じ方の検査」であり、文が結論を述べて
 *      いること・根拠と対応していることは保証しない（設計
 *      §7.4／§7.6）。判定は現行 isAssertion を土台とし、§7.4 の
 *      確定事項として、リストの穴のうち受動形（される／された／
 *      されます／されました／されている／されていた）だけを
 *      「文の閉じ」として追加で認める（isDeckAssertionSentence）。
 *      旧自己チェックの isAssertion 自体は変更しない（併存の
 *      ため、無句読点の受動形は旧経路では不合格のままになる。
 *      これは意図した切り分けである）。質問形・条件付きの文を
 *      主張文・次の一手に置いていないことも、文末形のパターン
 *      で判定できる範囲に限って検査する。構成案メタ語彙ゲート
 *      （§8）は本ゲートに含め、検出した単位は掲載から落とす
 *      （裁定 §13-8 (a)。落とした結果として役割が不足すれば
 *      ゲート3で不足として扱い、黙って別の文で埋めない）。
 *    - ゲート5 描画可能性: 組立文書が描画へ進める形であることの
 *      事前条件（総スライド数の範囲、表単位が表として描画できる
 *      形であること）。PPTX 生成物そのものの検証（zip 署名・
 *      パッケージ構成・サイズ上限・sha256）とフォント指定の確認
 *      は、描画が存在する D-PR-5 の担当であり、本ゲートはそれを
 *      置き換えない。色トークンは材料レコード側に visual の概念
 *      が無いため対象外。
 * 4. 組立フロー: モードA（素材の分割→配置（モデル配置計画または
 *    決定的配置）→メタ除去→昇格→ゲート）と、モードB（タグ起草の
 *    パース→材料レコード変換→メタ除去→昇格→ゲート）の両方を
 *    通す組立関数。節の役割は、節の順序に固定骨格の役割順を
 *    アプリ側で割り当てる（裁定 §13-11 (a)）。
 *
 * 保証範囲は設計 §7.6 のとおり: 本モジュールの合格は「掲載文字列
 * が材料の逐語であり、変換側が創作・改変していない（G1）」ことと、
 * 各ゲートの決定的検査を通ったことだけを意味する。材料自体の
 * 真実性、主張と根拠の意味的対応、起草内容の根拠（G2）は保証
 * しない。
 */

import { normalizedRecordsText } from '../research/groundedResearchRecordsV13.js';
import {
  PROPOSAL_DESIGN_TOKENS,
  PROPOSAL_SECTION_ROLE_ORDER,
  type ProposalDeckSectionRole,
} from './proposalDeckV1.js';
import {
  buildDeckMaterialUnits,
  checkDeckNumericPreservation,
  checkDeckVerbatim,
  type DeckMaterialUnit,
} from './proposalDeckRecordsV1.js';
import {
  convertDeckDraftToMaterial,
  parseDeckDraft,
  type DeckFormatViolation,
  type DeckFormatViolationCode,
} from './proposalDeckDraftV1.js';
import {
  buildDeckPlacement,
  buildDeterministicDeckPlacement,
  type DeckMissingCode,
  type DeckPlacementMissingEntry,
  type DeckPlacementPlan,
  type DeckPlanViolation,
  type DeckPlanViolationCode,
} from './proposalDeckPlacementV1.js';
import { hasPlaceholder, isAssertion } from './proposalDeckSelfCheckV1.js';

// ---------------------------------------------------------------------------
// 組立文書のモデル（設計 §6.1 の二要素モデル、材料レコード側）
// ---------------------------------------------------------------------------

/** 組立文書の中でテキストが置かれる役割。 */
export type DeckPlacedRole =
  | 'title'
  | 'summary'
  | 'section-topic'
  | 'section-message'
  | 'section-body'
  | 'next-steps'
  | 'assumptions';

/**
 * 組立後の節。見出しは2要素（題目＋主張文）に分かれる。
 * 掲載文字列は常に材料単位から取得し、ここでは単位への参照で
 * 持つ（文字列のコピーは作らない）。
 */
export interface DeckAssembledSection {
  /** 節の役割（節の順序への固定割り当て、deckSectionRoleForIndex）。 */
  role: ProposalDeckSectionRole;
  /**
   * 題目（トピックラベル）の材料単位。モードAでは配置が指した
   * 単位、昇格が発動した節では元の主張文候補の単位。モードBでは
   * 題目は単位化されないため null（topicText 側に逐語が入る）。
   */
  topicUnit: DeckMaterialUnit | null;
  /** 題目の逐語テキスト（topicUnit がある場合はその text と同一）。無ければ null。 */
  topicText: string | null;
  /** 主張文（キーメッセージ）の材料単位。不足時は null（ゲート3・4で扱う）。 */
  messageUnit: DeckMaterialUnit | null;
  /** 本文の材料単位列（出現順）。 */
  bodyUnits: readonly DeckMaterialUnit[];
  /** この節で逐語昇格（§6.3）が発動したか。 */
  promoted: boolean;
}

/** 組立後の資料文書（描画の入力。描画自体は D-PR-5）。 */
export interface DeckAssembledDocument {
  mode: 'A' | 'B';
  /** タイトルの逐語テキスト。無ければ null。 */
  titleText: string | null;
  /** タイトルの材料単位（モードAのみ。モードBのタイトルは単位化されない）。 */
  titleUnit: DeckMaterialUnit | null;
  /** 要点の材料単位列。 */
  summaryUnits: readonly DeckMaterialUnit[];
  /** 節（出現順）。 */
  sections: readonly DeckAssembledSection[];
  /** 次の一手の材料単位列。 */
  nextStepUnits: readonly DeckMaterialUnit[];
  /** 導入文（モードBのみ。チャット表示の冒頭用であり、資料には載せない）。 */
  introduction: string | null;
  /** 前提の明示（モードBの [前提] の各行。逐語）。 */
  assumptions: readonly string[];
  /** 確認事項（モードBの [確認事項] の各行。判定には使わない参考情報）。 */
  questions: readonly string[];
}

/**
 * 節の順序への役割の固定割り当て（裁定 §13-11 (a)）。
 * 固定骨格の役割順（課題→解決策→価値→計画→費用・効果→その他）
 * を節の出現順に割り当てる。役割は構造であり、モデルには
 * 決めさせない。
 */
export function deckSectionRoleForIndex(index: number): ProposalDeckSectionRole {
  const clamped = Math.min(Math.max(index, 0), PROPOSAL_SECTION_ROLE_ORDER.length - 1);
  return PROPOSAL_SECTION_ROLE_ORDER[clamped];
}

// ---------------------------------------------------------------------------
// 主張文判定（設計 §7.4: 文の閉じ方の検査）
// ---------------------------------------------------------------------------

/**
 * 現行 isAssertion のリストの穴のうち、本 PR で「文の閉じ」と
 * して追加で認める受動形（設計 §7.4 の確定事項）。トリアージ
 * #11 が「リストの穴」と同定した される／された等の述語形に
 * 限る。それ以外の形（リスト外の形容詞等）は、較正資料が無い
 * ため広げない。
 */
const DECK_ASSERTION_ADDITIONAL_ENDINGS =
  /(されました|されている|されていた|されます|される|された)$/;

/**
 * 資料レコード側の主張文判定（文の閉じ方の検査）。
 * 現行 isAssertion（「。」で終わる、または述語・形容詞の固定
 * リストで終わる）を土台に、受動形の閉じを追加で認める。
 * 名詞で終わる題目（例:「削減された時間」は「時間」で終わる）
 * は引き続き不合格である。この判定は文が結論を述べていること
 * を保証しない（設計 §7.6）。
 */
export function isDeckAssertionSentence(text: string): boolean {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed === '') return false;
  if (isAssertion(trimmed)) return true;
  return DECK_ASSERTION_ADDITIONAL_ENDINGS.test(trimmed);
}

/** 完結した文か（文末記号で閉じている。D-PR-3 の R2 と同じ規則）。 */
const DECK_COMPLETE_SENTENCE_END_PATTERN = /[。．！？.!?][」』）)】〕"”]*$/;

function isDeckCompleteSentenceText(text: string): boolean {
  return DECK_COMPLETE_SENTENCE_END_PATTERN.test(text.trim());
}

// ---------------------------------------------------------------------------
// 役割の適格性パターン（設計 §7.4: 文末形で判定できる範囲のみ）
// ---------------------------------------------------------------------------

const DECK_QUESTION_FORM_MARKERS: readonly string[] = ['でしょうか', 'ませんか'];
const DECK_CONDITIONAL_FORM_MARKERS: readonly string[] = ['場合は', 'であれば'];

/** 質問形か（文末の ？/? 、「でしょうか」「ませんか」、文末の「か」）。 */
function hasDeckQuestionForm(text: string): boolean {
  const trimmed = text.trim();
  if (/[？?]$/.test(trimmed)) return true;
  if (DECK_QUESTION_FORM_MARKERS.some((marker) => trimmed.includes(marker))) return true;
  return /か$/.test(trimmed);
}

/** 条件付きの文か（「場合は」「であれば」を含む、または文末の「なら」）。 */
function hasDeckConditionalForm(text: string): boolean {
  const trimmed = text.trim();
  if (DECK_CONDITIONAL_FORM_MARKERS.some((marker) => trimmed.includes(marker))) return true;
  return /なら$/.test(trimmed);
}

/** 依頼形か（文末の「ください／下さい」。末尾の「。」は除いて判定する）。 */
function hasDeckRequestForm(text: string): boolean {
  const trimmed = text.trim().replace(/。$/, '');
  return /(ください|下さい)$/.test(trimmed);
}

// ---------------------------------------------------------------------------
// 構成案メタ語彙ゲート（設計 §8）
// ---------------------------------------------------------------------------

/**
 * メタ語彙の部分一致パターン（設計 §8 の初期語彙、そのまま）。
 * 「スライド」「表紙」は、正当な本文で言及する文脈が提案資料
 * では稀であるため、設計の初期方針どおり対象に含める。語彙の
 * 追加は実測した混入形状に基づいてのみ行う（推測で広げない）。
 */
export const DECK_META_VOCABULARY_PATTERNS: readonly string[] = [
  'について説明します',
  'を説明します',
  'について記載します',
  'をまとめました',
  '各スライドの',
  '表紙',
  'スライド',
];

/** 行全体が単独ラベルである形（設計 §8 の例示そのまま）。 */
export const DECK_META_LABEL_LINES: readonly string[] = ['タイトル', '内容', '特長'];

/** メタ行の開始形（設計 §8 の例示「タイトル：」「内容：」に全角・半角コロン両形）。 */
export const DECK_META_LABEL_PREFIXES: readonly string[] = [
  'タイトル：',
  'タイトル:',
  '内容：',
  '内容:',
];

/**
 * 単位テキストが構成案メタ語彙を含むかを決定的に判定する。
 * 適用範囲は設計 §8 のとおり、要点・主張文・本文として掲載
 * される単位だけであり、題目・タイトル・次の一手には適用
 * しない（呼び出し側で範囲を決める）。表の単位は行ごとに
 * ラベル形を見て、部分一致パターンは単位全体で見る（表の
 * セルも対象、§8）。
 */
export function detectDeckMetaVocabulary(text: string): boolean {
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (DECK_META_LABEL_LINES.includes(line)) return true;
    if (DECK_META_LABEL_PREFIXES.some((prefix) => line.startsWith(prefix))) return true;
  }
  return DECK_META_VOCABULARY_PATTERNS.some((pattern) => text.includes(pattern));
}

/** メタ語彙の検出記録（件数メトリクス用。本文は保持しない）。 */
export interface DeckMetaDetection {
  /** 検出した単位の ID。 */
  unitId: string;
  /** 検出した役割（要点／主張文／本文のみ）。 */
  role: 'summary' | 'section-message' | 'section-body';
  /** 関連する節の位置（0始まり）。要点では null。 */
  sectionIndex: number | null;
}

// ---------------------------------------------------------------------------
// 5ゲートの型（設計 §7）
// ---------------------------------------------------------------------------

export type DeckGateId = 'format' | 'fidelity' | 'sufficiency' | 'semantic' | 'renderability';

/**
 * ゲート違反コード。ゲート1は D-PR-2／D-PR-3 で固定したコードを
 * そのまま使い、ゲート3・4・5の一部は現行自己チェックのコードを
 * 引き継ぐ（§7 の「5ゲートへの再編」）。本 PR で新設するのは
 * DECK_TEXT_NOT_VERBATIM（ゲート2の逐語不一致。§7.2 は検査だけを
 * 定めコード名が無かった）、DECK_FORM_NOT_ELIGIBLE（ゲート4の
 * 役割の適格性）、DECK_TABLE_NOT_RENDERABLE（ゲート5の表の描画
 * 可能性）の3つに限る。
 */
export type DeckGateViolationCode =
  | DeckFormatViolationCode
  | DeckPlanViolationCode
  | 'DECK_TEXT_NOT_VERBATIM'
  | 'NUMERIC_TOKEN_NOT_PRESERVED'
  | DeckMissingCode
  | 'SUMMARY_POINTS'
  | 'TOO_MANY_BULLETS'
  | 'PLACEHOLDER_REMAINING'
  | 'HEADLINE_NOT_ASSERTION'
  | 'DECK_FORM_NOT_ELIGIBLE'
  | 'DECK_META_VOCABULARY'
  | 'SLIDE_COUNT_OUT_OF_RANGE'
  | 'DECK_TABLE_NOT_RENDERABLE';

export interface DeckGateViolation {
  code: DeckGateViolationCode;
  /** 違反を出したゲート。 */
  gate: DeckGateId;
  /** 関連する節の位置（0始まり）。無関係なら null。 */
  sectionIndex: number | null;
  /** 関連する材料単位の ID。無関係なら null。 */
  unitId: string | null;
  /** 関連する役割。無関係なら null。 */
  role: DeckPlacedRole | null;
  /** 不足系コードの内訳件数（DeckPlacementMissingEntry の count と同じ意味）。それ以外は null。 */
  count: number | null;
  /** 数値トークン（NUMERIC_TOKEN_NOT_PRESERVED のとき）。それ以外は null。 */
  token: string | null;
  /** 数値不一致の材料側件数。それ以外は null。 */
  materialCount: number | null;
  /** 数値不一致の掲載側件数。それ以外は null。 */
  placedCount: number | null;
}

export interface DeckGateResult {
  gate: DeckGateId;
  ok: boolean;
  violations: readonly DeckGateViolation[];
}

/** ゲート判定への入力（組立側が用意する文脈）。 */
export interface DeckGateContext {
  /** 材料レコードの全単位（逐語照合の材料側）。 */
  units: readonly DeckMaterialUnit[];
  /** ゲート1の違反（組立側で正規化済み）。 */
  formatViolations: readonly DeckGateViolation[];
  /**
   * 組立側で先に検出したメタ語彙の検出記録（組立は検出単位を
   * 掲載から落としてからゲートへ渡すため、文書側の検出と
   * 合わせて報告する）。
   */
  metaDetections: readonly DeckMetaDetection[];
  /**
   * 単位化されない逐語テキストの許可集合（モードBのタイトル・
   * 題目・前提。変換結果の逐語そのもの）。モードAでは空。
   */
  extraVerbatimTexts: readonly string[];
  /**
   * 数値照合の材料側テキスト（配置に採用した材料全体。モードB
   * ではタイトル・題目の逐語も含む）。統括裁定の方式 (a)。
   */
  numericMaterialTexts: readonly string[];
}

export interface DeckGateCheckResult {
  gates: readonly DeckGateResult[];
  /** 全ゲートの違反（ゲート順に連結）。 */
  violations: readonly DeckGateViolation[];
  /** ゲート3が再計算した不足（不足コードと内訳件数）。 */
  missing: readonly DeckPlacementMissingEntry[];
  /** メタ語彙の検出記録（文脈分と文書分の合算、重複除去済み）。 */
  metaDetections: readonly DeckMetaDetection[];
}

function gateViolation(
  partial: Partial<DeckGateViolation> & Pick<DeckGateViolation, 'code' | 'gate'>,
): DeckGateViolation {
  return {
    sectionIndex: null,
    unitId: null,
    role: null,
    count: null,
    token: null,
    materialCount: null,
    placedCount: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// ゲート2〜5の実装（設計 §7.2〜§7.5）
// ---------------------------------------------------------------------------

interface DeckPlacedEntry {
  text: string;
  unitId: string | null;
  role: DeckPlacedRole;
  sectionIndex: number | null;
  /** 数値照合の掲載側に含めるか（前提・導入・確認事項は含めない）。 */
  inNumericScope: boolean;
}

/** 組立文書から掲載テキストを役割つきで列挙する（タイトル→要点→節→次の一手→前提）。 */
function collectDeckPlacedEntries(document: DeckAssembledDocument): DeckPlacedEntry[] {
  const entries: DeckPlacedEntry[] = [];
  if (document.titleText !== null) {
    entries.push({
      text: document.titleText,
      unitId: document.titleUnit?.id ?? null,
      role: 'title',
      sectionIndex: null,
      inNumericScope: true,
    });
  }
  for (const unit of document.summaryUnits) {
    entries.push({
      text: unit.text,
      unitId: unit.id,
      role: 'summary',
      sectionIndex: null,
      inNumericScope: true,
    });
  }
  document.sections.forEach((section, sectionIndex) => {
    if (section.topicText !== null) {
      entries.push({
        text: section.topicText,
        unitId: section.topicUnit?.id ?? null,
        role: 'section-topic',
        sectionIndex,
        inNumericScope: true,
      });
    }
    if (section.messageUnit !== null) {
      entries.push({
        text: section.messageUnit.text,
        unitId: section.messageUnit.id,
        role: 'section-message',
        sectionIndex,
        inNumericScope: true,
      });
    }
    for (const unit of section.bodyUnits) {
      entries.push({
        text: unit.text,
        unitId: unit.id,
        role: 'section-body',
        sectionIndex,
        inNumericScope: true,
      });
    }
  });
  for (const unit of document.nextStepUnits) {
    entries.push({
      text: unit.text,
      unitId: unit.id,
      role: 'next-steps',
      sectionIndex: null,
      inNumericScope: true,
    });
  }
  for (const assumption of document.assumptions) {
    entries.push({
      text: assumption,
      unitId: null,
      role: 'assumptions',
      sectionIndex: null,
      inNumericScope: false,
    });
  }
  return entries;
}

/** 文書内に残っているメタ語彙を検出する（組立側で落とした分は文脈から合算する）。 */
function detectDeckMetaInDocument(document: DeckAssembledDocument): DeckMetaDetection[] {
  const detections: DeckMetaDetection[] = [];
  for (const unit of document.summaryUnits) {
    if (detectDeckMetaVocabulary(unit.text)) {
      detections.push({ unitId: unit.id, role: 'summary', sectionIndex: null });
    }
  }
  document.sections.forEach((section, sectionIndex) => {
    if (section.messageUnit !== null && detectDeckMetaVocabulary(section.messageUnit.text)) {
      detections.push({ unitId: section.messageUnit.id, role: 'section-message', sectionIndex });
    }
    for (const unit of section.bodyUnits) {
      if (detectDeckMetaVocabulary(unit.text)) {
        detections.push({ unitId: unit.id, role: 'section-body', sectionIndex });
      }
    }
  });
  return detections;
}

function mergeDeckMetaDetections(
  first: readonly DeckMetaDetection[],
  second: readonly DeckMetaDetection[],
): DeckMetaDetection[] {
  const merged: DeckMetaDetection[] = [];
  const seen = new Set<string>();
  for (const detection of [...first, ...second]) {
    const key = `${detection.unitId}${detection.role}${detection.sectionIndex ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(detection);
  }
  return merged;
}

/** ゲート2: 原文忠実性（設計 §7.2）。 */
function checkDeckFidelityGate(
  document: DeckAssembledDocument,
  context: DeckGateContext,
): DeckGateViolation[] {
  const violations: DeckGateViolation[] = [];
  const entries = collectDeckPlacedEntries(document);

  // 逐語性: 単位由来のテキストは D-PR-1 の照合部品で材料単位の
  // 集合と突き合わせ、単位化されないテキスト（モードBのタイトル・
  // 題目・前提）は変換結果の逐語の許可集合と突き合わせる。
  const unitBacked = entries.filter((entry) => entry.unitId !== null);
  const verbatim = checkDeckVerbatim(
    unitBacked.map((entry) => entry.text),
    context.units,
  );
  const unmatchedQueue = [...verbatim.unmatchedTexts];
  for (const entry of unitBacked) {
    const index = unmatchedQueue.indexOf(entry.text);
    if (index === -1) continue;
    unmatchedQueue.splice(index, 1);
    violations.push(
      gateViolation({
        code: 'DECK_TEXT_NOT_VERBATIM',
        gate: 'fidelity',
        sectionIndex: entry.sectionIndex,
        unitId: entry.unitId,
        role: entry.role,
      }),
    );
  }
  const extraSet = new Set(context.extraVerbatimTexts.map((text) => normalizedRecordsText(text)));
  for (const entry of entries) {
    if (entry.unitId !== null) continue;
    if (extraSet.has(normalizedRecordsText(entry.text))) continue;
    violations.push(
      gateViolation({
        code: 'DECK_TEXT_NOT_VERBATIM',
        gate: 'fidelity',
        sectionIndex: entry.sectionIndex,
        unitId: null,
        role: entry.role,
      }),
    );
  }

  // 数値の保全: 採用した材料全体との多重集合照合（裁定の方式 (a)）。
  const numeric = checkDeckNumericPreservation(
    context.numericMaterialTexts,
    entries.filter((entry) => entry.inNumericScope).map((entry) => entry.text),
  );
  for (const discrepancy of numeric.missing) {
    violations.push(
      gateViolation({
        code: 'NUMERIC_TOKEN_NOT_PRESERVED',
        gate: 'fidelity',
        token: discrepancy.token,
        materialCount: discrepancy.materialCount,
        placedCount: discrepancy.placedCount,
      }),
    );
  }
  for (const discrepancy of numeric.unexpected) {
    violations.push(
      gateViolation({
        code: 'NUMERIC_TOKEN_NOT_PRESERVED',
        gate: 'fidelity',
        token: discrepancy.token,
        materialCount: discrepancy.materialCount,
        placedCount: discrepancy.placedCount,
      }),
    );
  }
  return violations;
}

/** ゲート3: 資料としての充足（設計 §7.3）。不足の再計算もここで行う。 */
function checkDeckSufficiencyGate(
  document: DeckAssembledDocument,
  metaDetections: readonly DeckMetaDetection[],
): { violations: DeckGateViolation[]; missing: DeckPlacementMissingEntry[] } {
  const violations: DeckGateViolation[] = [];
  const missing: DeckPlacementMissingEntry[] = [];
  const addMissing = (code: DeckMissingCode, count: number, sectionIndex: number | null = null) => {
    missing.push({ code, count });
    violations.push(gateViolation({ code, gate: 'sufficiency', count, sectionIndex }));
  };

  const detectedSummaryIds = new Set(
    metaDetections.filter((d) => d.role === 'summary').map((d) => d.unitId),
  );
  const detectedMessageIds = new Set(
    metaDetections.filter((d) => d.role === 'section-message').map((d) => d.unitId),
  );
  const detectedBodyIds = new Set(
    metaDetections.filter((d) => d.role === 'section-body').map((d) => d.unitId),
  );

  // タイトル。
  if (document.titleText === null || document.titleText.trim() === '') {
    addMissing('MISSING_TITLE', 1);
  }

  // 要点: 適格（メタ語彙で落とした分を除く）かつ重複を除いた実質
  // 件数で数える（§7.3 の同義反復の扱い）。ちょうど3点が条件。
  const eligiblePoints = document.summaryUnits.filter((unit) => !detectedSummaryIds.has(unit.id));
  const distinctPointCount = new Set(
    eligiblePoints.map((unit) => normalizedRecordsText(unit.text)),
  ).size;
  if (distinctPointCount < 3) {
    addMissing('MISSING_KEY_POINTS', 3 - distinctPointCount);
  } else if (document.summaryUnits.length > 3) {
    violations.push(
      gateViolation({ code: 'SUMMARY_POINTS', gate: 'sufficiency', role: 'summary' }),
    );
  }

  // 節: 本文のある節の実質件数と、主張文の欠落を数える。空節は
  // 件数に数えない（§7.3）。
  const eligibleBodyCounts = document.sections.map(
    (section) => section.bodyUnits.filter((unit) => !detectedBodyIds.has(unit.id)).length,
  );
  const sectionsWithBody = eligibleBodyCounts.filter((count) => count > 0).length;
  if (document.sections.length === 0) {
    addMissing('MISSING_SECTION_CONTENT', 1);
    addMissing('MISSING_ASSERTION_HEADLINES', 1);
  } else {
    // 不足件数 = 本文のある節が「節の総数（3件未満なら3件）」に
    // 届くまでに足りない数。空節（本文の無い節）も、本文のある
    // 節の不足としてこの件数に含まれる（D-PR-3 の再計算が本文の
    // 無い節を数える意味論と揃える）。
    const contentShortfall = Math.max(3, document.sections.length) - sectionsWithBody;
    if (contentShortfall > 0) {
      addMissing('MISSING_SECTION_CONTENT', contentShortfall);
    }
    const sectionsWithoutMessage = document.sections.filter(
      (section) =>
        section.messageUnit === null ||
        (section.messageUnit !== null && detectedMessageIds.has(section.messageUnit.id)),
    ).length;
    if (sectionsWithoutMessage > 0) {
      addMissing('MISSING_ASSERTION_HEADLINES', sectionsWithoutMessage);
    }
  }

  // 次の一手。
  if (document.nextStepUnits.length === 0) {
    addMissing('MISSING_NEXT_ACTION', 1);
  }

  // 1節の本文単位は4件まで（現行条件の維持）。
  document.sections.forEach((section, sectionIndex) => {
    if (eligibleBodyCounts[sectionIndex] > PROPOSAL_DESIGN_TOKENS.bullets.maxPerSection) {
      violations.push(
        gateViolation({
          code: 'TOO_MANY_BULLETS',
          gate: 'sufficiency',
          sectionIndex,
          role: 'section-body',
        }),
      );
    }
  });

  // プレースホルダー残存なし（現行条件の維持。題目も対象）。
  for (const entry of collectDeckPlacedEntries(document)) {
    if (hasPlaceholder(entry.text)) {
      violations.push(
        gateViolation({
          code: 'PLACEHOLDER_REMAINING',
          gate: 'sufficiency',
          sectionIndex: entry.sectionIndex,
          unitId: entry.unitId,
          role: entry.role,
        }),
      );
    }
  }

  return { violations, missing };
}

/** ゲート4: 意味上の適格性（設計 §7.4、§8）。決定的に判定できる範囲のみ。 */
function checkDeckSemanticGate(
  document: DeckAssembledDocument,
  metaDetections: readonly DeckMetaDetection[],
): DeckGateViolation[] {
  const violations: DeckGateViolation[] = [];
  const detectedMessageIds = new Set(
    metaDetections.filter((d) => d.role === 'section-message').map((d) => d.unitId),
  );

  document.sections.forEach((section, sectionIndex) => {
    const message = section.messageUnit;
    if (message === null) return; // 欠落はゲート3の担当。
    if (detectedMessageIds.has(message.id)) return; // メタ語彙側で数える。
    if (!isDeckAssertionSentence(message.text)) {
      violations.push(
        gateViolation({
          code: 'HEADLINE_NOT_ASSERTION',
          gate: 'semantic',
          sectionIndex,
          unitId: message.id,
          role: 'section-message',
        }),
      );
    }
    if (
      hasDeckQuestionForm(message.text) ||
      hasDeckConditionalForm(message.text) ||
      hasDeckRequestForm(message.text)
    ) {
      violations.push(
        gateViolation({
          code: 'DECK_FORM_NOT_ELIGIBLE',
          gate: 'semantic',
          sectionIndex,
          unitId: message.id,
          role: 'section-message',
        }),
      );
    }
  });

  // 次の一手は実行行為の文であること（質問形・条件付きは置かない）。
  for (const unit of document.nextStepUnits) {
    if (hasDeckQuestionForm(unit.text) || hasDeckConditionalForm(unit.text)) {
      violations.push(
        gateViolation({
          code: 'DECK_FORM_NOT_ELIGIBLE',
          gate: 'semantic',
          unitId: unit.id,
          role: 'next-steps',
        }),
      );
    }
  }

  // 構成案メタ語彙（§8）。検出単位は掲載から落とす扱いであり、
  // ここでは検出そのものを違反として数える。
  for (const detection of metaDetections) {
    violations.push(
      gateViolation({
        code: 'DECK_META_VOCABULARY',
        gate: 'semantic',
        sectionIndex: detection.sectionIndex,
        unitId: detection.unitId,
        role: detection.role,
      }),
    );
  }

  return violations;
}

/** 表単位が表として描画できる形か（見出し行＋区切り行がある）。 */
const DECK_TABLE_SEPARATOR_LINE_PATTERN = /^\|(?:\s*:?-+:?\s*\|)+$/;

function isDeckRenderableTableText(text: string): boolean {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length < 2) return false;
  return DECK_TABLE_SEPARATOR_LINE_PATTERN.test(lines[1]);
}

/** ゲート5: 描画可能性（設計 §7.5 の事前条件。生成物検証は D-PR-5）。 */
function checkDeckRenderabilityGate(document: DeckAssembledDocument): DeckGateViolation[] {
  const violations: DeckGateViolation[] = [];
  const slideCount = document.sections.length + 3;
  const { min, max } = PROPOSAL_DESIGN_TOKENS.slideCount;
  if (slideCount < min || slideCount > max) {
    violations.push(gateViolation({ code: 'SLIDE_COUNT_OUT_OF_RANGE', gate: 'renderability' }));
  }
  document.sections.forEach((section, sectionIndex) => {
    for (const unit of section.bodyUnits) {
      if (unit.kind === 'table' && !isDeckRenderableTableText(unit.text)) {
        violations.push(
          gateViolation({
            code: 'DECK_TABLE_NOT_RENDERABLE',
            gate: 'renderability',
            sectionIndex,
            unitId: unit.id,
            role: 'section-body',
          }),
        );
      }
    }
  });
  return violations;
}

/**
 * 組立文書に対して5ゲートをすべて実行し、違反を集めて返す。
 * ゲートの順序は固定（形式→忠実性→充足→適格性→描画可能性）。
 * メタ語彙の検出は、文脈（組立側で掲載から落とした分）と文書内
 * （直接渡された文書に残っている分）を合算して扱う。充足の
 * 件数は検出単位を除いた実質件数で数える。
 */
export function checkDeckGates(
  document: DeckAssembledDocument,
  context: DeckGateContext,
): DeckGateCheckResult {
  const metaDetections = mergeDeckMetaDetections(context.metaDetections, [
    ...detectDeckMetaInDocument(document),
  ]);

  const formatResult: DeckGateResult = {
    gate: 'format',
    ok: context.formatViolations.length === 0,
    violations: context.formatViolations,
  };
  const fidelityViolations = checkDeckFidelityGate(document, context);
  const sufficiency = checkDeckSufficiencyGate(document, metaDetections);
  const semanticViolations = checkDeckSemanticGate(document, metaDetections);
  const renderabilityViolations = checkDeckRenderabilityGate(document);

  const gates: DeckGateResult[] = [
    formatResult,
    { gate: 'fidelity', ok: fidelityViolations.length === 0, violations: fidelityViolations },
    {
      gate: 'sufficiency',
      ok: sufficiency.violations.length === 0,
      violations: sufficiency.violations,
    },
    { gate: 'semantic', ok: semanticViolations.length === 0, violations: semanticViolations },
    {
      gate: 'renderability',
      ok: renderabilityViolations.length === 0,
      violations: renderabilityViolations,
    },
  ];
  return {
    gates,
    violations: gates.flatMap((gate) => gate.violations),
    missing: sufficiency.missing,
    metaDetections,
  };
}

// ---------------------------------------------------------------------------
// メタ語彙の除去と逐語昇格（設計 §8、§6.3）
// ---------------------------------------------------------------------------

interface DeckSectionDraft {
  topicUnit: DeckMaterialUnit | null;
  topicText: string | null;
  messageUnit: DeckMaterialUnit | null;
  bodyUnits: DeckMaterialUnit[];
  promoted: boolean;
}

/**
 * 要点・主張文・本文に置かれた単位から、構成案メタ語彙を含む
 * 単位を掲載対象から落とす（設計 §8。裁定 §13-8 (a) の
 * fail-closed）。題目・タイトル・次の一手は §8 の適用範囲外
 * として落とさない。落とした単位は別の文で埋めない（不足は
 * ゲート3で不足として扱う）。
 */
function filterDeckMetaUnits(input: {
  summaryUnits: readonly DeckMaterialUnit[];
  sections: DeckSectionDraft[];
}): { summaryUnits: DeckMaterialUnit[]; detections: DeckMetaDetection[] } {
  const detections: DeckMetaDetection[] = [];
  const summaryUnits: DeckMaterialUnit[] = [];
  for (const unit of input.summaryUnits) {
    if (detectDeckMetaVocabulary(unit.text)) {
      detections.push({ unitId: unit.id, role: 'summary', sectionIndex: null });
    } else {
      summaryUnits.push(unit);
    }
  }
  input.sections.forEach((section, sectionIndex) => {
    if (section.messageUnit !== null && detectDeckMetaVocabulary(section.messageUnit.text)) {
      detections.push({
        unitId: section.messageUnit.id,
        role: 'section-message',
        sectionIndex,
      });
      section.messageUnit = null;
    }
    const keptBody: DeckMaterialUnit[] = [];
    for (const unit of section.bodyUnits) {
      if (detectDeckMetaVocabulary(unit.text)) {
        detections.push({ unitId: unit.id, role: 'section-body', sectionIndex });
      } else {
        keptBody.push(unit);
      }
    }
    section.bodyUnits = keptBody;
  });
  return { summaryUnits, detections };
}

/**
 * 逐語昇格（設計 §6.3）。節の主張文候補が主張文判定に不合格の
 * 場合にのみ発動を検討し、本文の最初の単位が完結した文
 * （kind が sentence で文末記号で閉じている）で主張文判定に
 * 合格すれば、その単位を主張文へ昇格させ、元の候補文を題目へ
 * 送る。発動したら true。
 *
 * 発動しない条件:
 * - 主張文候補が無い（不足は不足として扱う。§6.3 は不合格の
 *   候補がある場合の救済である）。
 * - 候補が既に主張文判定に合格している。
 * - 題目が既に占有されている（裁定 §13-7 (a)。材料を捨てない
 *   ための確定事項）。
 * - 本文が空、または最初の単位が完結文でない・主張文判定に
 *   不合格（第2単位以降は探索しない。1節につき1回まで）。
 * 昇格は決定的処理であり、文の改変は一切行わない（語尾・句読点
 * の付加もしない）。
 */
function applyDeckPromotion(section: DeckSectionDraft): boolean {
  const candidate = section.messageUnit;
  if (candidate === null) return false;
  if (isDeckAssertionSentence(candidate.text)) return false;
  if (section.topicText !== null) return false;
  const first = section.bodyUnits[0];
  if (first === undefined) return false;
  if (first.kind !== 'sentence') return false;
  if (!isDeckCompleteSentenceText(first.text)) return false;
  if (!isDeckAssertionSentence(first.text)) return false;
  section.topicUnit = candidate;
  section.topicText = candidate.text;
  section.messageUnit = first;
  section.bodyUnits = section.bodyUnits.slice(1);
  section.promoted = true;
  return true;
}

// ---------------------------------------------------------------------------
// 組立フロー（設計 §2.1）
// ---------------------------------------------------------------------------

export interface DeckAssemblyResult {
  /** 全ゲート合格なら true。 */
  ok: boolean;
  mode: 'A' | 'B';
  /** 組立文書。配置計画のパース失敗時（モードA）は null。 */
  document: DeckAssembledDocument | null;
  /** 材料レコードの全単位。 */
  units: readonly DeckMaterialUnit[];
  /** 5ゲートの結果（ゲート順）。パース失敗時はゲート1のみ。 */
  gates: readonly DeckGateResult[];
  /** 全ゲートの違反（ゲート順に連結）。 */
  violations: readonly DeckGateViolation[];
  /** ゲート3が再計算した不足。パース失敗時は空（形式の失敗は不足とは扱わない）。 */
  missing: readonly DeckPlacementMissingEntry[];
  /** 逐語昇格が発動した節の数。 */
  promotionCount: number;
  /** 構成案メタ語彙の検出件数。 */
  metaDetectionCount: number;
  /** 配置の解釈形式（モードA: json／text／deterministic、モードB: tags）。パース失敗時は null。 */
  placementFormatKind: 'json' | 'text' | 'deterministic' | 'tags' | null;
  /** 材料に無い ID への参照を無効化した件数（モードAのモデル配置のみ）。 */
  unknownIdCount: number;
  /** 重複配置として除去した参照の件数（モードAのモデル配置のみ）。 */
  duplicateRemovedCount: number;
}

/** D-PR-3 の配置計画違反をゲート1の違反形へ正規化する。 */
function normalizeDeckPlanViolation(violation: DeckPlanViolation): DeckGateViolation {
  const role: DeckPlacedRole | null =
    violation.role === 'section-headline'
      ? 'section-message'
      : violation.role === 'section-topic'
        ? 'section-topic'
        : violation.role === 'section-body'
          ? 'section-body'
          : violation.role;
  return gateViolation({
    code: violation.code,
    gate: 'format',
    sectionIndex: violation.sectionIndex,
    unitId: violation.id,
    role,
  });
}

/** D-PR-2 のタグ形式違反をゲート1の違反形へ正規化する（節番号は1始まり→0始まり）。 */
function normalizeDeckFormatViolation(violation: DeckFormatViolation): DeckGateViolation {
  return gateViolation({
    code: violation.code,
    gate: 'format',
    sectionIndex: violation.section === null ? null : violation.section - 1,
  });
}

/** 節の下書き列を組立文書の節へ変換する（役割は節の順序で割り当てる）。 */
function buildAssembledSections(drafts: DeckSectionDraft[]): DeckAssembledSection[] {
  return drafts.map((draft, index) => ({
    role: deckSectionRoleForIndex(index),
    topicUnit: draft.topicUnit,
    topicText: draft.topicText,
    messageUnit: draft.messageUnit,
    bodyUnits: draft.bodyUnits,
    promoted: draft.promoted,
  }));
}

/**
 * モードAの組立: ユーザー素材を材料レコードへ分割し（D-PR-1）、
 * 配置（モデル配置計画の出力、またはモデルなし決定的配置）を
 * 検証し（D-PR-3）、メタ語彙の除去→逐語昇格→5ゲートを通す。
 *
 * 配置計画のパースに失敗した場合は文書を作らず、ゲート1の
 * 違反だけを返す（形式の失敗は不足とは扱わない。設計 §9 の
 * 再試行の切り分けと同じ）。
 */
export function assembleDeckFromMaterial(input: {
  materialText: string;
  /** モデルの配置計画出力。null／省略時は決定的配置を使う。 */
  placementOutputText?: string | null;
}): DeckAssemblyResult {
  const units = buildDeckMaterialUnits(input.materialText);
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const ref = (id: string | null): DeckMaterialUnit | null =>
    id === null ? null : (unitById.get(id) ?? null);
  const refs = (ids: readonly string[]): DeckMaterialUnit[] =>
    ids.map((id) => unitById.get(id)).filter((unit) => unit !== undefined);

  let plan: DeckPlacementPlan;
  let formatViolations: DeckGateViolation[] = [];
  let formatKind: DeckAssemblyResult['placementFormatKind'];
  let unknownIdCount = 0;
  let duplicateRemovedCount = 0;

  if (input.placementOutputText !== null && input.placementOutputText !== undefined) {
    const placed = buildDeckPlacement(input.placementOutputText, units);
    formatKind = placed.formatKind;
    formatViolations = placed.violations.map(normalizeDeckPlanViolation);
    unknownIdCount = placed.unknownIdCount;
    duplicateRemovedCount = placed.duplicateRemovedCount;
    if (placed.plan === null) {
      const gate: DeckGateResult = {
        gate: 'format',
        ok: false,
        violations: formatViolations,
      };
      return {
        ok: false,
        mode: 'A',
        document: null,
        units,
        gates: [gate],
        violations: formatViolations,
        missing: [],
        promotionCount: 0,
        metaDetectionCount: 0,
        placementFormatKind: formatKind,
        unknownIdCount,
        duplicateRemovedCount,
      };
    }
    plan = placed.plan;
  } else {
    const deterministic = buildDeterministicDeckPlacement(units);
    plan = deterministic.plan;
    formatKind = 'deterministic';
  }

  // 配置に採用された単位（数値照合の材料側。メタ語彙で落とした
  // 単位は採用から外す）。
  const adoptedIds = new Set<string>();
  if (plan.titleRef !== null) adoptedIds.add(plan.titleRef);
  for (const id of plan.summaryRefs) adoptedIds.add(id);
  for (const section of plan.sections) {
    if (section.topicRef !== null) adoptedIds.add(section.topicRef);
    if (section.headlineRef !== null) adoptedIds.add(section.headlineRef);
    for (const id of section.bodyRefs) adoptedIds.add(id);
  }
  for (const id of plan.nextStepRefs) adoptedIds.add(id);

  const sectionDrafts: DeckSectionDraft[] = plan.sections.map((section) => ({
    topicUnit: ref(section.topicRef),
    topicText: ref(section.topicRef)?.text ?? null,
    messageUnit: ref(section.headlineRef),
    bodyUnits: refs(section.bodyRefs),
    promoted: false,
  }));

  const filtered = filterDeckMetaUnits({
    summaryUnits: refs(plan.summaryRefs),
    sections: sectionDrafts,
  });
  const droppedIds = new Set(filtered.detections.map((detection) => detection.unitId));
  for (const id of droppedIds) adoptedIds.delete(id);

  let promotionCount = 0;
  for (const draft of sectionDrafts) {
    if (applyDeckPromotion(draft)) promotionCount += 1;
  }

  const document: DeckAssembledDocument = {
    mode: 'A',
    titleText: ref(plan.titleRef)?.text ?? null,
    titleUnit: ref(plan.titleRef),
    summaryUnits: filtered.summaryUnits,
    sections: buildAssembledSections(sectionDrafts),
    nextStepUnits: refs(plan.nextStepRefs),
    introduction: null,
    assumptions: [],
    questions: [],
  };

  const checked = checkDeckGates(document, {
    units,
    formatViolations,
    metaDetections: filtered.detections,
    extraVerbatimTexts: [],
    numericMaterialTexts: units
      .filter((unit) => adoptedIds.has(unit.id))
      .map((unit) => unit.text),
  });

  return {
    ok: checked.gates.every((gate) => gate.ok),
    mode: 'A',
    document,
    units,
    gates: checked.gates,
    violations: checked.violations,
    missing: checked.missing,
    promotionCount,
    metaDetectionCount: checked.metaDetections.length,
    placementFormatKind: formatKind,
    unknownIdCount,
    duplicateRemovedCount,
  };
}

/**
 * モードBの組立: タグ形式の起草をパースし（D-PR-2）、材料
 * レコードへ変換し、メタ語彙の除去→逐語昇格→5ゲートを通す。
 * 配置計画はタグ構造そのものであるため、追加の ID 選択は
 * 行わない（設計 §4.2）。形式違反がある起草でも変換と組立は
 * 行い、ゲート1で不合格として返す。
 */
export function assembleDeckFromDraft(input: { draftText: string }): DeckAssemblyResult {
  const parsed = parseDeckDraft(input.draftText);
  const conversion = convertDeckDraftToMaterial(parsed);
  const units = conversion.units;
  const formatViolations = parsed.violations.map(normalizeDeckFormatViolation);

  const sectionDrafts: DeckSectionDraft[] = conversion.sections.map((section) => ({
    topicUnit: null,
    topicText: section.topicCandidate,
    messageUnit: section.assertionUnit,
    bodyUnits: [...section.bodyUnits],
    promoted: false,
  }));

  const filtered = filterDeckMetaUnits({
    summaryUnits: [...conversion.summaryUnits],
    sections: sectionDrafts,
  });
  const droppedIds = new Set(filtered.detections.map((detection) => detection.unitId));

  let promotionCount = 0;
  for (const draft of sectionDrafts) {
    if (applyDeckPromotion(draft)) promotionCount += 1;
  }

  const document: DeckAssembledDocument = {
    mode: 'B',
    titleText: conversion.title,
    titleUnit: null,
    summaryUnits: filtered.summaryUnits,
    sections: buildAssembledSections(sectionDrafts),
    nextStepUnits: [...conversion.nextStepUnits],
    introduction: conversion.introduction,
    assumptions: conversion.assumptions,
    questions: conversion.questions,
  };

  // 単位化されない逐語（タイトル・題目・前提）は、変換結果そのもの
  // を逐語の許可集合とし、数値照合の材料側にはタイトル・題目を
  // 含める（前提は資料の数値範囲に含めない）。
  const extraVerbatimTexts: string[] = [];
  if (conversion.title !== null) extraVerbatimTexts.push(conversion.title);
  for (const section of conversion.sections) {
    if (section.topicCandidate !== null) extraVerbatimTexts.push(section.topicCandidate);
  }
  extraVerbatimTexts.push(...conversion.assumptions);

  const numericMaterialTexts: string[] = [];
  for (const unit of units) {
    if (!droppedIds.has(unit.id)) numericMaterialTexts.push(unit.text);
  }
  if (conversion.title !== null) numericMaterialTexts.push(conversion.title);
  for (const section of conversion.sections) {
    if (section.topicCandidate !== null) numericMaterialTexts.push(section.topicCandidate);
  }

  const checked = checkDeckGates(document, {
    units,
    formatViolations,
    metaDetections: filtered.detections,
    extraVerbatimTexts,
    numericMaterialTexts,
  });

  return {
    ok: checked.gates.every((gate) => gate.ok),
    mode: 'B',
    document,
    units,
    gates: checked.gates,
    violations: checked.violations,
    missing: checked.missing,
    promotionCount,
    metaDetectionCount: checked.metaDetections.length,
    placementFormatKind: 'tags',
    unknownIdCount: 0,
    duplicateRemovedCount: 0,
  };
}
