import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { summarizeProposalDeckAnswerShape } from './proposalDeckFailureShapeV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第5回本番失敗（2026-11-14、main bebf30f5）の再構成フィクスチャ。
// 切り分け報告書 ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE5_2026-11-14.md の
// §4（再現バリアント V1〜V4 系10種）と §10（W14〜W19）を恒常テストとして
// 取り込んだもの。文面は UI 観察＋failureShape に基づく再構成で、本番回答の
// 原文そのものではない。
// 形の特徴: 冒頭に「提案の要点（Bottom line）」ブロック（本文1文のみ、
// 製品名『SmartLedger』を含む）、節見出し末尾に（Assumptions: …）等の
// 注記が付き、料金表（3プラン）と末尾の絞り込み質問2件が続く。
// 失敗の引き金は、見出しの受理判定（40字以内・コロンなし）が注記を含む
// 見出し文全体に対して行われていたこと（節1は57字＋コロン、節3はコロンで
// 拒否され、連番の凍結と markdown 見出しのドロップを招いた）。
// fix-5 の FIX5-1 は、受理判定を注記を除いた見出し本体に対して行う。

const POINTS_LEAD = '本資料はクラウド会計サービス「SmartLedger」の導入提案です。';

const SEC1_LEAD = 'SmartLedgerは中小企業向けのクラウド会計サービスです。';
const SEC1_BULLETS = `- 銀行口座やクレジットカードと連携し、取引を自動で取り込みます
- AIが仕訳を自動で提案し、経理作業の手間を減らします
- 請求書の発行から入金確認までを一元管理できます
- 決算書類の作成を支援し、申告準備を効率化します`;
const SEC1_BULLET_TEXTS = [
  '銀行口座やクレジットカードと連携し、取引を自動で取り込みます',
  'AIが仕訳を自動で提案し、経理作業の手間を減らします',
  '請求書の発行から入金確認までを一元管理できます',
];

// 節1の見出しは注記込みで57字あり、コロンも含む。本体は「サービス概要」の6字。
const SEC1_HEADING_ANNOTATED =
  '1. サービス概要（Assumptions: 製品名は仮の「SmartLedger」、機能は一般的なクラウド会計に準拠）';
const SEC1_ANNOTATED = `${SEC1_HEADING_ANNOTATED}\n${SEC1_LEAD}\n${SEC1_BULLETS}`;

// V1a 用: 節1だけ注記を外して短縮した形。
const SEC1_PLAIN = `1. サービス概要\n${SEC1_LEAD}\n${SEC1_BULLETS}`;

// V1b 用: 注記からコロンを除き節1を短縮した形（見出し全体でも受理条件を満たす）。
const SEC1_NO_COLON = `1. サービス概要（Assumptions 製品名は仮の「SmartLedger」）\n${SEC1_LEAD}\n${SEC1_BULLETS}`;

const SEC2_VALUE = `2. 主なメリット（3–5ポイント）
- 記帳作業の時間を月あたり約10時間削減できます
- 仕訳の自動化で入力ミスを減らせます
- リアルタイムに経営数値を把握できます
- 税理士とのデータ共有がスムーズになります`;

const PRICE_TABLE = `| プラン | 月額料金 | 主な機能 |
| --- | --- | --- |
| スターター | 980円 | 基本的な記帳・仕訳 |
| スタンダード | 2,980円 | 請求書・給与計算 |
| プレミアム | 5,980円 | 部門別管理・API連携 |`;

// 節3の見出しは注記込みで30字（上限内）だがコロンを含む。本体は「料金プラン例」。
const SEC3_COST_ANNOTATED = `3. 料金プラン例（Assumptions: 月額料金はサンプル）\n${PRICE_TABLE}`;
const SEC3_COST_NO_COLON = `3. 料金プラン例（Assumptions 月額料金はサンプル）\n${PRICE_TABLE}`;

