import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第4回本番失敗（2026-11-14 07:50、main 7c46d0db）の再構成フィクスチャ。
// 切り分け報告書 ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE4_2026-11-14.md の
// §9（W8〜W13）を恒常テストとして取り込んだもの。文面は UI 観察に基づく
// 再構成で、本番回答の原文そのものではない。
// 形の特徴: 節が6つに増え、節見出しの末尾に【Assumption】タグが付き、
// 末尾の前提節が無く「ご質問」ブロックが締め節の後ろに付く。
const POINTS_BULLETS = `- 導入コストを抑えつつ経理業務を自動化できます
- 月次決算の締め作業を短縮できます
- 税理士との連携をリアルタイムに行えます`;

const POINTS = [
  '導入コストを抑えつつ経理業務を自動化できます',
  '月次決算の締め作業を短縮できます',
  '税理士との連携をリアルタイムに行えます',
];

const SEC_BACKGROUND = `1. 市場背景（前提）【Assumption】
中小企業の経理現場では、人手不足と属人化が進み、月次の締め作業が遅れがちです。
- 経理担当者の残業が常態化しています
- 決算の遅れが経営判断を遅らせています`;

const BACKGROUND_LEAD = '中小企業の経理現場では、人手不足と属人化が進み、月次の締め作業が遅れがちです。';
const BACKGROUND_BULLETS = ['経理担当者の残業が常態化しています', '決算の遅れが経営判断を遅らせています'];

const SEC_OVERVIEW_BULLETS = `2. サービス概要（サンプル）【Assumption】
- 仕訳入力から月次決算までを一気通貫で支援します
- 銀行明細を自動で取り込み、仕訳を提案します
- 税理士とのデータ共有をリアルタイムに行えます`;

const SEC_OVERVIEW_PROSE2 = `2. サービス概要（サンプル）【Assumption】
本サービスは、仕訳入力から請求書発行、月次決算までを一気通貫で支援するクラウド型の会計サービスです。銀行口座やクレジットカードの明細を自動で取り込み、AIが仕訳を提案するため、手入力の作業が大きく減ります。`;

const SEC_EFFECT = `3. 導入効果（期待値）【Assumption】
導入したその日から、経理業務の進め方が変わります。
- **自動仕訳AI**：銀行明細から仕訳を自動生成します
- **リアルタイム財務ダッシュボード**：資金繰りを即時に把握できます`;

const SEC_PLAN_BULLETS = `4. 導入プラン（スケジュール）
段階的に導入を進め、業務への影響を最小限に抑えます。
- 現状ヒアリングと要件の確認
- 初期設定とデータ移行
- 運用開始とフォローアップ`;

const PLAN_SENTENCES = [
  'まずは現状の業務フローをヒアリングし、課題を整理します。',
  'その後に初期設定とデータ移行を進めます。',
  '運用開始後は、月次の締めに合わせてフォローを行います。',
];

const SEC_PLAN_PROSE = `4. 導入プラン（スケジュール）
${PLAN_SENTENCES.join('\n')}`;

const SEC_ROI_TABLE = `5. 投資対効果（ROI）
費用を抑えながら、削減効果が見込めます。
| 項目 | 内容 |
| --- | --- |
| 初期費用 | 0円（無料トライアル） |
| 月額費用 | 5,000円 |
| 年間削減コスト | 約240,000円 |`;

const QUESTIONS = ['対象となる従業員規模はどれくらいですか？', '月額料金の上限はありますか？'];

const SEC_CLOSING_BULLETS = `6. 次ステップ
まずは無料トライアルで、実際の業務に合うかをお試しください。
- 無料トライアルの申し込み
- 現状ヒアリングの実施
- カスタマイズ見積もりの提示

ご質問（高インパクトなポイント）
${QUESTIONS.join('\n')}`;

// W8（報告書の V6）: 要点が同一行インライン（【提案の要点】＋文1文）で、
// 直下に箇条書き3点。節2（サービス概要）は散文2文。
// fix-4 の FIX4-1 が無いと、箇条書きが帰属先を失って破棄され要約が
// 2文だけになり null になっていた形。
const W8_INLINE_POINTS_LEAD = [
  `【提案の要点】クラウド会計の導入により、月次の締め作業を大幅に短縮できます。\n${POINTS_BULLETS}`,
  SEC_BACKGROUND,
  SEC_OVERVIEW_PROSE2,
  SEC_EFFECT,
  SEC_PLAN_BULLETS,
  SEC_ROI_TABLE,
  SEC_CLOSING_BULLETS,
].join('\n\n');

