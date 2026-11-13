import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第3回本番失敗（2026-11-14 05:09、main afe46c35）の再構成フィクスチャ。
// 切り分け報告書 ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE3_2026-11-14.md の
// W1〜W7 を恒常テストとして取り込んだもの。文面は UI 観察に基づく再構成で、
// 本番回答の原文そのものではない。
// 形の特徴: 冒頭の【提案の要点】ブロックに要約が置かれ、番号付き見出し5節
// （課題と解決策・料金は markdown 表）、末尾は【前提・仮定】の節と
// A〜D の選択肢を持つ確認質問。
const POINTS_BULLETS = `- 導入コストを抑えつつ経理業務を自動化できます
- 月次決算の締め作業を短縮できます
- 税理士との連携をリアルタイムに行えます`;

const SEC1_PROSE2 = `1. サービス概要
本サービスは、仕訳入力から請求書発行、月次決算までを一気通貫で支援するクラウド型の会計サービスです。銀行口座やクレジットカードの明細を自動で取り込み、AIが仕訳を提案するため、手入力の作業が大きく減ります。`;

const SEC1_PROSE3 = `1. サービス概要
本サービスは、仕訳入力から請求書発行、月次決算までを一気通貫で支援するクラウド型の会計サービスです。銀行口座やクレジットカードの明細を自動で取り込み、AIが仕訳を提案するため、手入力の作業が大きく減ります。税理士とのデータ共有もリアルタイムに行え、月次決算の締め作業を短縮できます。`;

const SEC1_BULLETS = `1. サービス概要
- 仕訳入力から月次決算までを一気通貫で支援します
- 銀行明細を自動で取り込み、仕訳を提案します
- 税理士とのデータ共有をリアルタイムに行えます`;

const SEC2_CHALLENGE_SOLUTION = `2. 中小企業が抱える課題と解決策
経理担当者の負担が増え、月次決算の遅れが常態化しています。
| 課題 | 解決策 |
| --- | --- |
| 仕訳入力の手作業が多い | 銀行明細の自動取り込みで自動化します |
| 請求書発行に時間がかかる | テンプレート化で即時発行できます |
| 月次決算が遅れがちです | リアルタイム共有で締めを短縮できます |`;

const SEC3_MERITS = `3. 主なメリット（3-5ポイント）
導入したその日から、経理業務の進め方が変わります。
- **自動仕訳AI**：銀行明細から仕訳を自動生成します
- **リアルタイム財務ダッシュボード**：資金繰りを即時に把握できます
- **税理士とのデータ共有**：月次決算の締め作業を短縮できます`;

const SEC4_PRICING = `4. 料金プラン例（サンプルデータ）【※仮定】
| プラン | 月額（税抜） |
| --- | --- |
| ベーシック | 3,000円 |
| スタンダード | 7,500円 |
| プレミアム | 15,000円 |`;

const SEC5_STEPS_BULLETS = `5. 次のステップ
まずは無料トライアルで、実際の業務に合うかをお試しください。
- 無料トライアルの申し込み
- 現状ヒアリングの実施
- カスタマイズ見積もりの提示`;

const SEC5_STEPS_PROSE = `5. 次のステップ
まずは無料トライアルで、実際の業務に合うかをお試しください。
導入は現状ヒアリングから始めます。その後、初期設定とデータ移行を行います。最後に、運用開始後のフォローを実施します。`;

const TAIL_PREMISES_BULLETS = `【前提・仮定】
- 料金プランはいずれも仮定のサンプルデータです
- 導入効果は従業員規模により変わります
対象となる従業員規模はどれくらいですか？
A. 10名以下
B. 11〜50名
C. 51〜100名
D. 101名以上`;

const TAIL_PREMISES_PROSE = `【前提・仮定】
料金プランはいずれも仮定のサンプルデータです。導入効果は従業員規模により変わります。
対象となる従業員規模はどれくらいですか？
A. 10名以下
B. 11〜50名
C. 51〜100名
D. 101名以上`;

const BODY_BULLETS_TAIL = [
  SEC2_CHALLENGE_SOLUTION,
  SEC3_MERITS,
  SEC4_PRICING,
  SEC5_STEPS_BULLETS,
  TAIL_PREMISES_BULLETS,
].join('\n\n');

// W1: 【提案の要点】単独行＋箇条書き3点、節1は散文2文。
const W1_BRACKET_POINTS_PROSE_SUMMARY = [
  `【提案の要点】\n${POINTS_BULLETS}`,
  SEC1_PROSE2,
  BODY_BULLETS_TAIL,
].join('\n\n');

// W1B: W1 に導入の散文1行を追加した形。
const W1B_WITH_INTRO_PROSE = [
  '中小企業向けクラウド会計サービスの販促提案資料を作成しました。',
  `【提案の要点】\n${POINTS_BULLETS}`,
  SEC1_PROSE2,
  BODY_BULLETS_TAIL,
].join('\n\n');

