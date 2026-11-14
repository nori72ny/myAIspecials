import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { summarizeProposalDeckAnswerShape } from './proposalDeckFailureShapeV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第11回本番失敗（2026-11-15、main c1bc6941、fix-10 デプロイ後）の
// 再構成フィクスチャ。切り分け報告書
// ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE11_2026-11-15.md の
// §4（再現フィクスチャ K と変形）と §9（W39〜W42）を恒常テストとして
// 取り込んだもの。文面は UI 観察＋failureShape に基づく再構成で、
// 本番回答の原文そのものではない（全11項目の形状は本番実測と一致する）。
// 形の特徴: 導入文（構成案の提示）のあと、番号付き markdown 見出しの
// 6節（表紙／課題提起／サービス紹介／導入メリット／導入事例／料金
// プランと導入の流れ）。§2 のリード行は体言止め（名詞終わり・「。」
// なし）で、§6 には料金表（11行）と番号付きの導入ステップ4行がある。
// 締めにあたる節は文書内に存在しない。
// - 第1〜10回の失敗はすべてパース段（SKELETON_NOT_MATCHED）だったが、
//   本形状は fix-10 の新段（FIX10-2'）で骨格が一致し、build も通過
//   して、自己チェックの HEADLINE_NOT_ASSERTION 1件だけで落ちた
//   （初の到達段階の前進）。
// - 壁11-A: 発火点は役割順で先頭の節（challenge = §2 課題提起）の
//   message。フォールバックの結論文決定の第1段がリード行の先頭行を
//   主張文かどうか確認せず無条件に採用していたため、体言止めの
//   リード行がそのまま見出し文になり、自己チェックと不整合に
//   なっていた（箇条書き候補にだけ主張文らしさの確認がある非対称）。
// fix-11 は FIX11-2（結論文の選択を主張文優先にする）で対処する:
// リード行群の中から、自己チェックの isAssertion と同じ規則
// （isAssertionSentence）を満たす最初の行を結論文として採用し、
// 主張文が1行も無い節は既存の次段（最初の箇条書き → 定型文）へ
// 落とす。自己チェック側の判定ロジックは一切変更しない。材料は
// すべて原文の逐語であり、生成・言い換えはしない。
// 不採用: 終端リスト拡張（FIX11-1(a)、体言止めには原理的に届かない）、
// 体言止めの合格化（FIX11-1(b)、主張文要件の撤廃であり恒常固定が
// 反転する）、末尾「。」の自動付加（FIX11-3、ゲートの化粧）、
// 指示文の変更（FIX11-4、補助に留める）。strict 経路も変更しない。

const INTRO =
  '中小企業向けクラウド会計サービスの販促提案資料として、以下の構成案をご提案します。各スライドのタイトルと内容をまとめました。全6枚のスライドで、課題の提起から料金プランまでを順に説明する構成にしています。';

const SEC1_COVER = `## 1. 表紙
表紙スライドの内容は次のとおりです。表紙は資料の第一印象を決めるスライドです。青を基調にまとめます。
**タイトル**
中小企業向けクラウド会計サービスのご提案
**内容**
サービス名とキャッチコピー、会社ロゴを配置します。背景には業務の効率化をイメージした写真を使います。`;

// §2 のリード行は体言止め（「負担」で終わり「。」なし）。これが
// fix-10 までのコードでは無条件に結論文として採用され、
// HEADLINE_NOT_ASSERTION の発火点になった。
const CHALLENGE_LEAD_LABEL = '中小企業の経理業務では、担当者の不足と紙書類の管理が大きな負担';
const CHALLENGE_LEAD_ASSERTION =
  '中小企業の経理業務では、担当者の不足と紙書類の管理が大きな負担となっています。';
