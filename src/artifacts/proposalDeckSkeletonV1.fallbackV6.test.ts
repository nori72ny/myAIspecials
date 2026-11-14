import { describe, expect, it } from 'vitest';
import { buildProposalDeckChatArtifact } from '../legacy/originProposalDeckChat';
import { buildProposalDeck } from './proposalDeckPlannerV1';
import { summarizeProposalDeckAnswerShape } from './proposalDeckFailureShapeV1';
import { checkProposalDeck } from './proposalDeckSelfCheckV1';
import { parseProposalDeckSkeleton } from './proposalDeckSkeletonV1';

// 第6回本番失敗（2026-11-14、main c2120e1c）の再構成フィクスチャ。
// 切り分け報告書 ~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE6_2026-11-14.md の
// §4（再現バリアント B 系）と §10（W20〜W24）を恒常テストとして取り込んだもの。
// 文面は UI 観察＋failureShape に基づく再構成で、本番回答の原文そのものではない。
// 形の特徴: 節は markdown 見出し（## 1.〜## 7.、注記付き）で書かれ、§1 の
// 要約は散文1文（41字）のみ。§6「導入ステップ」の中身は番号付き行5件、
// 締めは太字ラベル＋番号付き質問2件だけである。fix-5 の FIX5-1 で注記付き
// 見出しの受理は直っており（受理拒否は順序不一致2件のみ）、節構造と役割の
// 対応付けは正しく読める。残った壁は次の3つ。
// - 壁6-A: 要約の材料が §1 の散文1文しかなく、summaryPoints < 3 で落ちる。
// - 壁6-B: 締めが質問だけで、計画節の箇条書き受け皿（L856）が
//   usedMarkdownHeadings ガードで markdown 文書では塞がれている。
// - 壁6-C: §6 のステップ番号行が見出しとして受理され、計画節が空になる。
// fix-6 は FIX6-2（中身のない番号付き微小節を、節として落とさず直前の節の
// 箇条書きへ降格させる）と FIX6-1（締め節が実在し、質問の振り分け後に
// ask も nextSteps も空の場合に限り、計画節の箇条書き受け皿を markdown
// 文書でも開く）で 6-C／6-B に対処する。6-A は材料不足として null が
// 現行仕様であり、FIX6-3（導入文からの要約補給の拡張）は採用しない。

const TITLE_H1 = '# 【販促提案資料（案）】中小企業向けクラウド会計サービス';

const INTRO = `本資料は、中小企業向けクラウド会計サービスの販促提案資料（案）です。
以下が、提案資料の構成です。
本資料では、提案の要点、想定する顧客像、主なメリット、主な機能、料金プラン、導入ステップ、サンプルケースの順にご説明します。
数値や事例は、一般的な中小企業の経理業務を想定したサンプルとして記載しています。`;

// §1 の要約文は41字で、要点の材料として1点にだけ数えられる。
const SUMMARY_SENTENCE =
  '経理業務の時間を30%削減し、月額¥3,300から始められるクラウド会計サービス。';
// §1 の説明文は80字を超えるため、要点の材料にはならない（1文のまま）。
const SEC1_EXPLANATION =
  '本サービスは、経理担当者が一人しかいない中小企業でも、請求書の発行から入金確認、月次の集計まで迷わず進められるように設計されており、請求書や領収書の整理、銀行口座やクレジットカードの明細の確認、取引先への支払い準備といった、日々積み重なる細かな作業にかかる手間と時間を減らしていくことで、導入したその日から日々の経理業務の流れを大きく変えることができ、月末や決算期に集中しがちな作業を平準化し、担当者が本来業務に集中できる時間を生み出すことができます。';
const SEC1_POINT_TEXTS = [
  '経理業務の時間を30%削減できます',
  '月額3,300円から始められる料金プランです',
  '導入は最短1週間で完了します',
];
const SEC1_PROSE = `## 1. 提案の要点（Bottom line）
${SUMMARY_SENTENCE}
${SEC1_EXPLANATION}`;
const SEC1_WITH_POINTS = `${SEC1_PROSE}
${SEC1_POINT_TEXTS.map((point) => `- ${point}`).join('\n')}`;

