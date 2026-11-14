import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { summarizeProposalDeckAnswerShape } from './proposalDeckFailureShapeV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第10回本番失敗（2026-11-15、main 2d8dc6a6、fix-9 デプロイ後）の再構成
// フィクスチャ。切り分け報告書
// ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE10_2026-11-15.md の
// §4（再現フィクスチャ J と変形 J-SEQCONT）と §9（W35〜W38）を恒常テスト
// として取り込んだもの。文面は UI 観察＋failureShape に基づく再構成で、
// 本番回答の原文そのものではない（全11項目の形状は本番実測と一致する）。
// 形の特徴: 導入文（構成案の提示）のあと、番号付き markdown 見出しの6節
// （表紙／課題提起／サービス紹介／導入メリット／導入事例／料金プランと
// 導入の流れ）。各節に「タイトル」「内容」のメタ説明があり、§2 には
// 番号付きの課題リスト2行、§6 には料金表（7行）と番号付きの導入
// ステップ3行がある。締めにあたる節は文書内に存在しない。
// - 前面信号だった連番の順序不一致（拒否2件）は壁ではない: 不一致の
//   番号行は箇条書きに降格し、追いついた行は微小節→FIX6-2 降格で戻る
//   ため、ステップ材料は §6 の箇条書きとして全件回収済みだった。
//   連番を完全に連続させた変形（W38）でも現行コードは同一ゲートで
//   落ちることが実測されている。
// - 壁10-A: 発火点は nextSteps === 0。ステップは cost 節（複合見出し
//   「料金プランと導入の流れ」の従属側）の箇条書きとして存在するが、
//   文書内に plan 節が1つも無く、既存の受け皿は plan 節しか参照しない
//   ため届かない。
// fix-10 は FIX10-2'（出典＋見出しシグナル＋最後の役割節で限定した
// 受け皿）で対処する: 各節が「番号付き行に由来する箇条書き」の原文
// リスト（numberedBullets）を保持し、既存の全段が空振りして締め節が
// 存在しない場合に限り、最後の役割節の見出し（注記を除いた本体）が
// 「流れ」または「手順」を含み、かつ numberedBullets が2件以上ある
// とき、その項目だけを nextSteps にする。通常の箇条書き（W36）は
// 出典条件で、流れの節が最後の役割節でない形（W37）は位置条件で、
// 引き続き null であることを固定する。連番カウンタの意味論の変更
// （FIX10-1）と分類側の対策（FIX10-3a／3b）は不採用。コアゲートは
// 一切緩めていない。

const INTRO =
  '中小企業向けクラウド会計サービスの販促提案資料として、以下の構成案をご提案します。各スライドのタイトルと内容をまとめましたので、ご確認ください。全6枚のスライドで、課題の提起から料金プランまでを順に説明する構成にしています。';

const SEC1_COVER = `## 1. 表紙
表紙スライドの内容は次のとおりです。表紙は資料の第一印象を決める重要なスライドです。青を基調にまとめます。
**タイトル**
中小企業向けクラウド会計サービスのご提案
**内容**
サービス名とキャッチコピー、会社ロゴを配置します。背景には業務の効率化をイメージした写真を使います。`;

const SEC2_CHALLENGE = `## 2. 課題提起（中小企業の経理の現状と課題）
中小企業の経理業務では、担当者の不足と紙書類の管理が大きな負担になっています。
- タイトル：中小企業が抱える経理の課題
- 内容：現状の課題は次の2点です。いずれも日々の業務に直結する問題です。
1. 経理担当者が少なく、月末に業務が集中している
2. 紙の領収書や請求書の管理に時間がかかっている`;

const SUMMARY_POINTS = [
  'タイトル：クラウド会計サービスの概要と特長',
  '内容：銀行口座やクレジットカードと連携し、仕訳を自動化するサービスです。請求書の発行や入金の消込も一つの画面で行えます。',
  '特長：自動仕訳で入力作業を削減できます',
];
const SEC3_SUMMARY = `## 3. サービス紹介（クラウド会計サービスの概要と特長）
本サービスは、会計業務の自動化を支援するクラウド型のサービスです。
${SUMMARY_POINTS.map((point) => `- ${point}`).join('\n')}`;

const SEC4_VALUE = `## 4. 導入メリット（業務効率化、コスト削減、経営判断の迅速化）
導入により、日々の経理業務と経営判断の両面で効果が期待できます。
- タイトル：導入で得られる3つのメリット
- 内容：業務効率化、コスト削減、経営判断の迅速化が期待できます。とくに月末の作業集中の解消に効果があります。`;

const SEC5_CASES = `## 5. 導入事例（成功事例の紹介）
- タイトル：導入企業の成功事例
- 内容：従業員20名の製造業で、月次の経理作業時間を大幅に短縮できました。担当者からは、残業が減って助かっています。
- 補足：小売業の事例でも同様の効果が報告されています。効果は業種を問いません。`;

