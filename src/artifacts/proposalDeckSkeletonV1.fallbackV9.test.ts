import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { summarizeProposalDeckAnswerShape } from './proposalDeckFailureShapeV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第9回本番失敗（2026-11-14、main dc53da12、fix-8 デプロイ後）の再構成
// フィクスチャ。切り分け報告書
// ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE9_2026-11-14.md の
// §4（再現フィクスチャ I と変形 I-BULLETSTEPS／I-TRAIL）と §9（W32〜W34）を
// 恒常テストとして取り込んだもの。文面は UI 観察＋failureShape に基づく
// 再構成で、本番回答の原文そのものではない。リード文は totalChars を
// 本番の 853 に合わせ込むため調整してあり、他の10項目は文面調整なしに
// 構造だけで一致する。
// 形の特徴: 【ビジネス提案】単独行＋主題文、見出しはすべてレベル3
// （###）で先行番号付きの6節（サービス概要／主なメリット／主な機能／
// 導入フロー（約2週間）／料金プラン（月額）／ROIシミュレーション
// （参考））、料金は箇条書き、導入フローのステップは番号付き行4件、
// ROI に表1つ（5行）。締めにあたる節は文書内に存在しない。受理拒否は
// すべて0で、見出しレベル（第8回の壁）は fix-8 で通過済み。
// - 壁9-A1（分類）: 「導入フロー」が plan パターンに一致せず other に
//   落ち、文書内に計画節が1つも無いため、受け皿が開いても材料を引けない。
// - 壁9-A2（受け皿の到達条件）: 締め節が無い markdown 文書では、計画節の
//   箇条書き流用が usedMarkdownHeadings ガードで閉じる（fix-6 以来の
//   線引き）。ステップ材料は番号付き行が FIX6-2 の降格で「導入フロー」節の
//   箇条書き4件として回収済みだが、二重の壁で nextSteps === 0 になる。
// fix-9 は FIX9-1b（分類の plan パターンへ観測された語「導入フロー」だけを
// 明示追加する。「フロー」一般はキャッシュフロー等への波及のため追加
// しない）＋ FIX9-2'（受け皿の開条件を材料の出典で限定する: 参照先の plan
// 節の箇条書きに FIX6-2 の降格由来の項目が1件以上含まれる場合に限り、
// 締め節の無い markdown 文書でも受け皿を開く）で対処する。受け皿ガードの
// 全面撤廃（FIX9-2）は締め必須の固定判断と衝突するため不採用で、通常の
// 箇条書き（W33）や plan 節以外へ降格した番号リスト（W34）は引き続き
// null であることを固定する。コアゲートは一切緩めていない。

const BRACKET_LINE = '【ビジネス提案】';
const SUBJECT_LINE =
  '中小企業向けクラウド会計サービスの販促提案資料です。会計業務の時間を削減し、経営に集中できる環境を提供します。';
const HEAD_BLOCK = `${BRACKET_LINE}\n${SUBJECT_LINE}`;

const SUMMARY_POINTS = [
  '記帳から決算まで一つの画面で完結できます',
  '明細の自動取り込みで手入力が不要になります',
  '月次の経営数値をリアルタイムで確認できます',
];
const SEC1_SUMMARY = `### 1. サービス概要
本サービスは、記帳から月次決算までを効率化するクラウド会計サービスです。銀行口座やクレジットカードの明細を自動で取り込み、手入力の手間を減らします。月次の経営数値をいつでも確認できます。
${SUMMARY_POINTS.map((point) => `- ${point}`).join('\n')}`;

const SEC2_VALUE = `### 2. 主なメリット
導入により、経理担当者の作業時間と負担を大きく減らせます。月末の作業集中が解消され、残業も減らせます。
- 会計業務にかかる時間を約30%削減できます
- 月末の作業集中と残業を抑えられます
- 経営数値を早く把握でき、判断が速くなります`;

const SEC3_SOLUTION = `### 3. 主な機能
本サービスは、日常の記帳から決算までを支える機能を備えています。税理士との共有も簡単です。
- 明細の自動取り込みと仕訳の自動提案
- 請求書の作成・送付と入金消込の管理`;

const FLOW_LEAD = '導入は約2週間で完了し、業務への影響を抑えます。';
const STEP_TEXTS = [
  'ヒアリングと現状確認',
  '初期設定とデータ移行',
  '操作説明と試行運用',
  '本稼働と運用サポート',
];
const STEPS_NUMBERED = STEP_TEXTS.map((step, index) => `${index + 1}. ${step}`).join('\n');
const STEPS_BULLETS = STEP_TEXTS.map((step) => `- ${step}`).join('\n');
const SEC4_FLOW_NUMBERED = `### 4. 導入フロー（約2週間）\n${FLOW_LEAD}\n${STEPS_NUMBERED}`;
const SEC4_FLOW_BULLETS = `### 4. 導入フロー（約2週間）\n${FLOW_LEAD}\n${STEPS_BULLETS}`;
const SEC4_FLOW_LEAD_ONLY = `### 4. 導入フロー（約2週間）\n${FLOW_LEAD}`;

