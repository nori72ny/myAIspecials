import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { summarizeProposalDeckAnswerShape } from './proposalDeckFailureShapeV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第7回本番失敗（2026-11-14、main 2ef75481）の再構成フィクスチャ。
// 切り分け報告書 ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE7_2026-11-14.md の
// §4（再現フィクスチャ G と変形 V1a／V3／G-noclose）と §9（W25〜W28）を
// 恒常テストとして取り込んだもの。文面は UI 観察＋failureShape に基づく
// 再構成で、本番回答の原文そのものではない。導入文は totalChars を本番の
// 1112 に合わせ込むため長文にしてあり、他の10項目は文面調整なしに構造
// だけで一致する。
// 形の特徴: 表題行（【提案資料（ドラフト）】＋主題文）＋導入文、太字ラベル
// 「要点」（リード1文＋箇条書き3点）、markdown 見出し5節（## 1.〜## 5.）、
// 料金表と導入ステップ表が各1つ、末尾は見出しを持たない締めの散文3行
// （確認質問・調整可否の文・依頼の文）で、最後の計画節のリード行に
// 吸収される。受理・分類・要約の段はすべて通過し、残った壁は1つ。
// - 壁7-A: 締め節そのものが存在せず、nextSteps の受け皿（計画節の箇条
//   書き流用／締め節の散文切り出し／計画節の散文切り出し）が3段とも
//   届かない。FIX6-1 の受け皿は「締め節の実在」を前提としており、締め
//   節自体が無い形はその外側に残った。あわせて締め散文が計画節の結論
//   文に混入する副次効果（壁7-B）もある。
// fix-7 は FIX7-1（締め節が無い場合に限り、最後の節のリード行の末尾に
// ある質問形・依頼形の散文ブロックを切り出して締め節として扱う）、
// FIX7-2（計画節の箇条書き受け皿の条件から ask が空であることを外す）、
// FIX7-3（受け皿の参照先を、箇条書きを持つ最初の plan 節へ変更する）で
// 対処する。締めの痕跡が皆無でも受け皿を開く案（CAND-E）は不採用で、
// W28 が null のままであることを仕様として固定する。

const TITLE_LINE = '【提案資料（ドラフト）】中小企業向けクラウド会計サービスの販促提案資料';
// 導入文は totalChars を本番実測（1112）に一致させるための長文。
const INTRO =
  '本資料は、中小企業向けクラウド会計サービスの特長と料金プラン、導入の進め方をまとめた販促提案資料であり、経理担当者の負担軽減と月次決算の早期化に関心のある経営者や経理責任者の方々に、サービスの全体像を短時間で把握していただくことを目的として作成したものです。あわせて、導入に必要な期間や費用の考え方、運用開始後のサポート体制についても分かりやすく整理し、初めてクラウド会計を検討する方でも安心して読み進められる内容を目指しています。日々の記帳から決算まで、経理業務全体の流れに沿って、丁寧にご説明します。';
const HEAD_BLOCK = `${TITLE_LINE}\n${INTRO}`;

const SUMMARY_POINTS = [
  '経理業務の時間を30%削減できます',
  '月額3,300円から始められる料金プランです',
  '導入は最短1週間で完了します',
];
const SUMMARY = `**要点**
本サービスは経理業務の効率化と月次決算の早期化を支援します。
${SUMMARY_POINTS.map((point) => `- ${point}`).join('\n')}`;

const SEC1_CHALLENGE = `## 1. 対象顧客と課題
経理担当者が少なく、月末に作業が集中していることが課題です。
- 経理担当者が1名のみで、月末に請求処理が集中しています
- 紙の請求書や表計算ソフトでの管理が中心になっています`;

const SEC2_VALUE = `## 2. 提案する価値
本サービスは経理業務の自動化によって、担当者の負担を大きく減らします。
- 銀行口座やカードの明細を自動で取り込み、手入力が不要になります
- 月次の経営数値をリアルタイムに確認できます`;

const SEC3_FEATURES = `## 3. 機能と導入メリット
主な機能と導入メリットは次のとおりです。
- 明細の自動取り込みと仕訳の自動提案
- 請求書・見積書の作成と送付
- 入金消込と売掛金の管理`;

const SEC4_PRICING = `## 4. 料金プラン（例）
料金プランは次の3プランです。
**おすすめプラン比較**
| プラン | 月額料金 | 主な機能 |
| --- | --- | --- |
| ベーシック | 3,300円 | 記帳と仕訳の自動化 |
| スタンダード | 5,500円 | 請求書発行と入金管理 |
| プレミアム | 8,800円 | 部門別管理とAPI連携 |`;