const SEC4_CASES = `4. 導入事例（サンプル）
- 従業員20名の製造業で、月次の締め作業が3日から1日に短縮されました
- 小売業では請求書発行の手間が大幅に減りました
- 飲食業では日々の売上管理が楽になりました`;

const STEP_BULLETS = [
  '無料トライアル（14日間）をお申し込みください',
  '導入相談の日時をご指定ください',
  '現在の会計ソフトからのデータ移行をご検討ください',
];
const SEC5_CLOSING = `5. 次のステップ\n${STEP_BULLETS.map((step) => `- ${step}`).join('\n')}`;

const QUESTION_TEXTS = ['現在お使いの会計ソフトは何ですか？', '導入時期のご希望はありますか？'];
const QUESTIONS_BLOCK = `**ご質問**\n1. ${QUESTION_TEXTS[0]}\n- ${QUESTION_TEXTS[1]}`;

// W14（報告書の V1）: 要点=太字ラベル、節=番号付き（注記付き、観察どおり）。
// 修正前は節1の受理拒否で連番が凍結し、全節が要約節に吸収されて null だった。
const W14_NUMBERED_ANNOTATED = [
  `**提案の要点（Bottom line）**\n${POINTS_LEAD}`,
  SEC1_ANNOTATED,
  SEC2_VALUE,
  SEC3_COST_ANNOTATED,
  SEC4_CASES,
  SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// W15（報告書の V1a）: 節1のみ注記なし。修正前は節3のコロン拒否で連番が
// 3で止まり、締め節が消えて null だった。
const W15_FIRST_PLAIN = [
  `**提案の要点（Bottom line）**\n${POINTS_LEAD}`,
  SEC1_PLAIN,
  SEC2_VALUE,
  SEC3_COST_ANNOTATED,
  SEC4_CASES,
  SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// W19（報告書の V1b）: 注記からコロンを除いた判別対照。修正前から変換される。
const W19_NO_COLON_ANNOTATIONS = [
  `**提案の要点（Bottom line）**\n${POINTS_LEAD}`,
  SEC1_NO_COLON,
  SEC2_VALUE,
  SEC3_COST_NO_COLON,
  SEC4_CASES,
  SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// V3: 要点=markdown見出し、節=番号付き。修正前は V1 と同型に崩壊して null。
const V3_MARKDOWN_POINTS = [
  '# 中小企業向けクラウド会計サービスのご提案',
  `## 提案の要点（Bottom line）\n${POINTS_LEAD}`,
  SEC1_ANNOTATED,
  SEC2_VALUE,
  SEC3_COST_ANNOTATED,
  SEC4_CASES,
  SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// V4: 要点=素のテキスト行、節=番号付き。修正前は要点行が導入に落ち、
// 節は末尾質問の微小節だけになって null だった。
const V4_PLAIN_POINTS = [
  `提案の要点（Bottom line）\n${POINTS_LEAD}`,
  SEC1_ANNOTATED,
  SEC2_VALUE,
  SEC3_COST_ANNOTATED,
  SEC4_CASES,
  SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// markdown 節の部品（V2 系）。
const MD_SEC1_HEADING =
  '## 1. サービス概要（Assumptions: 製品名は仮の「SmartLedger」、機能は一般的なクラウド会計に準拠）';
const MD_SEC2_VALUE = `## 2. 主なメリット（3–5ポイント）
主なメリットは次の3点です。
1. 記帳作業の時間を月あたり約10時間削減できます
2. 仕訳の自動化で入力ミスを減らせます
3. リアルタイムに経営数値を把握できます
- 税理士とのデータ共有がスムーズになります`;
const MD_SEC3_COST = `## 3. 料金プラン例（Assumptions: 月額料金はサンプル）\n${PRICE_TABLE}`;
const MD_SEC4_CASES = `## 4. 導入事例（サンプル）
- 従業員20名の製造業で、月次の締め作業が3日から1日に短縮されました
- 小売業では請求書発行の手間が大幅に減りました
- 飲食業では日々の売上管理が楽になりました`;
const MD_SEC5_CLOSING = `## 5. 次のステップ\n${STEP_BULLETS.map((step) => `- ${step}`).join('\n')}`;

// W18（報告書の V2）: 要点=太字ラベル、節=「## N. …」、節内に0列目の
// 番号リスト。failureShape の全件数が本番実測と一致する系統。
// 修正前も変換はされるが、節1・節3の見出しが捨てられ、メリットの番号項目が
// 微小節に化けて料金表を取り込む汚染があった。FIX5-1 で節1・節3が節化し、
// 料金表は cost 節に収まる。メリット番号項目の微小節化そのものは FIX5-2
// （結論文の番号行を見出しにしない）の担当だが、fix-5 では採用を見送った
// （FIX5-2 を入れると fix-4 で固定した W12 が null から変換可能に反転し、
// さらに markdown 文書では連番が進まないため末尾の番号付き質問行が
// 見出し化して前提・未確認事項から質問が消える副作用が実測されたため。
// 採否は統括の判断待ち）。そのため W18 のアサーションは FIX5-1 の範囲
// （変換できること、料金表が cost 節に属すること）に留める。
const W18_MARKDOWN_SECTIONS = [
  `**提案の要点（Bottom line）**\n${POINTS_LEAD}`,
  `${MD_SEC1_HEADING}\n${SEC1_LEAD}\n- 銀行口座やクレジットカードと連携し、取引を自動で取り込みます\n- AIが仕訳を自動で提案し、経理作業の手間を減らします`,
  MD_SEC2_VALUE,
  MD_SEC3_COST,
  MD_SEC4_CASES,
  MD_SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// W16（報告書の V2a）: V2 のサービス概要を散文1文のみにした形。要点1文と
// 合わせても要約の材料が2文しかなく、FIX5-1 後も材料不足として null が
// 現行仕様であることを固定する（防止は指示側の担当。報告書 §8 FIX5-4）。
const W16_OVERVIEW_ONE_SENTENCE = [
  `**提案の要点（Bottom line）**\n${POINTS_LEAD}`,
  `${MD_SEC1_HEADING}\n${SEC1_LEAD}`,
  MD_SEC2_VALUE,
  MD_SEC3_COST,
  MD_SEC4_CASES,
  MD_SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// V2b: 概要を2文にし、2文目が68字（80字上限内）の境界形。変換される。
const OVERVIEW_SECOND_68 =
  '銀行口座やクレジットカードの明細を自動で取り込み、AIが仕訳を提案するため、手入力の作業が大きく減り、月次の集計作業も自動で行われます。';
const V2B_OVERVIEW_TWO_SENTENCES = [
  `**提案の要点（Bottom line）**\n${POINTS_LEAD}`,
  `${MD_SEC1_HEADING}\n${SEC1_LEAD}${OVERVIEW_SECOND_68}`,
  MD_SEC2_VALUE,
  MD_SEC3_COST,
  MD_SEC4_CASES,
  MD_SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// V2c: 概要を短い2文にした形（V2a の判別対照）。変換される。
const OVERVIEW_SECOND_SHORT = '請求書の発行も自動化されます。';
const V2C_OVERVIEW_SHORT_TWO = [
  `**提案の要点（Bottom line）**\n${POINTS_LEAD}`,
  `${MD_SEC1_HEADING}\n${SEC1_LEAD}${OVERVIEW_SECOND_SHORT}`,
  MD_SEC2_VALUE,
  MD_SEC3_COST,
  MD_SEC4_CASES,
  MD_SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// W17（報告書の V2d）: 概要の2文目が94字あり、要点補給の80字上限で
// 数えられないため2点止まりになる。FIX5-1 後も null が現行仕様。
const OVERVIEW_SECOND_94 =
  '銀行口座やクレジットカードの明細を自動で取り込み、AIが仕訳を提案するため、手入力の作業が大きく減り、請求書の発行から入金確認、決算書類の作成支援までを常に一つの画面で行うことができます。';
const W17_OVERVIEW_LONG_SECOND = [
  `**提案の要点（Bottom line）**\n${POINTS_LEAD}`,
  `${MD_SEC1_HEADING}\n${SEC1_LEAD}${OVERVIEW_SECOND_94}`,
  MD_SEC2_VALUE,
  MD_SEC3_COST,
  MD_SEC4_CASES,
  MD_SEC5_CLOSING,
  QUESTIONS_BLOCK,
].join('\n\n');

// 本体が手順文で注記だけ短い番号行の列挙は、受理されても中身のある節が
// 無く資料化されない（FIX5-1 の誤爆防止）。
const ANNOTATED_PROCEDURE = `作業手順は次のとおりです。
1. 管理画面にログインします（管理者権限が必要です）
2. 設定メニューから連携先を選びます（画面左側のメニュー）
3. 接続ボタンを押して同期を開始します（数分かかります）
4. 同期が完了したら結果を確認します（メールでも通知されます）`;

// 番号付き手順リストだけの回答は資料化されない。
const PROCEDURE_ONLY = `プリンターのインクを交換する手順を説明します。
1. 電源を入れたままカバーを開けます
2. 古いカートリッジを取り外します
3. 新しいカートリッジを差し込みます
4. カバーを閉じてテスト印刷をします`;

function expectConvertible(markdown: string) {
  const input = parseProposalDeckSkeleton(markdown);
  expect(input).not.toBeNull();
  const deck = buildProposalDeck(input!);
  const selfCheck = checkProposalDeck(deck);
  expect(selfCheck.violations).toEqual([]);
  expect(selfCheck.ok).toBe(true);
  const outcome = buildProposalDeckChatArtifact(markdown);
  expect(outcome.status).toBe('created');
  return { input: input!, deck };
}

describe('parseProposalDeckSkeleton free-form fallback v5 (2026-11-14 fifth production failure)', () => {
  it('W14: reproduces the production failure shape of the fifth failure', () => {
    const shape = summarizeProposalDeckAnswerShape(W14_NUMBERED_ANNOTATED);
    expect(shape.markdownHeadingCount).toBe(0);
    expect(shape.numberedHeadingCount).toBe(6);
    expect(shape.bracketStandaloneLineCount).toBe(0);
    expect(shape.boldLabelLineCount).toBe(2);
    expect(shape.bulletLineCount).toBe(15);
    expect(shape.tableRowCount).toBe(5);
  });

  it('W14: converts annotated numbered headings judged on their stripped core (FIX5-1)', () => {
    const { input } = expectConvertible(W14_NUMBERED_ANNOTATED);
    // 導入が無いため、タイトルは要約節の見出しからのフォールバック。
    expect(input.title).toBe('提案の要点のご提案');
    // 要点は冒頭ブロックの1文＋サービス概要節の箇条書きで3点に届く。
    expect(input.summary.points).toEqual([POINTS_LEAD, ...SEC1_BULLET_TEXTS.slice(0, 2)]);
    // 料金節は cost、事例節は役割セクションとして残る。
    expect(input.sections.map((section) => section.role)).toEqual(['value', 'cost', 'other']);
    const cost = input.sections.find((section) => section.role === 'cost');
    expect(cost!.bullets.map((bullet) => bullet.lead)).toEqual([
      'スターター',
      'スタンダード',
      'プレミアム',
    ]);
    // 締めの次ステップはステップの箇条書きであり、末尾質問は前提へ回る。
    expect(input.closing.nextSteps).toEqual(STEP_BULLETS);
    expect(input.assumptions).toEqual(QUESTION_TEXTS);
  });

  it('W15: converts when only the first heading is plain and a later one carries a colon annotation', () => {
    const { input } = expectConvertible(W15_FIRST_PLAIN);
    // 連番が節3で止まらず、料金節と締めが正しく組まれる。
    expect(input.sections.map((section) => section.role)).toEqual(['value', 'cost', 'other']);
    expect(input.closing.nextSteps).toEqual(STEP_BULLETS);
    expect(input.assumptions).toEqual(QUESTION_TEXTS);
  });

  it('W19: converts colon-free annotations (discriminating control, already convertible before fix-5)', () => {
    const { input } = expectConvertible(W19_NO_COLON_ANNOTATIONS);
    expect(input.sections.map((section) => section.role)).toEqual(['value', 'cost', 'other']);
    expect(input.closing.nextSteps).toEqual(STEP_BULLETS);
  });

  it('V3: converts when the points block is a markdown heading and sections are numbered', () => {
    const { input } = expectConvertible(V3_MARKDOWN_POINTS);
    expect(input.title).toBe('中小企業向けクラウド会計サービスのご提案');
    expect(input.sections.map((section) => section.role)).toEqual(['value', 'cost', 'other']);
    expect(input.closing.nextSteps).toEqual(STEP_BULLETS);
    expect(input.assumptions).toEqual(QUESTION_TEXTS);
  });

  it('V4: converts when the points block is a plain text line and sections are numbered', () => {
    const { input } = expectConvertible(V4_PLAIN_POINTS);
    // 要約はサービス概要節の箇条書きが担う。
    expect(input.summary.points).toEqual(SEC1_BULLET_TEXTS);
    expect(input.sections.map((section) => section.role)).toEqual(['value', 'cost', 'other']);
    expect(input.closing.nextSteps).toEqual(STEP_BULLETS);
    expect(input.assumptions).toEqual(QUESTION_TEXTS);
  });

  it('W18: converts markdown sections and keeps the price table inside the cost section (FIX5-1)', () => {
    const { input } = expectConvertible(W18_MARKDOWN_SECTIONS);
    const cost = input.sections.find((section) => section.role === 'cost');
    expect(cost).toBeDefined();
    expect(cost!.bullets.map((bullet) => bullet.lead)).toEqual([
      'スターター',
      'スタンダード',
      'プレミアム',
    ]);
    expect(input.closing.nextSteps).toEqual(STEP_BULLETS);
    expect(input.assumptions).toEqual(QUESTION_TEXTS);
  });

  it('W16: stays null when the summary material is only two short sentences (specification)', () => {
    expect(parseProposalDeckSkeleton(W16_OVERVIEW_ONE_SENTENCE)).toBeNull();
  });

  it('V2b: converts when the overview has two sentences and the second fits the 80-char cap', () => {
    const { input } = expectConvertible(V2B_OVERVIEW_TWO_SENTENCES);
    expect(input.summary.points).toEqual([POINTS_LEAD, SEC1_LEAD, OVERVIEW_SECOND_68]);
  });

  it('V2c: converts when the overview has two short sentences (discriminating control for W16)', () => {
    const { input } = expectConvertible(V2C_OVERVIEW_SHORT_TWO);
    expect(input.summary.points).toEqual([POINTS_LEAD, SEC1_LEAD, OVERVIEW_SECOND_SHORT]);
  });

  it('W17: stays null when the overview second sentence exceeds the 80-char cap (specification)', () => {
    expect(parseProposalDeckSkeleton(W17_OVERVIEW_LONG_SECOND)).toBeNull();
  });

  it('returns null for a numbered procedure list whose items only carry short annotations', () => {
    expect(parseProposalDeckSkeleton(ANNOTATED_PROCEDURE)).toBeNull();
  });

  it('returns null for a numbered procedure list only', () => {
    expect(parseProposalDeckSkeleton(PROCEDURE_ONLY)).toBeNull();
  });

  it('is deterministic for the W14 shape', () => {
    expect(parseProposalDeckSkeleton(W14_NUMBERED_ANNOTATED)).toEqual(
      parseProposalDeckSkeleton(W14_NUMBERED_ANNOTATED),
    );
  });
});