// W2: 【提案の要点】＋同一行に散文2文、節1は散文2文。
const W2_BRACKET_POINTS_INLINE_PROSE = [
  '【提案の要点】本サービスは、中小企業の経理業務を自動化するクラウド会計サービスです。導入コストを抑えながら、月次決算の短期化を実現します。',
  SEC1_PROSE2,
  BODY_BULLETS_TAIL,
].join('\n\n');

// W3: 【提案の要点】単独行＋箇条書き3点、節1も箇条書き3点。
const W3_BRACKET_POINTS_BULLET_SUMMARY = [
  `【提案の要点】\n${POINTS_BULLETS}`,
  SEC1_BULLETS,
  BODY_BULLETS_TAIL,
].join('\n\n');

// W4: 【提案の要点】（…SmartLedger…）＋散文2文、節1は散文3文。
// 修正前は parse が通っても closing／assumptions が汚染されていた形。
const W4_BRACKET_POINTS_WITH_PRODUCT_NAME = [
  '【提案の要点】（クラウド会計サービス「SmartLedger」についての要点）\n本サービス「SmartLedger」は、中小企業の経理担当者の負担を軽くするために設計されました。手作業の入力を減らし、経営判断に使える数字をすぐに出せます。',
  SEC1_PROSE3,
  BODY_BULLETS_TAIL,
].join('\n\n');

// W5: W2 と同じ要点、節1は箇条書き3点、節5と末尾の前提は散文のみ。
const W5_PROSE_CLOSING_AND_PREMISES = [
  '【提案の要点】本サービスは、中小企業の経理業務を自動化するクラウド会計サービスです。導入コストを抑えながら、月次決算の短期化を実現します。',
  SEC1_BULLETS,
  SEC2_CHALLENGE_SOLUTION,
  SEC3_MERITS,
  SEC4_PRICING,
  SEC5_STEPS_PROSE,
  TAIL_PREMISES_PROSE,
].join('\n\n');

// W6: 【提案の要点】＋文1行＋箇条書き3点、節1は散文2文。
const W6_BRACKET_POINTS_PROSE_AND_BULLETS = [
  `【提案の要点】\n本サービスは、中小企業の経理業務を自動化するクラウド会計サービスです。\n${POINTS_BULLETS}`,
  SEC1_PROSE2,
  BODY_BULLETS_TAIL,
].join('\n\n');

// W7: W4 全体を単一のコードフェンスで囲んだ形。
const W7_WHOLE_TEXT_FENCED = '```markdown\n' + W4_BRACKET_POINTS_WITH_PRODUCT_NAME + '\n```\n';

// 【注意】は分類できないため節化されず、通常の案内文は資料化されない。
const NOTICE_WITH_UNCLASSIFIED_BRACKET = `【注意】
この案内は、システムメンテナンスのお知らせです。今週末の土曜日の22時から、日曜日の6時までサービスを停止します。作業中はログインできません。ご不便をおかけしますが、ご協力をお願いします。`;

// 要点ブロックだけの短い回答は、節の複合条件を満たさず資料化されない。
const POINTS_BLOCK_ONLY = `【提案の要点】\n${POINTS_BULLETS}`;

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