// W9（報告書の V4）: 次ステップは見出しのみ（中身なし）、計画節は散文のみ。
// fix-4 の FIX4-2 が無いと、nextSteps の受け皿が全滅して null になっていた形。
const W9_EMPTY_CLOSING_PROSE_PLAN = [
  `【提案の要点】\n${POINTS_BULLETS}`,
  SEC_BACKGROUND,
  SEC_OVERVIEW_BULLETS,
  SEC_EFFECT,
  SEC_PLAN_PROSE,
  SEC_ROI_TABLE,
  '6. 次ステップ',
].join('\n\n');

// W10（報告書の V4c）: 次ステップは依頼事項の散文1文のみ、計画節は散文のみ。
const W10_ASK_ONLY_CLOSING_PROSE_PLAN = [
  `【提案の要点】\n${POINTS_BULLETS}`,
  SEC_BACKGROUND,
  SEC_OVERVIEW_BULLETS,
  SEC_EFFECT,
  SEC_PLAN_PROSE,
  SEC_ROI_TABLE,
  '6. 次ステップ\n導入可否のご判断をお願いいたします。',
].join('\n\n');

// W11（報告書の V0）: 基準形。変換はされるが、修正前は「（前提）」注記の
// 分類カスケードで節1が前提・未確認事項に化け、投資対効果節が価値に
// 誤分類される汚染があった形（FIX4-3 の固定）。
const W11_BASELINE = [
  `【提案の要点】\n${POINTS_BULLETS}`,
  SEC_BACKGROUND,
  SEC_OVERVIEW_BULLETS,
  SEC_EFFECT,
  SEC_PLAN_BULLETS,
  SEC_ROI_TABLE,
  SEC_CLOSING_BULLETS,
].join('\n\n');

// W12（報告書の V11）: 要点ブロックの中身が番号付き項目（1. 2. 3.）で、
// 連番ゲートがそれらを節として消費し、本来の節1〜3が本文に沈んで
// タイトルが空になる形。報告書 §5 の壁4-C／§7 の FIX4-4 に相当するが、
// 発火確度が低く再解釈の誤爆リスクが高いため fix-4 では未実装。
// 現行では null であることを固定し、形の存在を記録する
// （次回この形が観察されたら FIX4-4 に着手する）。
const W12_NUMBERED_POINTS_BLOCK = [
  `【提案の要点】
1. 導入コストを抑えた料金設計です
2. 月次決算の作業時間を短縮できます
3. サポート体制が充実しています`,
  SEC_BACKGROUND,
  SEC_OVERVIEW_BULLETS,
  SEC_EFFECT,
  SEC_PLAN_BULLETS,
  SEC_ROI_TABLE,
  SEC_CLOSING_BULLETS,
].join('\n\n');

// W13（報告書の V12）: 要点ブロックが見出し行のみ（中身なし）で、
// サービス概要は散文2文。文書内に回収可能な要約文が実在しないため、
// パーサー側で逐語主義を守る限り救済できず、現行仕様として null を固定する。
// 防止は指示側（FIX4-5: 要約を見出しだけで済ませない）の担当。
const W13_HEADER_ONLY_POINTS = [
  '【提案の要点】',
  SEC_BACKGROUND,
  SEC_OVERVIEW_PROSE2,
  SEC_EFFECT,
  SEC_PLAN_BULLETS,
  SEC_ROI_TABLE,
  SEC_CLOSING_BULLETS,
].join('\n\n');

// 【お知らせ】は要約に分類できないため、同一行リードでも節化されず、
// 通常の案内文は資料化されない（FIX4-1 の誤爆防止）。
const INLINE_NOTICE = `【お知らせ】来月から営業時間が変更になります。
平日は9時から18時まで、土曜日は10時から15時までとなります。日曜日と祝日は休業いたします。ご不便をおかけしますが、ご理解のほどよろしくお願いいたします。`;

// 番号付き手順リストだけの回答は、節に中身が無く資料化されない。
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