// 導入ステップ表のデータ行は名詞句で、表→箇条書き変換後の文が結論文
// らしい文（〜します等）にならない形にしてある（結論文の決定順序は
// リード文 → 結論文らしい箇条書き → 定型文のため）。
const STEP_TEXTS = [
  'ヒアリング：現在の経理業務の流れと課題の確認',
  '初期設定：勘定科目と口座連携の初期設定',
  '本稼働：運用の開始と効果測定の実施',
];
const SEC5_HEAD = `## 5. 導入ステップと次のアクション
導入は次のステップで進めます。
**導入ステップ**`;
const STEPS_TABLE = `| ステップ | 内容 |
| --- | --- |
| ヒアリング | 現在の経理業務の流れと課題の確認 |
| 初期設定 | 勘定科目と口座連携の初期設定 |
| 本稼働 | 運用の開始と効果測定の実施 |`;
const STEPS_BULLETS = STEP_TEXTS.map((step) => `- ${step}`).join('\n');

const QUESTION_LINE = 'この構成でよろしいですか？';
const ASK_LINE =
  'ご希望があれば『士業・税理士向けに変えて』『価格を3段階にして』など、内容を調整することもできます。';
const REQUEST_LINE = 'ご希望の内容をお伝えください。';
const CLOSING_PROSE = [QUESTION_LINE, ASK_LINE, REQUEST_LINE].join('\n');

// W25（報告書の G）: 本番形状#7。failureShape の全11項目が本番実測と一致する。
const W25_PRODUCTION_SHAPE = [
  HEAD_BLOCK,
  SUMMARY,
  SEC1_CHALLENGE,
  SEC2_VALUE,
  SEC3_FEATURES,
  SEC4_PRICING,
  `${SEC5_HEAD}\n${STEPS_TABLE}\n${CLOSING_PROSE}`,
].join('\n\n');

// W26（報告書の V1a）: 締めの散文が太字見出し「次のステップ」の下にある形。
// 締め節は実在するが散文のみで、ask が埋まるため、fix-6 までの受け皿条件
// （ask が空）では計画節の箇条書きに届かず、締め散文そのものが文分割で
// 連結された低品質な nextSteps になっていた。
const W26_CLOSING_PROSE_ONLY = [
  HEAD_BLOCK,
  SUMMARY,
  SEC1_CHALLENGE,
  SEC2_VALUE,
  SEC3_FEATURES,
  SEC4_PRICING,
  `${SEC5_HEAD}\n${STEPS_TABLE}`,
  `**次のステップ**\n${CLOSING_PROSE}`,
].join('\n\n');

// W27（報告書の V3）: 導入ステップが表ではなく箇条書きの形。材料の形は
// 無関係で、届き先（受け皿）の問題であることの固定。
const W27_BULLET_STEPS = [
  HEAD_BLOCK,
  SUMMARY,
  SEC1_CHALLENGE,
  SEC2_VALUE,
  SEC3_FEATURES,
  SEC4_PRICING,
  `${SEC5_HEAD}\n${STEPS_BULLETS}\n${CLOSING_PROSE}`,
].join('\n\n');

// W28（報告書の G-noclose）: 末尾の締め散文が無く、締めの痕跡が皆無の形。
// CAND-E（痕跡が皆無でも受け皿を開く）は不採用のため null のまま。
const W28_NO_CLOSING_TRACE = [
  HEAD_BLOCK,
  SUMMARY,
  SEC1_CHALLENGE,
  SEC2_VALUE,
  SEC3_FEATURES,
  SEC4_PRICING,
  `${SEC5_HEAD}\n${STEPS_TABLE}`,
].join('\n\n');

// 否定テスト用: 締めの散文が最後でない節（§2）の末尾にある形。FIX7-1 の
// 切り出しは最後の節だけが対象のため発動せず、締め節も無いので null。
const MIDDLE_PROSE = [
  HEAD_BLOCK,
  SUMMARY,
  SEC1_CHALLENGE,
  `${SEC2_VALUE}\n${CLOSING_PROSE}`,
  SEC3_FEATURES,
  SEC4_PRICING,
  `${SEC5_HEAD}\n${STEPS_TABLE}`,
].join('\n\n');

// 否定テスト用: 締め節が既に実在し、最後の役割節のリードが質問文だけの形。
// FIX7-1 は締め節が無い場合に限るため発動せず、質問文はその節の結論文
// として残り、締めは実在する締め節から作られる。
const CLOSING_EXISTS_LAST_QUESTION = `【提案資料（ドラフト）】中小企業向けクラウド会計サービスの販促提案資料
本資料は、中小企業向けクラウド会計サービスの販促提案資料の本文です。

**要点**
本サービスは経理業務の効率化と月次決算の早期化を支援します。
- 経理業務の時間を30%削減できます
- 月額3,300円から始められる料金プランです
- 導入は最短1週間で完了します

## 1. 対象顧客と課題
経理担当者が少なく、月末に作業が集中していることが課題です。
- 経理担当者が1名のみで、月末に請求処理が集中しています
- 紙の請求書や表計算ソフトでの管理が中心になっています

## 2. 料金プラン
料金プランは次の2プランです。
- ベーシック：月額3,300円
- スタンダード：月額5,500円

## 3. 次のステップ
- 無料トライアルをお申し込みください
- 導入相談の日時をご指定ください

## 4. 導入事例
ご不明な点があればお聞かせください。
- 製造業のA社では月の経理業務が80時間から55時間に減りました`;

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