const SEC2_CUSTOMER = `## 2. 想定する顧客像（Assumptions）
想定する顧客像は次のとおりです。
| 項目 | 内容 |
| --- | --- |
| 業種 | 製造業・小売業・飲食業などの中小企業 |
| 従業員数 | 10名から100名程度 |
| 経理体制 | 経理担当者が1名のみ、または経営者が兼務 |
| 現在の課題 | 紙の請求書や表計算ソフトでの管理が中心 |
| 導入の目的 | 月次決算の早期化と経理負担の軽減 |`;

const SEC3_BENEFITS = `## 3. 主なメリット（Benefits）
主なメリットは次の5点です。
- 経理業務にかかる時間を月あたり約30%削減できます
- 銀行口座やカードの明細を自動で取り込み、手入力が不要になります
- 請求書の発行から入金確認までを一つの画面で管理できます
- 月次の経営数値をリアルタイムに確認できます
- 税理士とのデータ共有がスムーズになります`;

const SEC4_FEATURES = `## 4. 主な機能（Features）
主な機能は次の5点です。
- 明細の自動取り込みと仕訳の自動提案
- 請求書・見積書の作成と送付
- 入金消込と売掛金の管理
- 部門別・取引先別の集計レポート
- 決算書類の作成支援と電子申告への連携`;

const SEC5_PRICING = `## 5. 料金プラン（Sample Pricing）
料金プランは次の3プランです。
| プラン | 月額料金 | 主な機能 |
| --- | --- | --- |
| ベーシック | 3,300円 | 記帳と仕訳の自動化 |
| スタンダード | 5,500円 | 請求書発行と入金管理 |
| プレミアム | 8,800円 | 部門別管理とAPI連携 |`;

// §6 のステップは短い名詞句で、番号が連番に一致するため見出しとして
// 受理されてしまう（壁6-C）。本体はいずれも40字以内・コロンなし。
const STEP_TEXTS = [
  '現状の経理業務の棚卸しと課題の洗い出し',
  '無料トライアルの開始と初期設定',
  '既存データの移行と勘定科目の設定',
  '運用ルールの策定と担当者への説明会',
  '本稼働の開始と効果測定',
];
const SEC6_NUMBERED = `## 6. 導入ステップ（5つのステップ）
${STEP_TEXTS.map((step, index) => `${index + 1}. ${step}`).join('\n')}`;
const SEC6_BULLETS = `## 6. 導入ステップ（5つのステップ）
${STEP_TEXTS.map((step) => `- ${step}`).join('\n')}`;

const SEC7_CASE = `## 7. サンプルケース（仮想事例）
従業員45名の製造業、A社の導入事例です。
- 経理担当者は1名で、月末に請求処理が集中していました
- 導入後は月の経理業務が80時間から55時間に減りました
- 請求書の発行ミスがなくなり、入金確認も早くなりました
- 年間で約300万円のコスト削減が見込まれています
- 経営者が月次の数字を早く把握できるようになりました`;

const QUESTION_TEXTS = [
  '重点的にアピールしたい業種やサービスを教えてください。',
  '予算感や導入希望時期を教えてください。',
];
const CLOSING_QUESTIONS = `**次のステップのためのご質問（2点）**
1. ${QUESTION_TEXTS[0]}
2. ${QUESTION_TEXTS[1]}`;

function buildShape(sec1: string, sec6: string, closing: string = CLOSING_QUESTIONS): string {
  return [
    TITLE_H1,
    INTRO,
    sec1,
    SEC2_CUSTOMER,
    SEC3_BENEFITS,
    SEC4_FEATURES,
    SEC5_PRICING,
    sec6,
    SEC7_CASE,
    closing,
  ].join('\n\n');
}

// W20（報告書の B）: 本番形状#6。failureShape の全11項目が本番実測と一致する。
const W20_PRODUCTION_SHAPE = buildShape(SEC1_PROSE, SEC6_NUMBERED);
// W21（報告書の B2）: §1 に要点の箇条書き3点を追加し、要約材料を充足した形。
const W21_SUMMARY_SUFFICIENT = buildShape(SEC1_WITH_POINTS, SEC6_NUMBERED);
// W22（報告書の C）: W21 の §6 ステップを箇条書きにした形。この形では連番が
// 進まないため、締めの質問 1.・2. が連番に一致して見出し化し、締め節ごと
// 蒸発する。報告書の E2（E に §1 の箇条書きを足した形）は構成上この W22 と
// 同一の文書になる。
const W22_BULLET_STEPS = buildShape(SEC1_WITH_POINTS, SEC6_BULLETS);
// W23（報告書の E）: §6 ステップだけを箇条書きにした形（要約は不足のまま）。
const W23_BULLET_STEPS_SHORT_SUMMARY = buildShape(SEC1_PROSE, SEC6_BULLETS);