const SEC5_COST = `### 5. 料金プラン（月額）
料金は事業規模に合わせた3プランから選べます。
- スターター：月額2,000円〜
- スタンダード：月額5,000円〜
- プレミアム：月額10,000円〜`;

const SEC6_COST_ROI = `### 6. ROIシミュレーション（参考）
導入効果の試算は次のとおりです。削減分を人件費換算した概算です。
| 項目 | 導入前 | 導入後 |
| --- | --- | --- |
| 記帳作業時間 | 月20時間 | 月14時間 |
| 月次決算の確定 | 翌月20日 | 翌月5日 |
| 経理の残業時間 | 月10時間 | 月3時間 |`;

// W32（報告書の I）: 本番形状#9。failureShape の全11項目が本番実測と一致する。
const W32_PRODUCTION_SHAPE = [
  HEAD_BLOCK,
  SEC1_SUMMARY,
  SEC2_VALUE,
  SEC3_SOLUTION,
  SEC4_FLOW_NUMBERED,
  SEC5_COST,
  SEC6_COST_ROI,
].join('\n\n');

// W33（報告書の I-BULLETSTEPS）: §4 のステップが番号付き手順リストではなく
// 通常の「- 」箇条書きの形。降格由来ではない箇条書きは FIX9-2' の出典条件を
// 満たさないため、受け皿は開かない。
const W33_BULLET_STEPS = [
  HEAD_BLOCK,
  SEC1_SUMMARY,
  SEC2_VALUE,
  SEC3_SOLUTION,
  SEC4_FLOW_BULLETS,
  SEC5_COST,
  SEC6_COST_ROI,
].join('\n\n');

// W34（報告書の I-TRAIL）: 番号付きステップが文書末尾の見出しなしリストに
// ある形。降格先は最後の節（ROI、cost）であり、参照先の plan 節には降格
// 由来の項目が含まれないため、受け皿は開かない。
const W34_TRAILING_STEPS = [
  HEAD_BLOCK,
  SEC1_SUMMARY,
  SEC2_VALUE,
  SEC3_SOLUTION,
  SEC4_FLOW_LEAD_ONLY,
  SEC5_COST,
  `${SEC6_COST_ROI}\n\n${STEPS_NUMBERED}`,
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

describe('parseProposalDeckSkeleton free-form fallback v9 (2026-11-14 ninth production failure)', () => {
  it('W32: reproduces the production failure shape of the ninth failure (all 11 items)', () => {
    expect(summarizeProposalDeckAnswerShape(W32_PRODUCTION_SHAPE)).toEqual({
      totalChars: 853,
      markdownHeadingCount: 6,
      numberedHeadingCount: 4,
      bracketStandaloneLineCount: 1,
      boldLabelLineCount: 0,
      bulletLineCount: 11,
      tableRowCount: 5,
      rejectedHeadingCount: 0,
      rejectedHeadingTooLongCount: 0,
      rejectedHeadingColonCount: 0,
      rejectedHeadingSequenceMismatchCount: 0,
    });
  });

  it('W32: converts I — the 導入フロー section classifies as plan (FIX9-1b) and its demoted numbered steps feed nextSteps (FIX9-2\')', () => {
    const { input } = expectConvertible(W32_PRODUCTION_SHAPE);
    expect(input.title).toBe('中小企業向けクラウド会計サービスの販促提案資料です');
    // 要約の要点はサービス概要の箇条書き由来（3点）。
    expect(input.summary.points).toEqual(SUMMARY_POINTS);
    // 役割節は value／solution／plan／cost／cost の5件。
    expect(input.sections.map((section) => section.role)).toEqual([
      'value',
      'solution',
      'plan',
      'cost',
      'cost',
    ]);
    // plan 節（導入フロー）の箇条書きは、降格で回収されたステップ4件。
    const plan = input.sections.find((section) => section.role === 'plan');
    expect(plan!.bullets.map((bullet) => bullet.lead)).toEqual(STEP_TEXTS);
    // nextSteps は導入フローのステップ4件の逐語。
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
  });

  it('W33: stays null when the flow steps are plain bullets, not a numbered procedure list (FIX9-2\' provenance condition)', () => {
    expect(parseProposalDeckSkeleton(W33_BULLET_STEPS)).toBeNull();
    expect(buildProposalDeckChatArtifact(W33_BULLET_STEPS).status).toBe('failed');
  });

  it('W34: stays null when the numbered steps demote into a non-plan section (tray reference is the plan section)', () => {
    expect(parseProposalDeckSkeleton(W34_TRAILING_STEPS)).toBeNull();
    expect(buildProposalDeckChatArtifact(W34_TRAILING_STEPS).status).toBe('failed');
  });

  it('is deterministic for the W32 shape', () => {
    expect(parseProposalDeckSkeleton(W32_PRODUCTION_SHAPE)).toEqual(
      parseProposalDeckSkeleton(W32_PRODUCTION_SHAPE),
    );
  });
});
