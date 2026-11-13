import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 2026-11-13 本番の実回答の形状再現（経路1が骨格指示に従わなかった回答）。
// 特徴: 見出し記号（# / ##）なし、冒頭は【ビジネス提案】の導入文、
// 番号付きセクション＋箇条書き、末尾に「確認質問」。
// 統括の本番ログ確認に基づく再現フィクスチャ（文面は再構成）。
const PRODUCTION_FREEFORM = `【ビジネス提案】中小企業が抱える会計業務の負担を大幅に軽減し、経理の効率化と経営判断の迅速化を実現する、クラウド会計サービスの導入をご提案します。

1. 提案の要点
- 月間作業時間を30％削減できます
- 経費精算の自動化で手入力が不要になります
- リアルタイムの財務データ可視化で経営判断が速くなります
- 初期費用無料・月額5万円からのスケーラブルプランです

2. 主なメリット
導入により、経理業務の効率化とコスト削減を同時に実現できます。
- **業務効率化**：仕訳自動化・請求書OCR・銀行取引自動連携で手入力を削減します
- **コスト削減**：経理担当者の残業時間と外注費を抑えられます
- **経営支援**：ダッシュボードで資金繰りの変化を早期に把握できます

3. 主な機能比較（自社 vs 主要競合）
主要な競合サービスと比べても、自動化率と連携数で優位に立てます。
- **仕訳自動化率**：85％（競合平均は70％）
- **銀行連携数**：120銀行に対応しています
- **請求書OCR精度**：98％を実現しています
- **月額料金**：5万円から利用できます
- **サポート**：24時間チャットと電話で対応します

4. 導入ステップ（3か月プラン）
3か月で段階的に導入し、現場の負担を抑えながら本稼働へ移行します。
- **ヒアリング＆現状分析**：1週間
- **設定・データ移行**：2週間
- **操作研修＆テスト運用**：1週間
- **本稼働開始**：1週間
- **定期レビュー＆改善提案**：月次で実施します

5. 想定ROI（サンプルデータ）
サンプルデータでは、導入効果を初年度から確認できます。
- **従業員1人当たりの作業時間削減**：月8時間
- **月間コスト削減額**：人件費単価3,000円/時として月24万円
- **初期投資の回収期間**：3か月以内です

確認質問
- 対象となる業種と従業員規模を教えてください
- 予算の上限と導入時期の目安を教えてください
`;

// セクションのリード文（結論文）を除いた変形: 見出し＋箇条書きだけの形状。
// 結論文は「結論文らしい最初の箇条書きの昇格」または「見出しからの定型文」で決まる。
const FREEFORM_HEADINGS_AND_BULLETS_ONLY = PRODUCTION_FREEFORM.replace(
  '導入により、経理業務の効率化とコスト削減を同時に実現できます。\n',
  '',
)
  .replace('主要な競合サービスと比べても、自動化率と連携数で優位に立てます。\n', '')
  .replace('3か月で段階的に導入し、現場の負担を抑えながら本稼働へ移行します。\n', '')
  .replace('サンプルデータでは、導入効果を初年度から確認できます。\n', '');

// 番号の代わりに太字だけで見出しを書いた変形（番号なし・太字セクション）。
const FREEFORM_BOLD_HEADINGS = PRODUCTION_FREEFORM.replace('1. 提案の要点', '**提案の要点**')
  .replace('2. 主なメリット', '**主なメリット**')
  .replace('3. 主な機能比較（自社 vs 主要競合）', '**主な機能比較（自社 vs 主要競合）**')
  .replace('4. 導入ステップ（3か月プラン）', '**導入ステップ（3か月プラン）**')
  .replace('5. 想定ROI（サンプルデータ）', '**想定ROI（サンプルデータ）**');

// 締めの材料（次のステップ節／計画セクション）が無い自由形式。無理に作らず null。
const FREEFORM_WITHOUT_CLOSING_SOURCE = `【提案】クラウド会計サービスの導入をご提案します。

1. 提案の要点
- 月間作業時間を30％削減できます
- 経費精算の自動化で手入力が不要になります
- リアルタイムの財務データ可視化で経営判断が速くなります

2. 主なメリット
導入により、経理業務の効率化を実現できます。
- **業務効率化**：仕訳自動化で手入力を削減します
`;

// 導入文（タイトル源）が無い自由形式。要が欠けるため null。
const FREEFORM_WITHOUT_INTRO = `1. 提案の要点
- 月間作業時間を30％削減できます
- 経費精算の自動化で手入力が不要になります
- リアルタイムの財務データ可視化で経営判断が速くなります

2. 導入ステップ
来月から段階的に導入します。
- **現状分析**：1週間
`;

const UNRELATED_NUMBERED_LIST = `買い物のメモです。週末にまとめて買います。

1. 牛乳を2本買う
2. 卵を1パック買う
3. パンを買う
`;