// W24（報告書の D）: 締めに依頼事項とステップの箇条書きを持つ形。
// fix-6 以前から変換でき、nextSteps は締め節由来であることが仕様。
const D_ASK = 'ご希望のプランと、無料トライアルの開始時期をご指定ください';
const D_STEP_TEXTS = [
  'ご希望のプランをお選びください',
  '無料トライアルの申し込み手続きを進めてください',
  '導入相談の日程をご調整ください',
];
const CLOSING_WITH_STEPS = `**次のステップ**
依頼事項：${D_ASK}
${D_STEP_TEXTS.map((step) => `- ${step}`).join('\n')}`;
const W24_CLOSING_WITH_CONTENT = buildShape(SEC1_WITH_POINTS, SEC6_NUMBERED, CLOSING_WITH_STEPS);

// 否定テスト用: 番号付き見出し＋本文のある正規の節構成。降格の対象は
// 「中身が完全に無い」微小節だけであり、この形の節は一切まとめられない。
const NUMBERED_SECTIONS_WITH_BODY = `中小企業向けクラウド会計サービスの導入提案です。
1. 提案の要点
- 経理業務の時間を30%削減できます
- 月額3,300円から始められます
- 導入は最短1週間で完了します
2. 主なメリット
本サービスの主なメリットは次のとおりです。
- 明細を自動で取り込み、手入力が不要になります
- 経営数値をリアルタイムに確認できます
3. 料金プラン
料金プランは次のとおりです。
- ベーシック：月額3,300円
- スタンダード：月額5,500円
4. 導入事例
導入事例は次のとおりです。
- 製造業のA社では月の経理業務が80時間から55時間に減りました
- 小売業のB社では請求書発行の手間が大幅に減りました
5. 次のステップ
- 無料トライアルをお申し込みください
- 導入相談の日時をご指定ください`;

// 否定テスト用: 締め節が存在しない markdown 文書。計画節に箇条書きが
// あっても、FIX6-1 の受け皿は締め節の実在を条件とするため開かない。
const MARKDOWN_WITHOUT_CLOSING = `# 中小企業向けクラウド会計サービスのご提案
本資料は、中小企業向けクラウド会計サービスの販促提案の本文です。

## 1. 提案の要点（Bottom line）
- 経理業務の時間を30%削減できます
- 月額3,300円から始められる料金プランです
- 導入は最短1週間で完了します

## 2. 主なメリット（Benefits）
主なメリットは次のとおりです。
- 明細を自動で取り込み、手入力が不要になります
- 経営数値をリアルタイムに確認できます

## 3. 導入計画
- 現状の経理業務の棚卸しを行います
- 無料トライアルを開始します
- 本稼働へ移行します`;

// 否定テスト用: 番号付き手順リストだけの回答。降格で微小節が先頭節の
// 箇条書きへ戻っても、中身のある節は1件しかできず資料化されない。
const PROCEDURE_ONLY = `プリンターのインクを交換する手順を説明します。
1. 電源を入れたままカバーを開けます
2. 古いカートリッジを取り外します
3. 新しいカートリッジを差し込みます
4. カバーを閉じてテスト印刷をします
5. 印刷結果を確認して完了です`;

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