const STEP_TEXTS = ['無料相談のお申し込み', 'ヒアリングと現状確認', '導入支援と運用開始'];
const SEC6_HEAD = `## 6. 料金プランと導入の流れ
料金プランは事業規模に合わせて選べる3つのプランを用意しています。
- タイトル：料金プランと導入の流れ
- 内容：料金は次の表のとおりです。導入は3ステップで進みます。いずれのプランでも初期設定の支援が含まれます。
| プラン | 月額 | 対象 |
| --- | --- | --- |
| スターター | 2,000円 | 個人事業主 |
| スタンダード | 5,000円 | 小規模法人 |
| プレミアム | 8,000円 | 中規模法人 |
| オプション | 1,000円 | 追加ユーザー |
| サポート | 無料 | 全プラン共通 |`;
const SEC6_COST_NUMBERED = `${SEC6_HEAD}
${STEP_TEXTS.map((step, index) => `${index + 1}. ${step}`).join('\n')}`;
const SEC6_COST_BULLETS = `${SEC6_HEAD}
${STEP_TEXTS.map((step) => `- ${step}`).join('\n')}`;
const SEC6_COST_SEQCONT = `${SEC6_HEAD}
${STEP_TEXTS.map((step, index) => `${index + 3}. ${step}`).join('\n')}`;

// W35（報告書の J）: 本番形状#10。failureShape の全11項目が本番実測と一致する。
const W35_PRODUCTION_SHAPE = [
  INTRO,
  SEC1_COVER,
  SEC2_CHALLENGE,
  SEC3_SUMMARY,
  SEC4_VALUE,
  SEC5_CASES,
  SEC6_COST_NUMBERED,
].join('\n\n');

// W36: §6 のステップが番号付き行ではなく通常の「- 」箇条書きの形。
// 番号付き行由来ではない材料は FIX10-2' の出典条件を満たさない。
const W36_BULLET_STEPS = [
  INTRO,
  SEC1_COVER,
  SEC2_CHALLENGE,
  SEC3_SUMMARY,
  SEC4_VALUE,
  SEC5_CASES,
  SEC6_COST_BULLETS,
].join('\n\n');

// W37: §5 と §6 を入れ替え、流れの節が最後の役割節でない形。
// FIX10-2' の位置条件（最後の役割節）を満たさない。
const W37_FLOW_NOT_LAST = [
  INTRO,
  SEC1_COVER,
  SEC2_CHALLENGE,
  SEC3_SUMMARY,
  SEC4_VALUE,
  SEC6_COST_NUMBERED,
  SEC5_CASES,
].join('\n\n');

// W38（報告書の J-SEQCONT）: §6 のステップ番号を 3, 4, 5 に付け替え、
// 文書全体で連番を連続させた形（拒否 0・順序不一致 0）。受け皿が連番
// カウンタの状態に依存しないことの固定。
const W38_SEQ_CONTINUOUS = [
  INTRO,
  SEC1_COVER,
  SEC2_CHALLENGE,
  SEC3_SUMMARY,
  SEC4_VALUE,
  SEC5_CASES,
  SEC6_COST_SEQCONT,
].join('\n\n');

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

describe('parseProposalDeckSkeleton free-form fallback v10 (2026-11-15 tenth production failure)', () => {
  it('W35: reproduces the production failure shape of the tenth failure (all 11 items)', () => {
    expect(summarizeProposalDeckAnswerShape(W35_PRODUCTION_SHAPE)).toEqual({
      totalChars: 1243,
      markdownHeadingCount: 6,
      numberedHeadingCount: 5,
      bracketStandaloneLineCount: 0,
      boldLabelLineCount: 2,
      bulletLineCount: 12,
      tableRowCount: 7,
      rejectedHeadingCount: 2,
      rejectedHeadingTooLongCount: 0,
      rejectedHeadingColonCount: 0,
      rejectedHeadingSequenceMismatchCount: 2,
    });
  });

  it('W35: converts J — the numbered steps recovered in the last role section feed nextSteps (FIX10-2\')', () => {
    const { input } = expectConvertible(W35_PRODUCTION_SHAPE);
    // 要約の要点はサービス紹介の箇条書き由来（3点）。
    expect(input.summary.points).toEqual(SUMMARY_POINTS);
    // 役割節は other／challenge／value／other／cost の5件。
    expect(input.sections.map((section) => section.role)).toEqual([
      'other',
      'challenge',
      'value',
      'other',
      'cost',
    ]);
    // nextSteps は導入ステップ3件の逐語のみ。料金表の行や「タイトル」
    // 「内容」のメタ説明は混入しない。
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
  });

  it('W36: stays null when the flow steps are plain bullets, not numbered lines (FIX10-2\' provenance condition)', () => {
    expect(parseProposalDeckSkeleton(W36_BULLET_STEPS)).toBeNull();
    expect(buildProposalDeckChatArtifact(W36_BULLET_STEPS).status).toBe('failed');
  });

  it('W37: stays null when the flow section is not the last role section (FIX10-2\' position condition)', () => {
    expect(parseProposalDeckSkeleton(W37_FLOW_NOT_LAST)).toBeNull();
    expect(buildProposalDeckChatArtifact(W37_FLOW_NOT_LAST).status).toBe('failed');
  });

  it('W38: converts when the numbering is continuous document-wide (the tray does not depend on the sequence counter)', () => {
    const { input } = expectConvertible(W38_SEQ_CONTINUOUS);
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
  });

  it('is deterministic for the W35 shape', () => {
    expect(parseProposalDeckSkeleton(W35_PRODUCTION_SHAPE)).toEqual(
      parseProposalDeckSkeleton(W35_PRODUCTION_SHAPE),
    );
  });
});