const SEC2_BODY = `- タイトル：中小企業が抱える経理の課題
- 内容：現状の課題は次の2点です。いずれも日々の業務に直結する問題です。
1. 経理担当者が少なく、月末に業務が集中している
2. 紙の領収書や請求書の管理に時間がかかっている`;
const SEC2_CHALLENGE = `## 2. 課題提起（中小企業の経理の現状と課題）
${CHALLENGE_LEAD_LABEL}
${SEC2_BODY}`;
// W40（報告書の K-FIXLEAD）: §2 のリードを主張文に直しただけの形。
const SEC2_CHALLENGE_ASSERTION_LEAD = `## 2. 課題提起（中小企業の経理の現状と課題）
${CHALLENGE_LEAD_ASSERTION}
${SEC2_BODY}`;
// W42: §2 のリードが2行あり、先頭行が体言止め、2行目が主張文の形。
// FIX11-2 では2行目の主張文が結論文として逐語採用される。
const CHALLENGE_LEAD_SECOND_ASSERTION =
  '担当者の不足と紙の書類の管理が、月末の業務集中を招いています。';
const SEC2_CHALLENGE_TWO_LEADS = `## 2. 課題提起（中小企業の経理の現状と課題）
${CHALLENGE_LEAD_LABEL}
${CHALLENGE_LEAD_SECOND_ASSERTION}
${SEC2_BODY}`;

const SUMMARY_POINTS = [
  'タイトル：CloudAccounting Proの概要と特長',
  '内容：銀行口座やクレジットカードと連携し、仕訳を自動化します。請求書の発行や入金の消込も一つの画面で行えます。',
  '特長：自動仕訳で入力作業を削減できます',
];
const SEC3_SUMMARY = `## 3. サービス紹介（CloudAccounting Proの概要と特長）
本サービスは、会計業務の自動化を支援するクラウド型のサービスです。
${SUMMARY_POINTS.map((point) => `- ${point}`).join('\n')}`;

const SEC4_VALUE = `## 4. 導入メリット（業務効率化、コスト削減、経営判断の迅速化）
導入により、日々の経理業務と経営判断の両面で効果が期待できます。
- タイトル：導入で得られる3つのメリット
- 内容：業務効率化、コスト削減、経営判断の迅速化が期待できます。とくに月末の作業集中の解消に効果があります。`;

const SEC5_CASES = `## 5. 導入事例（成功事例の紹介）
- タイトル：導入企業の成功事例
- 内容：従業員20名の製造業で、月次の経理作業時間を大幅に短縮できました。担当者からは、残業が減って助かっています。`;

const STEP_TEXTS = [
  '無料相談のお申し込み',
  'ヒアリングと現状確認',
  '導入支援と初期設定',
  '運用開始とサポート',
];
const SEC6_HEAD = `## 6. 料金プランと導入の流れ
料金プランは事業規模に合わせて選べる3つのプランを用意しています。
| プラン | 月額 | 対象 |
| --- | --- | --- |
| ベーシック | 3,500円 | 個人事業主 |
| スタンダード | 7,500円 | 小規模法人 |
| プレミアム | 12,000円 | 中規模法人 |
| 追加ユーザー | 500円 | 1名ごと |
| 電話サポート | 1,000円 | 全プラン |
| 導入研修 | 30,000円 | 初回のみ |
| データ移行 | 50,000円 | 初回のみ |
| 税理士連携 | 8,000円 | 希望者 |
| 追加容量 | 300円 | 10GBごと |`;
const SEC6_COST_NUMBERED = `${SEC6_HEAD}
${STEP_TEXTS.map((step, index) => `${index + 1}. ${step}`).join('\n')}`;
// W41（報告書の K-DASHSTEPS）: §6 のステップが番号付き行ではなく
// 通常の「- 」箇条書きの形。FIX10-2' の出典条件を満たさない。
const SEC6_COST_BULLETS = `${SEC6_HEAD}
${STEP_TEXTS.map((step) => `- ${step}`).join('\n')}`;

// W39（報告書のフィクスチャ K）: 本番形状#11。failureShape の
// 全11項目が本番実測と一致する。
const W39_PRODUCTION_SHAPE = [
  INTRO,
  SEC1_COVER,
  SEC2_CHALLENGE,
  SEC3_SUMMARY,
  SEC4_VALUE,
  SEC5_CASES,
  SEC6_COST_NUMBERED,
].join('\n\n');