describe('parseProposalDeckSkeleton free-form fallback v4 (2026-11-14 fourth production failure)', () => {
  it('W8: converts when the points lead is inline on the bracket line', () => {
    const { input } = expectConvertible(W8_INLINE_POINTS_LEAD);
    // 導入が無いため、タイトルは要約節の見出しからのフォールバック。
    expect(input.title).toBe('提案の要点のご提案');
    // 要点はインラインリード直下の箇条書きがそのまま使われる
    // （サービス概要の散文2文に依存しない）。
    expect(input.summary.points).toEqual(POINTS);
    // インラインリードの文は要約節の見出し文になる。
    expect(input.summary.headline).toBe('クラウド会計の導入により、月次の締め作業を大幅に短縮できます。');
  });

  it('W9: converts when the closing section is heading-only and the plan is prose only', () => {
    const { input } = expectConvertible(W9_EMPTY_CLOSING_PROSE_PLAN);
    expect(input.closing.ask).toBe('');
    // 次のステップは計画節の散文から文単位で逐語切り出しされる。
    expect(input.closing.nextSteps).toEqual(PLAN_SENTENCES);
  });

  it('W10: converts when the closing section has only an ask sentence and the plan is prose only', () => {
    const { input } = expectConvertible(W10_ASK_ONLY_CLOSING_PROSE_PLAN);
    expect(input.closing.ask).toBe('導入可否のご判断をお願いいたします。');
    // 依頼事項の文は次のステップに混入せず、計画節の文が使われる。
    expect(input.closing.nextSteps).toEqual(PLAN_SENTENCES);
    expect(input.closing.nextSteps).not.toContain('導入可否のご判断をお願いいたします。');
  });

  it('W11: converts the baseline shape without classification contamination', () => {
    const { input } = expectConvertible(W11_BASELINE);
    expect(input.summary.points).toEqual(POINTS);
    // 節1（市場背景）は「（前提）」注記で前提化されず、役割セクションとして
    // 残る。投資対効果節は cost に分類される。
    expect(input.sections.map((section) => section.role)).toEqual(['other', 'value', 'plan', 'cost']);
    const background = input.sections[0];
    expect(background.message).toBe(BACKGROUND_LEAD);
    expect(background.bullets.map((bullet) => bullet.lead)).toEqual(BACKGROUND_BULLETS);
    // 前提・未確認事項は末尾の質問だけであり、節1のリード文・箇条書きは
    // 流れてこない。
    expect(input.assumptions).toEqual(QUESTIONS);
    expect(input.assumptions).not.toContain(BACKGROUND_LEAD);
    for (const bullet of BACKGROUND_BULLETS) {
      expect(input.assumptions).not.toContain(bullet);
    }
    // ROI 表の行は箇条書きとして残る。
    const cost = input.sections.find((section) => section.role === 'cost');
    expect(cost!.bullets.map((bullet) => bullet.lead)).toEqual(['初期費用', '月額費用', '年間削減コスト']);
    expect(cost!.bullets.map((bullet) => bullet.detail)).toEqual([
      '0円（無料トライアル）',
      '5,000円',
      '約240,000円',
    ]);
    // 締めは通常どおり組み立てられる。
    expect(input.closing.ask).toBe('まずは無料トライアルで、実際の業務に合うかをお試しください。');
    expect(input.closing.nextSteps).toEqual([
      '無料トライアルの申し込み',
      '現状ヒアリングの実施',
      'カスタマイズ見積もりの提示',
    ]);
  });

  it('W12: stays null while the numbering-restart reinterpretation (FIX4-4) is unimplemented', () => {
    expect(parseProposalDeckSkeleton(W12_NUMBERED_POINTS_BLOCK)).toBeNull();
  });

  it('W13: stays null for a header-only points block (prevented instruction-side by FIX4-5)', () => {
    expect(parseProposalDeckSkeleton(W13_HEADER_ONLY_POINTS)).toBeNull();
  });

  it('returns null for a normal notice starting with an inline bracket line', () => {
    expect(parseProposalDeckSkeleton(INLINE_NOTICE)).toBeNull();
  });

  it('returns null for a numbered procedure list only', () => {
    expect(parseProposalDeckSkeleton(PROCEDURE_ONLY)).toBeNull();
  });

  it('is deterministic for the W11 shape', () => {
    expect(parseProposalDeckSkeleton(W11_BASELINE)).toEqual(parseProposalDeckSkeleton(W11_BASELINE));
  });
});
