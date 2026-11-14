import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { summarizeProposalDeckAnswerShape } from './proposalDeckFailureShapeV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第8回本番失敗（2026-11-14、main 9703341c、fix-7 デプロイ後）の再構成
// フィクスチャ。切り分け報告書
// ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE8_2026-11-14.md の
// §4（再現フィクスチャ H と変形 H-BULLET、干渉確認用の混合文書 MIXED2）と
// §9（W29〜W31）を恒常テストとして取り込んだもの。文面は UI 観察＋
// failureShape に基づく再構成で、本番回答の原文そのものではない。
// サービス概要のリード文は totalChars を本番の 783 に合わせ込むため
// 調整してあり、他の10項目は文面調整なしに構造だけで一致する。
// 形の特徴: 【ビジネス向け】単独行＋主題文、見出しはすべてレベル3
// （###）の6節（サービス概要／会計課題／提案内容／導入効果／料金プラン／
// 次のステップ）、導入効果と料金プランに表が1つずつ、締めは番号付き
// ステップ3行。受理拒否はすべて0で、材料は見出しの下に正しく配置されて
// いるのに変換できない形。
// - 壁8-A: strict／フォールバックともレベル3見出しを節見出しとして
//   認識せず、節が一切成立しない（箇条書き13行と表6行は帰属先を失って
//   破棄され、節を作れるのは番号付きステップ行だけで、FIX6-2 の降格で
//   1件に潰れて contentSections < 3 で null になる）。第1〜7回の壁が
//   すべて「見出し受理後」の段にあったのに対し、今回は見出しのレベル
//   そのものが認識範囲の外にあった。
// fix-8 は FIX8-1（レベル2見出し行が文書内に1つも無い場合に限り、
// レベル3見出しをレベル2と同格の節見出し候補として取り込む。受理・
// 分類・usedMarkdownHeadings の扱いはレベル2と同一の経路）で対処する。
// レベル3の無条件取り込み（FIX8-2）は、混合文書で小見出しが独立した
// 節に化けて内容配分が変わるため不採用で、W30 が非干渉を固定する。
// strict パーサーは変更しない。

const BRACKET_LINE = '【ビジネス向け】';
const SUBJECT_LINE =
  '中小企業向けクラウド会計サービス販促提案資料：会計業務の時間を30%削減し、経営に集中できる環境を提供します。';
const HEAD_BLOCK = `${BRACKET_LINE}\n${SUBJECT_LINE}`;

// サービス概要のリード文は totalChars を本番実測（783）に一致させる
// ための調整込み（3文）。
const SUMMARY_POINTS = [
  '記帳から決算まで一つの画面で完結できます',
  '銀行口座やカードの明細を自動で取り込みます',
  '月次の経営数値をリアルタイムで確認できます',
];
const SEC1_SUMMARY = `### サービス概要
本サービスは、記帳から月次決算までを効率化するクラウド会計サービスです。明細の自動取り込みで手入力の手間を減らすことができます。経営数値をいつでも確認できます。
${SUMMARY_POINTS.map((point) => `- ${point}`).join('\n')}
- 税理士とのデータ共有もスムーズです`;

const SEC2_CHALLENGE = `### 中小企業が抱える会計課題
中小企業では経理が一部の担当者に集中し、月末の負担が大きいです。紙の運用は転記に時間がかかります。
- 経理担当者が限られ、月末に作業が集中します
- 請求書や領収書の整理に時間がかかります
- 表計算ソフトの管理に手間が生じます
- 月次決算が遅れ、経営判断に活かせません`;

const SEC3_SOLUTION = `### 提案内容
本サービスでは、次の機能で経理業務の負担を軽減します。
- 明細の自動取り込みと仕訳の自動提案
- 請求書と見積書の作成・送付
- 入金消込と売掛金の管理
- 部門別の収支管理とレポート
- 税理士との連携機能と権限管理`;

const SEC4_VALUE = `### 導入効果（想定）
| 項目 | 導入前 | 導入後 |
| --- | --- | --- |
| 会計業務にかかる時間 | 月40時間 | 月28時間 |`;

const SEC5_COST = `### 料金プラン（月額）
| プラン | ベーシック | スタンダード | プレミアム |
| --- | --- | --- | --- |
| 月額料金 | 3,000円 | 5,000円 | 8,000円 |`;

const STEP_TEXTS = [
  '無料相談をお申し込みください',
  '導入プランをご提案します',
  'ご契約と初期設定を開始します',
];
const STEPS_NUMBERED = STEP_TEXTS.map((step, index) => `${index + 1}. ${step}`).join('\n');
const STEPS_BULLETS = STEP_TEXTS.map((step) => `- ${step}`).join('\n');

// W29（報告書の H）: 本番形状#8。failureShape の全11項目が本番実測と一致する。
const W29_PRODUCTION_SHAPE = [
  HEAD_BLOCK,
  SEC1_SUMMARY,
  SEC2_CHALLENGE,
  SEC3_SOLUTION,
  SEC4_VALUE,
  SEC5_COST,
  `### 次のステップ\n${STEPS_NUMBERED}`,
].join('\n\n');

