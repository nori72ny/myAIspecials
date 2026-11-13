import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第2回本番失敗（2026-11-13 22:00、main aaf1118b）の再構成フィクスチャ。
// 切り分け報告書 ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE2_2026-11-13.md の
// V1〜V6 を恒常テストとして取り込んだもの。文面はブラウザ確認の要約に基づく
// 再構成で、本番回答の原文そのものではない。
// 形の特徴: タイトル行（「。」なし）＋ Bottom line の散文、番号付き見出し6節
// （要約にあたる節は散文のみ、料金は markdown 表）、末尾の質問に
// 「確認質問」の見出しがない。
const V1_PROSE_SUMMARY_AND_TABLE = `【ビジネス向け】中小企業向けクラウド会計サービス　販促提案資料（案）
Bottom line：導入コストを抑えつつ経理業務を自動化・可視化し、経営判断を支援します。

1. サービス概要
本サービスは、仕訳入力から請求書発行、月次決算までを一気通貫で支援するクラウド型の会計サービスです。銀行口座やクレジットカードの明細を自動で取り込み、AIが仕訳を提案するため、手入力の作業が大きく減ります。税理士とのデータ共有もリアルタイムに行え、月次決算の締め作業を短縮できます。

2. 主な特長（3-5ポイント）
- **自動仕訳AI**：銀行明細から仕訳を自動生成します
- **リアルタイム財務ダッシュボード**：資金繰りを即時に把握できます
- **多言語・多通貨対応**：海外取引にも対応しています
- **セキュリティ**：国内データセンターで暗号化保管します
- **スケーラビリティ**：事業の成長に合わせて拡張できます

3. 導入効果（期待できる成果）
導入企業では、経理作業時間の削減と月次決算の短期化が実現しています。
- **経理作業時間**：平均30％削減できます
- **月次決算**：リードタイムを2週間から3日へ短縮できます
- **入力ミス**：手入力ミスがほぼなくなります

4. 料金プラン（参考例）
| プラン | 月額（税抜） |
| --- | --- |
| ベーシック | 3,000円 |
| スタンダード | 7,500円 |
| プレミアム | 15,000円 |

5. 導入事例（簡易サマリー）
製造業・小売業・ITスタートアップなど、幅広い業種で導入が進んでいます。
- **製造業A社**：月次決算を5日短縮しました
- **小売業B社**：経理担当の残業を月20時間削減しました
- **ITスタートアップC社**：資金繰り表の作成が不要になりました

6. 次のステップ
まずは無料トライアルで、実際の業務に合うかをお試しください。
- 無料トライアルの申し込み
- 現状ヒアリングの実施
- カスタマイズ見積もりの提示
対象となる業種と従業員規模を教えてください。
予算感と、特に強調したいポイントを教えてください。
`;

const SECTION2_BULLETS = `- **自動仕訳AI**：銀行明細から仕訳を自動生成します
- **リアルタイム財務ダッシュボード**：資金繰りを即時に把握できます
- **多言語・多通貨対応**：海外取引にも対応しています
- **セキュリティ**：国内データセンターで暗号化保管します
- **スケーラビリティ**：事業の成長に合わせて拡張できます`;

// V2: V1 の特長節を散文1行に変更した形。
const V2_FEATURES_IN_PROSE = V1_PROSE_SUMMARY_AND_TABLE.replace(
  SECTION2_BULLETS,
  '自動仕訳AIによる仕訳の自動生成、リアルタイムの財務ダッシュボード、多言語・多通貨対応、国内データセンターでの暗号化保管を備え、事業の成長に合わせて拡張できます。',
);

