import { describe, expect, it } from 'vitest';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 固定サンプル3件（監査ラウンド1の題材: ツール導入提案／新規サービス提案／コスト削減提案）。
// いずれも骨格指示どおりに書かれた回答を模し、パース→ビルド→自己チェックを
// 全部通ることを固定検証する。
const SAMPLE_TOOL_INTRODUCTION = `# 業務効率化ツール導入のご提案
営業部の定型作業を自動化する提案

## 要約
導入で営業部の定型作業を月40時間削減できます。
- 見積作成の自動化で月40時間を削減
- 承認フローを一本化し待ち時間を解消
- 導入費用は初年度で回収できる見込み

## 課題
営業部の定型作業が商談時間を圧迫しています。
- **見積作成に月40時間**：転記が中心で商談準備が後回しです
- **承認の待ち時間が長い**：紙とメール併用で平均2日止まります

## 解決策
定型作業をツールへ移し、承認を一本化します。
- **見積の自動作成**：案件を選ぶだけで見積書が出ます
- **承認フローの電子化**：申請から承認まで画面で完結します

## 価値
生まれた時間を商談に回し、受注を伸ばせます。
- **月40時間の創出**：担当者の時間を商談へ回せます
- **転記ミスの削減**：再発行の手間がなくなります

## 計画
3か月で段階導入し、現場の負担を抑えます。
- **初月は試行導入**：一部チームで試し課題を洗います
- **3か月目に全展開**：研修と合わせて全部署へ広げます

## 費用・効果
導入費用は初年度の削減効果で回収できます。
- **初期費用は50万円**：設定と研修を含む金額です
- **年間120万円の削減**：作業時間の削減分を換算した値です

## 次のステップ
依頼事項：来週の部長会議で導入可否をご判断ください
- 導入範囲と開始時期を決める
- 試行チームの担当者を選ぶ

## 前提・未確認事項
- 費用は概算であり、正式見積もりは別途取得する
`;

const SAMPLE_NEW_SERVICE = `# オンライン予約サービス導入のご提案
店舗の予約受付を24時間自動化する提案

## 要約
導入で予約の取りこぼしをなくし、売上を伸ばせます。
- 電話がつながらない時間帯の予約を受けられる
- 予約管理の手作業を月20時間削減できる
- 初期費用は半年で回収できる見込み

## 課題
電話予約だけでは機会損失が起きています。
- **営業時間外の予約不可**：夜間の問い合わせを取りこぼしています
- **予約台帳の手作業**：転記ミスでダブルブッキングが起きます

## 解決策
Web予約を導入し、台帳を自動連携します。
- **24時間のWeb予約**：スマホから3分で予約が完了します
- **台帳の自動連携**：予約がそのまま台帳へ反映されます

## 価値
予約数が増え、店舗の手間が減ります。
- **予約の取りこぼし解消**：時間外の予約も自動で受け付けます
- **月20時間の削減**：台帳管理の手作業がなくなります

## 計画
2か月で導入し、繁忙期前に稼働させます。
- **初月に試験導入**：1店舗で試し、運用を確認します
- **2か月目に全店展開**：研修と合わせて広げます

## 費用・効果
導入費用は半年で回収できる見込みです。
- **初期費用は30万円**：設定と研修を含む金額です
- **月額1万円の運用費**：予約数に応じた変動はありません

## 次のステップ
依頼事項：今月中に試験導入の可否をご判断ください
- 試験導入する店舗を決める
- 開始日と担当者を決める

## 前提・未確認事項
- 費用は概算であり、正式見積もりは別途取得する
`;