// W31（報告書の H-BULLET）: ステップが番号付きではなく「- 」箇条書きの形。
// 見出しが開けば箇条書きは締め節に帰属するため、副次的に解消することも固定する。
const W31_BULLET_STEPS = [
  HEAD_BLOCK,
  SEC1_SUMMARY,
  SEC2_CHALLENGE,
  SEC3_SOLUTION,
  SEC4_VALUE,
  SEC5_COST,
  `### 次のステップ\n${STEPS_BULLETS}`,
].join('\n\n');

// W30（報告書の MIXED2）: レベル2の節の下にレベル3の小見出しがある混合文書。
// レベル2が存在するため昇格は発動せず、小見出しの箇条書きは親節（課題）に
// 残り、独立した節は作られない（FIX8-1 の非干渉、FIX8-2 との差）。
const W30_MIXED = `中小企業向けクラウド会計サービスの販促提案資料です。経理業務の効率化を支援します。

## 提案の要点
本サービスの要点は次の3点です。
- 経理業務の時間を30%削減できます
- 月額3,300円から始められる料金プランです
- 導入は最短1週間で完了します

## 課題
経理担当者が少なく、月末に作業が集中していることが課題です。
- 経理担当者が1名のみで、月末に請求処理が集中しています
### 補足の内訳
- 紙の請求書や表計算ソフトでの管理が中心になっています
- 月次決算の確定が翌月下旬まで遅れています

## 提案内容
本サービスは経理業務の自動化によって、担当者の負担を大きく減らします。
- 銀行口座やカードの明細を自動で取り込み、手入力が不要になります
- 月次の経営数値をリアルタイムに確認できます

## 料金プラン
料金プランは次の2プランです。
- ベーシック：月額3,300円
- スタンダード：月額5,500円

## 次のステップ
- 無料トライアルをお申し込みください
- 導入相談の日時をご指定ください`;

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

describe('parseProposalDeckSkeleton free-form fallback v8 (2026-11-14 eighth production failure)', () => {
  it('W29: reproduces the production failure shape of the eighth failure (all 11 items)', () => {
    expect(summarizeProposalDeckAnswerShape(W29_PRODUCTION_SHAPE)).toEqual({
      totalChars: 783,
      markdownHeadingCount: 6,
      numberedHeadingCount: 3,
      bracketStandaloneLineCount: 1,
      boldLabelLineCount: 0,
      bulletLineCount: 13,
      tableRowCount: 6,
      rejectedHeadingCount: 0,
      rejectedHeadingTooLongCount: 0,
      rejectedHeadingColonCount: 0,
      rejectedHeadingSequenceMismatchCount: 0,
    });
  });

  it('W29: converts H — level-3 headings are promoted when the document has no level-2 heading (FIX8-1)', () => {
    const { input } = expectConvertible(W29_PRODUCTION_SHAPE);
    expect(input.title).toBe(
      '中小企業向けクラウド会計サービス販促提案資料：会計業務の時間を30%削減し、経営に集中できる環境を提供します',
    );
    // 要約の要点はサービス概要の箇条書き由来（先頭3点）。
    expect(input.summary.points).toEqual(SUMMARY_POINTS);
    // 役割節は challenge／solution／value／cost の4件。
    expect(input.sections.map((section) => section.role)).toEqual([
      'challenge',
      'solution',
      'value',
      'cost',
    ]);
    // nextSteps は締め節（次のステップ）の番号付きステップ3件。
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
  });

  it('W30: mixed document — a level-3 subheading under a level-2 section stays inside its parent section (FIX8-1 non-interference)', () => {
    const { input } = expectConvertible(W30_MIXED);
    // 節構成は現行と一致する（小見出しから独立した節は作られない）。
    expect(input.sections.map((section) => section.role)).toEqual([
      'challenge',
      'solution',
      'cost',
    ]);
    // 課題節は小見出しの箇条書き2点を含め、箇条書き3点を保持する。
    const challenge = input.sections.find((section) => section.role === 'challenge');
    expect(challenge!.bullets.map((bullet) => bullet.lead)).toEqual([
      '経理担当者が1名のみで、月末に請求処理が集中しています',
      '紙の請求書や表計算ソフトでの管理が中心になっています',
      '月次決算の確定が翌月下旬まで遅れています',
    ]);
    expect(input.closing.nextSteps).toEqual([
      '無料トライアルをお申し込みください',
      '導入相談の日時をご指定ください',
    ]);
  });

  it('W31: converts H-BULLET — steps written as bullets feed nextSteps once the closing heading opens', () => {
    const { input } = expectConvertible(W31_BULLET_STEPS);
    expect(input.sections.map((section) => section.role)).toEqual([
      'challenge',
      'solution',
      'value',
      'cost',
    ]);
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
  });

  it('is deterministic for the W29 shape', () => {
    expect(parseProposalDeckSkeleton(W29_PRODUCTION_SHAPE)).toEqual(
      parseProposalDeckSkeleton(W29_PRODUCTION_SHAPE),
    );
  });
});