// V3: markdown 見出し版（# タイトル＋ ## 番号見出し）。
const V3_MARKDOWN_HEADINGS = V1_PROSE_SUMMARY_AND_TABLE.replace(
  '【ビジネス向け】中小企業向けクラウド会計サービス　販促提案資料（案）',
  '# 中小企業向けクラウド会計サービス　販促提案資料（案）',
)
  .replace('1. サービス概要', '## 1. サービス概要')
  .replace('2. 主な特長（3-5ポイント）', '## 2. 主な特長（3-5ポイント）')
  .replace('3. 導入効果（期待できる成果）', '## 3. 導入効果（期待できる成果）')
  .replace('4. 料金プラン（参考例）', '## 4. 料金プラン（参考例）')
  .replace('5. 導入事例（簡易サマリー）', '## 5. 導入事例（簡易サマリー）')
  .replace('6. 次のステップ', '## 6. 次のステップ');

// V4: V1 の「主な特長」だけを「主なメリット」に置換した形。
const V4_FEATURES_AS_MERITS = V1_PROSE_SUMMARY_AND_TABLE.replace(
  '2. 主な特長（3-5ポイント）',
  '2. 主なメリット',
);

// V5: V4 に加え、サービス概要へ箇条書き3点を追加した形。
const V5_SUMMARY_WITH_BULLETS = V4_FEATURES_AS_MERITS.replace(
  '税理士とのデータ共有もリアルタイムに行え、月次決算の締め作業を短縮できます。\n',
  '税理士とのデータ共有もリアルタイムに行え、月次決算の締め作業を短縮できます。\n- 仕訳入力から月次決算までを一気通貫で支援します\n- 銀行明細を自動で取り込み、仕訳を提案します\n- 税理士とのデータ共有をリアルタイムに行えます\n',
);

// V6: 番号なし太字見出し版。
const V6_BOLD_HEADINGS = V1_PROSE_SUMMARY_AND_TABLE.replace('1. サービス概要', '**サービス概要**')
  .replace('2. 主な特長（3-5ポイント）', '**主な特長（3-5ポイント）**')
  .replace('3. 導入効果（期待できる成果）', '**導入効果（期待できる成果）**')
  .replace('4. 料金プラン（参考例）', '**料金プラン（参考例）**')
  .replace('5. 導入事例（簡易サマリー）', '**導入事例（簡易サマリー）**')
  .replace('6. 次のステップ', '**次のステップ**');

// 番号付き手順リストだけの回答。見出しとして受理しても、要約の核が無く
// 資料化されてはならない（案B の誤爆防止）。
const NUMBERED_PROCEDURE_ONLY = `作業の手順は次のとおりです。順番に実施してください。

1. パソコンの電源を入れる
2. ブラウザを起動する
3. ログイン画面を開く
4. パスワードを入力する
`;

// markdown 表だけの回答。節が無く資料化されてはならない。
const TABLE_ONLY = `料金プランの一覧です。

| プラン | 月額（税抜） |
| --- | --- |
| ベーシック | 3,000円 |
| スタンダード | 7,500円 |
`;

// 回答全体が単一のコードフェンスで囲われた形（Gemma 系の癖として外部助言で指摘）。
const V1_WRAPPED_IN_CODE_FENCE = '```markdown\n' + V1_PROSE_SUMMARY_AND_TABLE + '```\n';

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