describe('parseProposalDeckSkeleton free-form fallback v3 (2026-11-14 third production failure)', () => {
  it('W1: converts when the summary lives in a leading 【提案の要点】 block', () => {
    const { input } = expectConvertible(W1_BRACKET_POINTS_PROSE_SUMMARY);
    // 導入が無いため、タイトルは要約節の見出しからのフォールバック。
    expect(input.title).toBe('提案の要点のご提案');
    // 要点は【提案の要点】節の箇条書きがそのまま使われる。
    expect(input.summary.points).toEqual([
      '導入コストを抑えつつ経理業務を自動化できます',
      '月次決算の締め作業を短縮できます',
      '税理士との連携をリアルタイムに行えます',
    ]);
    expect(input.sections.map((section) => section.role)).toEqual(['challenge', 'value', 'cost']);
  });

  it('W1B: converts with a one-line prose intro before the points block', () => {
    const { input } = expectConvertible(W1B_WITH_INTRO_PROSE);
    expect(input.title).toBe('中小企業向けクラウド会計サービスの販促提案資料を作成しました');
    expect(input.summary.points).toEqual([
      '導入コストを抑えつつ経理業務を自動化できます',
      '月次決算の締め作業を短縮できます',
      '税理士との連携をリアルタイムに行えます',
    ]);
  });

  it('W2: converts when the points block is inline prose on the bracket line', () => {
    const { input } = expectConvertible(W2_BRACKET_POINTS_INLINE_PROSE);
    // 節1の散文2文に、導入の要点ブロックの残りの文を逐語補給して3点にする。
    expect(input.summary.points).toEqual([
      '本サービスは、仕訳入力から請求書発行、月次決算までを一気通貫で支援するクラウド型の会計サービスです。',
      '銀行口座やクレジットカードの明細を自動で取り込み、AIが仕訳を提案するため、手入力の作業が大きく減ります。',
      '導入コストを抑えながら、月次決算の短期化を実現します。',
    ]);
  });

  it('W3: converts when every anchor is present but the intro is only the points block', () => {
    const { input } = expectConvertible(W3_BRACKET_POINTS_BULLET_SUMMARY);
    expect(input.title).toBe('提案の要点のご提案');
    expect(input.summary.points).toEqual([
      '導入コストを抑えつつ経理業務を自動化できます',
      '月次決算の締め作業を短縮できます',
      '税理士との連携をリアルタイムに行えます',
    ]);
  });

  it('W4: converts without contaminating closing ask / assumptions / next steps', () => {
    const { input } = expectConvertible(W4_BRACKET_POINTS_WITH_PRODUCT_NAME);
    expect(input.title).toBe('（クラウド会計サービス「SmartLedger」についての要点）');
    expect(input.summary.points).toEqual([
      '本サービスは、仕訳入力から請求書発行、月次決算までを一気通貫で支援するクラウド型の会計サービスです。',
      '銀行口座やクレジットカードの明細を自動で取り込み、AIが仕訳を提案するため、手入力の作業が大きく減ります。',
      '税理士とのデータ共有もリアルタイムに行え、月次決算の締め作業を短縮できます。',
    ]);
    // 【前提・仮定】は節として認識され、締めの依頼事項に混入しない。
    expect(input.closing.ask).toBe('まずは無料トライアルで、実際の業務に合うかをお試しください。');
    expect(input.closing.ask).not.toBe('【前提・仮定】');
    expect(input.closing.nextSteps).toEqual([
      '無料トライアルの申し込み',
      '現状ヒアリングの実施',
      'カスタマイズ見積もりの提示',
    ]);
    // 前提の箇条書きは前提・未確認事項へ入り、次のステップには混入しない。
    expect(input.assumptions).toContain('料金プランはいずれも仮定のサンプルデータです');
    expect(input.assumptions).toContain('導入効果は従業員規模により変わります');
    expect(input.closing.nextSteps).not.toContain('料金プランはいずれも仮定のサンプルデータです');
    expect(input.closing.nextSteps).not.toContain('導入効果は従業員規模により変わります');
    // 定型文の生成では見出し中の【※仮定】注記が除かれる。
    const cost = input.sections.find((section) => section.role === 'cost');
    expect(cost!.message).toBe('料金プラン例は次のとおりです。');
  });

  it('W5: converts when the closing section and the premises are prose only', () => {
    const { input } = expectConvertible(W5_PROSE_CLOSING_AND_PREMISES);
    expect(input.summary.points).toEqual([
      '仕訳入力から月次決算までを一気通貫で支援します',
      '銀行明細を自動で取り込み、仕訳を提案します',
      '税理士とのデータ共有をリアルタイムに行えます',
    ]);
    // 締めの散文から、依頼事項の文を除いた残りが文単位で次のステップになる。
    expect(input.closing.ask).toBe('まずは無料トライアルで、実際の業務に合うかをお試しください。');
    expect(input.closing.nextSteps).toEqual([
      '導入は現状ヒアリングから始めます。',
      'その後、初期設定とデータ移行を行います。',
      '最後に、運用開始後のフォローを実施します。',
    ]);
    expect(input.assumptions).toContain('対象となる従業員規模はどれくらいですか？');
  });

  it('W6: converts when the points block has one prose line and three bullets', () => {
    const { input } = expectConvertible(W6_BRACKET_POINTS_PROSE_AND_BULLETS);
    expect(input.summary.points).toEqual([
      '導入コストを抑えつつ経理業務を自動化できます',
      '月次決算の締め作業を短縮できます',
      '税理士との連携をリアルタイムに行えます',
    ]);
  });

  it('W7: converts the W4 shape wrapped in a whole-text code fence', () => {
    const { input } = expectConvertible(W7_WHOLE_TEXT_FENCED);
    expect(input.title).toBe('（クラウド会計サービス「SmartLedger」についての要点）');
    expect(input.closing.ask).toBe('まずは無料トライアルで、実際の業務に合うかをお試しください。');
  });

  it('returns null for a normal notice containing an unclassified bracket line', () => {
    expect(parseProposalDeckSkeleton(NOTICE_WITH_UNCLASSIFIED_BRACKET)).toBeNull();
  });

  it('returns null for a points block only', () => {
    expect(parseProposalDeckSkeleton(POINTS_BLOCK_ONLY)).toBeNull();
  });

  it('is deterministic for the W1 shape', () => {
    expect(parseProposalDeckSkeleton(W1_BRACKET_POINTS_PROSE_SUMMARY)).toEqual(
      parseProposalDeckSkeleton(W1_BRACKET_POINTS_PROSE_SUMMARY),
    );
  });
});