const W40_ASSERTION_LEAD = [
  INTRO,
  SEC1_COVER,
  SEC2_CHALLENGE_ASSERTION_LEAD,
  SEC3_SUMMARY,
  SEC4_VALUE,
  SEC5_CASES,
  SEC6_COST_NUMBERED,
].join('\n\n');

const W41_BULLET_STEPS = [
  INTRO,
  SEC1_COVER,
  SEC2_CHALLENGE,
  SEC3_SUMMARY,
  SEC4_VALUE,
  SEC5_CASES,
  SEC6_COST_BULLETS,
].join('\n\n');

const W42_SECOND_LEAD_ASSERTION = [
  INTRO,
  SEC1_COVER,
  SEC2_CHALLENGE_TWO_LEADS,
  SEC3_SUMMARY,
  SEC4_VALUE,
  SEC5_CASES,
  SEC6_COST_NUMBERED,
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

describe('parseProposalDeckSkeleton free-form fallback v11 (2026-11-15 eleventh production failure)', () => {
  it('W39: reproduces the production failure shape of the eleventh failure (all 11 items)', () => {
    expect(summarizeProposalDeckAnswerShape(W39_PRODUCTION_SHAPE)).toEqual({
      totalChars: 1237,
      markdownHeadingCount: 6,
      numberedHeadingCount: 6,
      bracketStandaloneLineCount: 0,
      boldLabelLineCount: 2,
      bulletLineCount: 9,
      tableRowCount: 11,
      rejectedHeadingCount: 2,
      rejectedHeadingTooLongCount: 0,
      rejectedHeadingColonCount: 0,
      rejectedHeadingSequenceMismatchCount: 2,
    });
  });

  it('W39: converts K — the label-style lead falls through to the formulaic headline (FIX11-2)', () => {
    const { input } = expectConvertible(W39_PRODUCTION_SHAPE);
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
    // 不合格だった challenge 節の結論文は、体言止めのリード行ではなく
    // 定型文になり、主張文要件を満たす（見出し文の逐語採用はしない）。
    const challenge = input.sections.find((section) => section.role === 'challenge');
    expect(challenge?.message).toBe('課題提起は次のとおりです。');
    // nextSteps は導入ステップ4件の逐語のみ。料金表の行やメタ説明は
    // 混入しない（FIX10-2' の供給）。
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
  });

  it('W40: converts with the assertion lead adopted verbatim as the headline', () => {
    const { input } = expectConvertible(W40_ASSERTION_LEAD);
    // リード行が主張文であれば、fix-11 以前から変換できていた形。
    // FIX11-2 でも主張文のリードが逐語で結論文になることを固定する。
    const challenge = input.sections.find((section) => section.role === 'challenge');
    expect(challenge?.message).toBe(CHALLENGE_LEAD_ASSERTION);
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
  });

  it('W41: stays null when the flow steps are plain bullets, not numbered lines (FIX10-2\' provenance condition)', () => {
    expect(parseProposalDeckSkeleton(W41_BULLET_STEPS)).toBeNull();
    expect(buildProposalDeckChatArtifact(W41_BULLET_STEPS).status).toBe('failed');
  });

  it('W42: adopts the first assertion line within the lead lines, not the leading label line (FIX11-2)', () => {
    const { input } = expectConvertible(W42_SECOND_LEAD_ASSERTION);
    // 先頭行が体言止めでも、リード行群の中の最初の主張文が結論文に
    // なる（先頭行の無条件採用でも、定型文への全落ちでもない）。
    const challenge = input.sections.find((section) => section.role === 'challenge');
    expect(challenge?.message).toBe(CHALLENGE_LEAD_SECOND_ASSERTION);
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
  });

  it('is deterministic for the W39 shape', () => {
    expect(parseProposalDeckSkeleton(W39_PRODUCTION_SHAPE)).toEqual(
      parseProposalDeckSkeleton(W39_PRODUCTION_SHAPE),
    );
  });
});