describe('parseProposalDeckSkeleton free-form fallback v7 (2026-11-14 seventh production failure)', () => {
  it('W25: reproduces the production failure shape of the seventh failure (all 11 items)', () => {
    expect(summarizeProposalDeckAnswerShape(W25_PRODUCTION_SHAPE)).toEqual({
      totalChars: 1112,
      markdownHeadingCount: 5,
      numberedHeadingCount: 0,
      bracketStandaloneLineCount: 0,
      boldLabelLineCount: 3,
      bulletLineCount: 10,
      tableRowCount: 10,
      rejectedHeadingCount: 0,
      rejectedHeadingTooLongCount: 0,
      rejectedHeadingColonCount: 0,
      rejectedHeadingSequenceMismatchCount: 0,
    });
  });

  it('W25: converts G — the heading-less closing prose is carved out of the last plan section (FIX7-1 + FIX7-2 + FIX7-3)', () => {
    const { input } = expectConvertible(W25_PRODUCTION_SHAPE);
    expect(input.title).toBe('中小企業向けクラウド会計サービスの販促提案資料');
    expect(input.summary.points).toEqual(SUMMARY_POINTS);
    expect(input.sections.map((section) => section.role)).toEqual([
      'challenge',
      'value',
      'value',
      'cost',
      'other',
      'plan',
      'plan',
    ]);
    // 締め散文が切り出されたため、計画節の結論文は確認質問ではなく
    // 定型文になり、箇条書きには導入ステップ表由来の3件が残る。
    const plans = input.sections.filter((section) => section.role === 'plan');
    expect(plans).toHaveLength(2);
    expect(plans[1].message).toBe('導入ステップは次のとおりです。');
    expect(plans[1].bullets.map((bullet) => bullet.lead)).toEqual([
      'ヒアリング',
      '初期設定',
      '本稼働',
    ]);
    for (const section of input.sections) {
      expect(section.message).not.toBe(QUESTION_LINE);
    }
    // nextSteps は締め散文ではなく、導入ステップ表由来の実ステップ3件。
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
    // ask は締め散文のうち調整可否の文、確認質問は前提・未確認事項へ。
    expect(input.closing.ask).toBe(ASK_LINE);
    expect(input.assumptions).toEqual([QUESTION_LINE]);
  });

  it('W26: converts V1a — with a prose-only closing section, nextSteps come from the plan bullets, not the closing prose (FIX7-2 + FIX7-3)', () => {
    const { input } = expectConvertible(W26_CLOSING_PROSE_ONLY);
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
    expect(input.closing.ask).toBe(ASK_LINE);
    expect(input.assumptions).toEqual([QUESTION_LINE]);
  });

  it('W27: converts V3 — steps written as bullets feed nextSteps the same way', () => {
    const { input } = expectConvertible(W27_BULLET_STEPS);
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
    expect(input.closing.ask).toBe(ASK_LINE);
    expect(input.assumptions).toEqual([QUESTION_LINE]);
  });

  it('W28: stays null when the document has no trace of a closing (CAND-E not adopted)', () => {
    expect(parseProposalDeckSkeleton(W28_NO_CLOSING_TRACE)).toBeNull();
  });

  it('does not carve a closing block out of a non-final section', () => {
    expect(parseProposalDeckSkeleton(MIDDLE_PROSE)).toBeNull();
  });

  it('does not carve when a closing section already exists', () => {
    const { input } = expectConvertible(CLOSING_EXISTS_LAST_QUESTION);
    // 締めは実在する締め節の箇条書きから作られる。
    expect(input.closing.nextSteps).toEqual([
      '無料トライアルをお申し込みください',
      '導入相談の日時をご指定ください',
    ]);
    // 最後の役割節の質問文は切り出されず、その節の結論文として残る。
    const other = input.sections.find((section) => section.role === 'other');
    expect(other!.message).toBe('ご不明な点があればお聞かせください。');
    expect(input.assumptions).toEqual([]);
  });

  it('is deterministic for the W25 shape', () => {
    expect(parseProposalDeckSkeleton(W25_PRODUCTION_SHAPE)).toEqual(
      parseProposalDeckSkeleton(W25_PRODUCTION_SHAPE),
    );
  });
});