describe('parseProposalDeckSkeleton free-form fallback', () => {
  it('converts the production-shaped free-form answer into a deck that passes build + self-check', () => {
    const input = parseProposalDeckSkeleton(PRODUCTION_FREEFORM);
    expect(input).not.toBeNull();

    // タイトルは導入文の第1文（【…】マーカーなし）。
    expect(input!.title).toBe(
      '中小企業が抱える会計業務の負担を大幅に軽減し、経理の効率化と経営判断の迅速化を実現する、クラウド会計サービスの導入をご提案します',
    );
    // 要約の要点は形式の件数（3点）に切り詰められる。4点目（料金プラン）は
    // 費用・比較のセクション側に残る前提で落とされる。
    expect(input!.summary!.points).toEqual([
      '月間作業時間を30％削減できます',
      '経費精算の自動化で手入力が不要になります',
      'リアルタイムの財務データ可視化で経営判断が速くなります',
    ]);
    // 締め節が無いため、計画セクションの箇条書き（全5件）が次のステップになる。
    expect(input!.closing).toEqual({
      ask: '',
      nextSteps: [
        'ヒアリング＆現状分析：1週間',
        '設定・データ移行：2週間',
        '操作研修＆テスト運用：1週間',
        '本稼働開始：1週間',
        '定期レビュー＆改善提案：月次で実施します',
      ],
    });
    // 末尾の確認質問は前提・未確認事項へ入る。
    expect(input!.assumptions).toEqual([
      '対象となる業種と従業員規模を教えてください',
      '予算の上限と導入時期の目安を教えてください',
    ]);

    const deck = buildProposalDeck(input!);
    const selfCheck = checkProposalDeck(deck);
    expect(selfCheck.violations).toEqual([]);
    expect(selfCheck.ok).toBe(true);
    // 役割は固定順に並ぶ（メリット=value / 導入ステップ=plan / ROI=cost / 機能比較=other）。
    expect(deck.sections.map((section) => section.role)).toEqual([
      'value',
      'plan',
      'cost',
      'other',
    ]);
    // 計画セクションの箇条書きは上限4件に切り詰められる（5件目は締め側に残る）。
    const plan = deck.sections.find((section) => section.role === 'plan');
    expect(plan!.bullets).toHaveLength(4);
    const other = deck.sections.find((section) => section.role === 'other');
    expect(other!.bullets).toHaveLength(4);
  });

  it('creates a pptx artifact through buildProposalDeckChatArtifact for the production shape', () => {
    const outcome = buildProposalDeckChatArtifact(PRODUCTION_FREEFORM);
    expect(outcome.status).toBe('created');
    if (outcome.status !== 'created') return;
    expect(outcome.artifact.artifactType).toBe('pptx');
    expect(outcome.artifact.filename.endsWith('.pptx')).toBe(true);
    expect(outcome.artifact.verified).toBe(true);
    expect(outcome.artifact.costUsd).toBe(0);
  });

  it('still converts when sections have headings and bullets only (no lead sentences)', () => {
    const input = parseProposalDeckSkeleton(FREEFORM_HEADINGS_AND_BULLETS_ONLY);
    expect(input).not.toBeNull();
    const deck = buildProposalDeck(input!);
    const selfCheck = checkProposalDeck(deck);
    expect(selfCheck.violations).toEqual([]);
    expect(selfCheck.ok).toBe(true);
    // 結論文が無いセクションは見出しからの定型文が入る（捏造ではなく言い換え）。
    const other = deck.sections.find((section) => section.role === 'other');
    expect(other!.message).toBe('主な機能比較は次のとおりです。');
    const cost = deck.sections.find((section) => section.role === 'cost');
    expect(cost!.message).toBe('想定ROIは次のとおりです。');
  });

  it('converts a variant whose section headings are bold-only lines', () => {
    const input = parseProposalDeckSkeleton(FREEFORM_BOLD_HEADINGS);
    expect(input).not.toBeNull();
    const deck = buildProposalDeck(input!);
    const selfCheck = checkProposalDeck(deck);
    expect(selfCheck.violations).toEqual([]);
    expect(selfCheck.ok).toBe(true);
    expect(deck.sections.map((section) => section.role)).toEqual([
      'value',
      'plan',
      'cost',
      'other',
    ]);
  });

  it('is deterministic for the same free-form answer', () => {
    const first = parseProposalDeckSkeleton(PRODUCTION_FREEFORM);
    const second = parseProposalDeckSkeleton(PRODUCTION_FREEFORM);
    expect(first).toEqual(second);
  });

  it('returns null for unrelated plain text and non-proposal numbered lists', () => {
    expect(
      parseProposalDeckSkeleton('提案資料の構成案です。まず課題を整理し、次に解決策を示します。'),
    ).toBeNull();
    expect(parseProposalDeckSkeleton(UNRELATED_NUMBERED_LIST)).toBeNull();
    expect(buildProposalDeckChatArtifact('構成案だけの自由文の回答です。')).toEqual({
      status: 'failed',
      failureCode: 'PROPOSAL_DECK_SKELETON_NOT_MATCHED',
    });
  });

  it('returns null when the closing source (closing section / plan section) is missing', () => {
    expect(parseProposalDeckSkeleton(FREEFORM_WITHOUT_CLOSING_SOURCE)).toBeNull();
  });

  it('returns null when the intro (title source) is missing', () => {
    expect(parseProposalDeckSkeleton(FREEFORM_WITHOUT_INTRO)).toBeNull();
  });
});