const SAMPLE_COST_REDUCTION = `# クラウド費用の削減提案
使っていない資源の停止で月額費用を3割減らす

## 要約
未使用資源の停止で月額費用を3割削減できます。
- 夜間停止で稼働時間を4割減らせる
- 未使用の契約プランを解約できる
- 品質や速度への影響は出ない見込み

## 課題
使っていない資源に費用がかかり続けています。
- **夜間の無人稼働**：利用のない時間帯も課金されています
- **未使用プランの残存**：解約漏れで毎月費用が出ています

## 解決策
稼働スケジュールと契約を見直します。
- **夜間の自動停止**：業務時間外は自動で止めます
- **未使用プランの解約**：利用実績のない契約を止めます

## 価値
月額費用が3割減り、予算に余裕が出ます。
- **月15万円の削減**：年間では180万円の効果です
- **運用の手間は不変**：自動化で人の作業は増えません

## 計画
1か月で棚卸しと適用を終えます。
- **初週に棚卸し**：利用実績を洗い出し対象を決めます
- **月内に適用完了**：停止と解約を順に実施します

## 費用・効果
追加費用なしで削減効果だけが得られます。
- **削減額は月15万円**：初月から効果が出ます
- **作業費用は発生しない**：既存の運用範囲で対応します

## 次のステップ
依頼事項：棚卸しの実施可否をご判断ください
- 対象範囲と開始日を決める
- 関係部署へ事前に連絡する
`;

describe('parseProposalDeckSkeleton', () => {
  it.each([
    ['ツール導入提案', SAMPLE_TOOL_INTRODUCTION],
    ['新規サービス提案', SAMPLE_NEW_SERVICE],
    ['コスト削減提案', SAMPLE_COST_REDUCTION],
  ])('parses the fixed sample (%s) into a deck that passes build + self-check', (_label, sample) => {
    const input = parseProposalDeckSkeleton(sample);
    expect(input).not.toBeNull();
    const deck = buildProposalDeck(input!);
    const selfCheck = checkProposalDeck(deck);
    expect(selfCheck.violations).toEqual([]);
    expect(selfCheck.ok).toBe(true);
    expect(deck.sections.map((section) => section.role)).toEqual([
      'challenge',
      'solution',
      'value',
      'plan',
      'cost',
    ]);
    expect(deck.summary.points).toHaveLength(3);
    expect(deck.closing.nextSteps.length).toBeGreaterThan(0);
  });

  it('extracts title block metadata (subtitle, date, presenter)', () => {
    const input = parseProposalDeckSkeleton(`# 提案タイトル
副題の行
日付：2026-11-12
発表者：営業部

## 要約
見出し文です。
- 要点1
- 要点2
- 要点3

## 課題
課題の結論文です。
- **リード**：詳細

## 次のステップ
依頼事項：判断をお願いします
- 一歩目
`);
    expect(input).not.toBeNull();
    expect(input!.title).toBe('提案タイトル');
    expect(input!.subtitle).toBe('副題の行');
    expect(input!.date).toBe('2026-11-12');
    expect(input!.presenter).toBe('営業部');
  });

  it('splits bullets into lead and detail (bold lead, plain lead, lead only)', () => {
    const input = parseProposalDeckSkeleton(SAMPLE_TOOL_INTRODUCTION);
    expect(input).not.toBeNull();
    const challenge = input!.sections!.find((section) => section.role === 'challenge');
    expect(challenge!.bullets).toEqual([
      { lead: '見積作成に月40時間', detail: '転記が中心で商談準備が後回しです' },
      { lead: '承認の待ち時間が長い', detail: '紙とメール併用で平均2日止まります' },
    ]);
    expect(input!.assumptions).toEqual(['費用は概算であり、正式見積もりは別途取得する']);
    expect(input!.closing).toEqual({
      ask: '来週の部長会議で導入可否をご判断ください',
      nextSteps: ['導入範囲と開始時期を決める', '試行チームの担当者を選ぶ'],
    });
  });

  it('returns null for a free-form answer without the skeleton', () => {
    expect(parseProposalDeckSkeleton('提案資料の構成案です。まず課題を整理し、次に解決策を示します。')).toBeNull();
    expect(parseProposalDeckSkeleton('')).toBeNull();
  });

  it('returns null when a required anchor (closing) is missing', () => {
    const withoutClosing = SAMPLE_COST_REDUCTION.split('## 次のステップ')[0];
    expect(parseProposalDeckSkeleton(withoutClosing)).toBeNull();
  });

  it('ignores headings inside fenced code blocks', () => {
    const withFence = `${SAMPLE_COST_REDUCTION}
\`\`\`
# 偽のタイトル
## 課題
偽の結論文です。
\`\`\`
`;
    const input = parseProposalDeckSkeleton(withFence);
    expect(input).not.toBeNull();
    expect(input!.title).toBe('クラウド費用の削減提案');
    expect(input!.sections).toHaveLength(5);
  });
});