describe('parseProposalDeckSkeleton free-form fallback v2 (2026-11-13 second production failure)', () => {
  it('V1: converts the faithful reconstruction (prose summary, markdown price table)', () => {
    const { input, deck } = expectConvertible(V1_PROSE_SUMMARY_AND_TABLE);

    // タイトルは先頭行そのもの（Bottom line の文と連結されない）。
    expect(input.title).toBe('中小企業向けクラウド会計サービス　販促提案資料（案）');
    // 副題は Bottom line のラベルを除いた本文。
    expect(input.subtitle).toBe(
      '導入コストを抑えつつ経理業務を自動化・可視化し、経営判断を支援します',
    );
    // 要約の要点は散文から文単位で逐語切り出しした3文。
    expect(input.summary.points).toEqual([
      '本サービスは、仕訳入力から請求書発行、月次決算までを一気通貫で支援するクラウド型の会計サービスです。',
      '銀行口座やクレジットカードの明細を自動で取り込み、AIが仕訳を提案するため、手入力の作業が大きく減ります。',
      '税理士とのデータ共有もリアルタイムに行え、月次決算の締め作業を短縮できます。',
    ]);
    // 役割: 特長=value / 導入効果=value / 料金=cost / 導入事例=other。
    // 「導入事例（簡易サマリー）」が要約に誤分類されて脱落しないこと。
    expect(deck.sections.map((section) => section.role)).toEqual([
      'value',
      'value',
      'cost',
      'other',
    ]);
    // markdown 表の価格データがデッキに載ること（ヘッダ行は結論文にならない）。
    const cost = deck.sections.find((section) => section.role === 'cost');
    expect(cost!.message).toBe('料金プランは次のとおりです。');
    expect(cost!.bullets).toEqual([
      { lead: 'ベーシック', detail: '3,000円' },
      { lead: 'スタンダード', detail: '7,500円' },
      { lead: 'プレミアム', detail: '15,000円' },
    ]);
    // 見出しのない末尾質問は締めに混ざらず、前提・未確認事項へ入ること。
    expect(input.closing).toEqual({
      ask: 'まずは無料トライアルで、実際の業務に合うかをお試しください。',
      nextSteps: ['無料トライアルの申し込み', '現状ヒアリングの実施', 'カスタマイズ見積もりの提示'],
    });
    expect(input.assumptions).toEqual([
      '対象となる業種と従業員規模を教えてください。',
      '予算感と、特に強調したいポイントを教えてください。',
    ]);
  });

  it('V2: converts when the features section is a single prose line', () => {
    const { deck } = expectConvertible(V2_FEATURES_IN_PROSE);
    const features = deck.sections.find(
      (section) => section.role === 'value' && section.bullets.length === 0,
    );
    expect(features).toBeDefined();
    expect(features!.message).toContain('自動仕訳AIによる仕訳の自動生成');
  });

  it('V3: converts the markdown-heading variant', () => {
    const { input, deck } = expectConvertible(V3_MARKDOWN_HEADINGS);
    expect(input.title).toBe('中小企業向けクラウド会計サービス　販促提案資料（案）');
    expect(deck.sections.map((section) => section.role)).toEqual([
      'value',
      'value',
      'cost',
      'other',
    ]);
  });

  it('V4: converts when the features heading uses a different vocabulary (主なメリット)', () => {
    expectConvertible(V4_FEATURES_AS_MERITS);
  });

  it('V5: converts when the summary section has both prose and bullets', () => {
    const { input } = expectConvertible(V5_SUMMARY_WITH_BULLETS);
    // 箇条書きが3点ある場合は、従来どおり箇条書きが要点になる。
    expect(input.summary.points).toEqual([
      '仕訳入力から月次決算までを一気通貫で支援します',
      '銀行明細を自動で取り込み、仕訳を提案します',
      '税理士とのデータ共有をリアルタイムに行えます',
    ]);
  });

  it('V6: converts the bold-heading variant (no numbers)', () => {
    const { deck } = expectConvertible(V6_BOLD_HEADINGS);
    expect(deck.sections.map((section) => section.role)).toEqual([
      'value',
      'value',
      'cost',
      'other',
    ]);
  });

  it('converts the same answer wrapped in a single whole-text code fence', () => {
    const { input } = expectConvertible(V1_WRAPPED_IN_CODE_FENCE);
    expect(input.title).toBe('中小企業向けクラウド会計サービス　販促提案資料（案）');
  });

  it('returns null for a numbered procedure list only', () => {
    expect(parseProposalDeckSkeleton(NUMBERED_PROCEDURE_ONLY)).toBeNull();
  });

  it('returns null for a markdown table only', () => {
    expect(parseProposalDeckSkeleton(TABLE_ONLY)).toBeNull();
  });

  it('is deterministic for the V1 shape', () => {
    expect(parseProposalDeckSkeleton(V1_PROSE_SUMMARY_AND_TABLE)).toEqual(
      parseProposalDeckSkeleton(V1_PROSE_SUMMARY_AND_TABLE),
    );
  });
});