describe('parseProposalDeckSkeleton free-form fallback v6 (2026-11-14 sixth production failure)', () => {
  it('W20: reproduces the production failure shape of the sixth failure (all 11 items)', () => {
    expect(summarizeProposalDeckAnswerShape(W20_PRODUCTION_SHAPE)).toEqual({
      totalChars: 1564,
      markdownHeadingCount: 8,
      numberedHeadingCount: 7,
      bracketStandaloneLineCount: 0,
      boldLabelLineCount: 1,
      bulletLineCount: 15,
      tableRowCount: 12,
      rejectedHeadingCount: 2,
      rejectedHeadingTooLongCount: 0,
      rejectedHeadingColonCount: 0,
      rejectedHeadingSequenceMismatchCount: 2,
    });
  });

  it('W20: stays null because the summary material is a single prose sentence (specification)', () => {
    expect(parseProposalDeckSkeleton(W20_PRODUCTION_SHAPE)).toBeNull();
  });

  it('W21: converts B2 — demoted steps restore the plan section and feed nextSteps (FIX6-1 + FIX6-2)', () => {
    const { input } = expectConvertible(W21_SUMMARY_SUFFICIENT);
    expect(input.title).toBe('中小企業向けクラウド会計サービス');
    expect(input.summary.points).toEqual(SEC1_POINT_TEXTS);
    expect(input.sections.map((section) => section.role)).toEqual([
      'other',
      'value',
      'solution',
      'cost',
      'plan',
      'other',
    ]);
    // 計画節はステップ5件を箇条書きとして保持する（デッキ側は上限4件）。
    const plan = input.sections.find((section) => section.role === 'plan');
    expect(plan!.bullets.map((bullet) => bullet.lead)).toEqual(STEP_TEXTS.slice(0, 4));
    // 締めは質問だけなので、nextSteps は計画節からの流用で充足される。
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
    // 締めの質問2件は前提・未確認事項へ振り分けられる。
    expect(input.assumptions).toEqual(QUESTION_TEXTS);
  });

  it('W22: converts C (= E2) — questions swallowed as headings return via demotion into assumptions', () => {
    const { input } = expectConvertible(W22_BULLET_STEPS);
    expect(input.summary.points).toEqual(SEC1_POINT_TEXTS);
    expect(input.sections.map((section) => section.role)).toEqual([
      'other',
      'value',
      'solution',
      'cost',
      'plan',
      'other',
    ]);
    // §6 は箇条書きのまま計画節として残り、nextSteps の材料になる。
    expect(input.closing.nextSteps).toEqual(STEP_TEXTS);
    // 見出し化して蒸発していた質問2件が、降格で締め節に戻り前提へ入る。
    expect(input.assumptions).toEqual(QUESTION_TEXTS);
  });

  it('W23: stays null for E — closing and plan are repaired, but the summary is still short', () => {
    expect(parseProposalDeckSkeleton(W23_BULLET_STEPS_SHORT_SUMMARY)).toBeNull();
  });

  it('W24: converts D and keeps nextSteps sourced from the closing section (no tray interference)', () => {
    const { input } = expectConvertible(W24_CLOSING_WITH_CONTENT);
    expect(input.closing.ask).toBe(D_ASK);
    expect(input.closing.nextSteps).toEqual(D_STEP_TEXTS);
    expect(input.assumptions).toEqual([]);
  });

  it('does not demote numbered sections that carry body text', () => {
    const { input } = expectConvertible(NUMBERED_SECTIONS_WITH_BODY);
    expect(input.sections.map((section) => section.role)).toEqual(['value', 'cost', 'other']);
    const value = input.sections.find((section) => section.role === 'value');
    expect(value!.message).toBe('本サービスの主なメリットは次のとおりです。');
    expect(value!.bullets.map((bullet) => bullet.lead)).toEqual([
      '明細を自動で取り込み、手入力が不要になります',
      '経営数値をリアルタイムに確認できます',
    ]);
    const cost = input.sections.find((section) => section.role === 'cost');
    expect(cost!.message).toBe('料金プランは次のとおりです。');
    expect(cost!.bullets.map((bullet) => bullet.lead)).toEqual(['ベーシック', 'スタンダード']);
    expect(input.closing.nextSteps).toEqual([
      '無料トライアルをお申し込みください',
      '導入相談の日時をご指定ください',
    ]);
  });

  it('keeps the plan-bullet tray shut for a markdown document without a closing section', () => {
    expect(parseProposalDeckSkeleton(MARKDOWN_WITHOUT_CLOSING)).toBeNull();
  });

  it('returns null for a numbered procedure list only (demotion fabricates no sections)', () => {
    expect(parseProposalDeckSkeleton(PROCEDURE_ONLY)).toBeNull();
  });

  it('is deterministic for the W21 shape', () => {
    expect(parseProposalDeckSkeleton(W21_SUMMARY_SUFFICIENT)).toEqual(
      parseProposalDeckSkeleton(W21_SUMMARY_SUFFICIENT),
    );
  });
});
