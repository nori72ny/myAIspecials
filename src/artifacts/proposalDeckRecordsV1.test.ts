import { describe, expect, it } from 'vitest';
import {
  buildDeckDraftUnits,
  buildDeckMaterialUnits,
  checkDeckNumericPreservation,
  checkDeckVerbatim,
  deckMaterialSourceKindFromId,
  DECK_RECORDS_MAX_UNITS_PER_MATERIAL,
} from './proposalDeckRecordsV1';

// 資料レコード再設計 D-PR-1（材料レコードの基盤）の恒常テスト。
// 設計正本: ~/workspace/origin-fix/DECK_RECORDS_REDESIGN_2026-11-15.md
// - 単位分割の境界規則は統合レコード方式 §3.2 と同一であることを、
//   V13 の分割テストと同じ入力で固定する（実装は V13 を共有）。
// - 回帰フィクスチャとして、トリアージ#11 のフィクスチャ K 群
//   （~/workspace/origin-fix/PROPOSAL_FALLBACK_TRIAGE11_2026-11-15.md、
//   恒常テストは proposalDeckSkeletonV1.fallbackV11.test.ts）の
//   文面を、材料分割・逐語照合・数値照合の観点で取り込む。

function texts(material: string): string[] {
  return buildDeckMaterialUnits(material).map((unit) => unit.text);
}

describe('buildDeckMaterialUnits: sentence segmentation (shared §3.2 rules)', () => {
  it('splits basic Japanese sentences and assigns sequential M-IDs', () => {
    const units = buildDeckMaterialUnits('料金は100円です。次に説明します。以上が概要です。');
    expect(units.map((unit) => unit.text)).toEqual([
      '料金は100円です。',
      '次に説明します。',
      '以上が概要です。',
    ]);
    expect(units.map((unit) => unit.id)).toEqual(['M1', 'M2', 'M3']);
    expect(units.every((unit) => unit.sourceKind === 'user-material')).toBe(true);
    expect(units.every((unit) => unit.kind === 'sentence')).toBe(true);
  });

  it('does not split at a terminator inside brackets', () => {
    expect(texts('彼は「今日は行く。」と静かに言った。そして家を出た。')).toEqual([
      '彼は「今日は行く。」と静かに言った。',
      'そして家を出た。',
    ]);
    expect(texts('（注記）価格は据え置きである。次の議題へ進む。')).toEqual([
      '（注記）価格は据え置きである。',
      '次の議題へ進む。',
    ]);
  });

  it('does not split at a decimal point', () => {
    const result = texts('金利は3.5%に引き上げられた。今後も注視が必要である。');
    expect(result).toEqual(['金利は3.5%に引き上げられた。', '今後も注視が必要である。']);
    expect(result[0]).toContain('3.5%');
  });

  it('does not split inside domains or version strings', () => {
    expect(texts('詳細はexample.comを確認すること。追加の説明文である。')).toEqual([
      '詳細はexample.comを確認すること。',
      '追加の説明文である。',
    ]);
    expect(texts('バージョン1.2.3が公開された。変更点は多岐にわたる。')).toEqual([
      'バージョン1.2.3が公開された。',
      '変更点は多岐にわたる。',
    ]);
  });

  it('treats an ASCII period as a terminator before whitespace + uppercase or a Japanese character', () => {
    expect(texts('The price is 100 dollars. It rose sharply today.')).toEqual([
      'The price is 100 dollars.',
      'It rose sharply today.',
    ]);
    expect(texts('処理が完了した. 次の工程へ進むこと。')).toEqual([
      '処理が完了した.',
      '次の工程へ進むこと。',
    ]);
  });

  it('absorbs closing quotes and terminator runs into the sentence that just ended', () => {
    expect(texts('結果は"想定以上であった。"と報告されたのである。次の議題に移る。')).toEqual([
      '結果は"想定以上であった。"',
      'と報告されたのである。',
      '次の議題に移る。',
    ]);
    expect(texts('それは本当なのか？！驚きの結果である。')).toEqual([
      'それは本当なのか？！',
      '驚きの結果である。',
    ]);
  });

  it('merges a unit shorter than 8 characters into the previous unit', () => {
    expect(texts('これは十分な長さの最初の文です。短い。次も十分な長さの文です。')).toEqual([
      'これは十分な長さの最初の文です。短い。',
      '次も十分な長さの文です。',
    ]);
  });

  it('keeps a short first unit as its own unit (it has no predecessor)', () => {
    expect(texts('短い。十分な長さの二番目の文です。')).toEqual([
      '短い。',
      '十分な長さの二番目の文です。',
    ]);
  });

  it('keeps a trailing fragment without a terminator as its own unit', () => {
    expect(texts('これは十分な長さの最初の文です。末尾の断片テキスト')).toEqual([
      'これは十分な長さの最初の文です。',
      '末尾の断片テキスト',
    ]);
  });

  it('does not split enumerations on ・', () => {
    expect(texts('対象は東京・大阪・名古屋の三都市である。')).toEqual([
      '対象は東京・大阪・名古屋の三都市である。',
    ]);
  });

  it('returns no units for empty or whitespace-only input', () => {
    expect(buildDeckMaterialUnits('')).toEqual([]);
    expect(buildDeckMaterialUnits('  \n\n  ')).toEqual([]);
  });

  it('caps units per material by merging the overflow into the last unit', () => {
    const material = Array.from(
      { length: DECK_RECORDS_MAX_UNITS_PER_MATERIAL + 5 },
      (_, i) => `これは${i + 1}番目の十分な長さの文です。`,
    ).join('');
    const units = buildDeckMaterialUnits(material);
    expect(units).toHaveLength(DECK_RECORDS_MAX_UNITS_PER_MATERIAL);
    expect(units[0].text).toBe('これは1番目の十分な長さの文です。');
    const last = units[DECK_RECORDS_MAX_UNITS_PER_MATERIAL - 1];
    expect(last.text).toContain('100番目の');
    expect(last.text).toContain('105番目の');
    expect(last.id).toBe(`M${DECK_RECORDS_MAX_UNITS_PER_MATERIAL}`);
  });

  it('is deterministic', () => {
    const material = '料金は100円です。次に説明します。\n- 補足の箇条書きです';
    expect(buildDeckMaterialUnits(material)).toEqual(buildDeckMaterialUnits(material));
  });
});

describe('buildDeckMaterialUnits: bullet lines and tables', () => {
  it('treats each bullet line as one unit and strips the marker', () => {
    const units = buildDeckMaterialUnits(
      ['- 導入コストを抑えられます', '・月額料金は3,500円です', '* 導入支援が含まれます'].join('\n'),
    );
    expect(units.map((unit) => unit.text)).toEqual([
      '導入コストを抑えられます',
      '月額料金は3,500円です',
      '導入支援が含まれます',
    ]);
    expect(units.every((unit) => unit.kind === 'bullet')).toBe(true);
  });

  it('treats numbered lines as bullet units', () => {
    const units = buildDeckMaterialUnits(
      ['1. 経理担当者が少なく、月末に業務が集中している', '2. 紙の領収書や請求書の管理に時間がかかっている'].join('\n'),
    );
    expect(units.map((unit) => unit.text)).toEqual([
      '経理担当者が少なく、月末に業務が集中している',
      '紙の領収書や請求書の管理に時間がかかっている',
    ]);
    expect(units.every((unit) => unit.kind === 'bullet')).toBe(true);
  });

  it('does not treat prose starting with a year or a decimal as a bullet line', () => {
    expect(texts('2024年の売上は増加しました。翌年も伸びています。')).toEqual([
      '2024年の売上は増加しました。',
      '翌年も伸びています。',
    ]);
    expect(texts('3.5%の成長を見込んでいます。今後の見通しです。')).toEqual([
      '3.5%の成長を見込んでいます。',
      '今後の見通しです。',
    ]);
  });

  it('does not sentence-split inside a bullet line', () => {
    const units = buildDeckMaterialUnits('- 内容：現状の課題は次の2点です。いずれも日々の業務に直結する問題です。');
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe('bullet');
    expect(units[0].text).toBe('内容：現状の課題は次の2点です。いずれも日々の業務に直結する問題です。');
  });

  it('keeps a whole table as one unit', () => {
    const table = ['| プラン | 月額 |', '| --- | --- |', '| ベーシック | 3,500円 |'].join('\n');
    const units = buildDeckMaterialUnits(table);
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe('table');
    expect(units[0].text).toBe(table);
  });

  it('preserves the material order across prose, bullets and tables', () => {
    const material = [
      '導入の文章です。背景を説明します。',
      '- 箇条書きの項目です',
      '| 項目 | 値 |',
      '| --- | --- |',
      '| 価格 | 3,500円 |',
      '締めの文章です。',
    ].join('\n');
    const units = buildDeckMaterialUnits(material);
    expect(units.map((unit) => unit.kind)).toEqual(['sentence', 'sentence', 'bullet', 'table', 'sentence']);
    expect(units.map((unit) => unit.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    expect(units[3].text).toContain('3,500円');
  });
});

describe('buildDeckDraftUnits and ID prefixes', () => {
  it('assigns sequential D-IDs with model-draft source kind', () => {
    const units = buildDeckDraftUnits([
      { text: '経理業務の負担が大きくなっています。' },
      { text: '自動仕訳で入力作業を削減できます', kind: 'bullet' },
    ]);
    expect(units.map((unit) => unit.id)).toEqual(['D1', 'D2']);
    expect(units.every((unit) => unit.sourceKind === 'model-draft')).toBe(true);
    expect(units[0].kind).toBe('sentence');
    expect(units[1].kind).toBe('bullet');
  });

  it('skips empty entries without consuming an ID number', () => {
    const units = buildDeckDraftUnits([{ text: '  ' }, { text: '唯一の単位です。' }]);
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe('D1');
  });

  it('distinguishes source kind by ID prefix', () => {
    expect(deckMaterialSourceKindFromId('M1')).toBe('user-material');
    expect(deckMaterialSourceKindFromId('M42')).toBe('user-material');
    expect(deckMaterialSourceKindFromId('D1')).toBe('model-draft');
    expect(deckMaterialSourceKindFromId('D7')).toBe('model-draft');
    // 統合側の ID 空間や不正な形は、資料側の種別に読み替えない。
    expect(deckMaterialSourceKindFromId('E1_1')).toBeNull();
    expect(deckMaterialSourceKindFromId('S1')).toBeNull();
    expect(deckMaterialSourceKindFromId('M')).toBeNull();
    expect(deckMaterialSourceKindFromId('')).toBeNull();
  });
});

describe('checkDeckVerbatim', () => {
  const units = buildDeckMaterialUnits(
    ['本サービスは、会計業務の自動化を支援するクラウド型のサービスです。', '- 月額は3,500円です'].join('\n'),
  );

  it('accepts every unit text verbatim', () => {
    const result = checkDeckVerbatim(units.map((unit) => unit.text), units);
    expect(result.ok).toBe(true);
    expect(result.checkedCount).toBe(2);
    expect(result.unmatchedTexts).toEqual([]);
  });

  it('rejects a paraphrased text that is not a unit', () => {
    const result = checkDeckVerbatim(['本サービスは会計業務を自動化する便利なサービスです。'], units);
    expect(result.ok).toBe(false);
    expect(result.unmatchedTexts).toEqual(['本サービスは会計業務を自動化する便利なサービスです。']);
  });

  it('rejects a partial substring of a unit (membership, not substring)', () => {
    const result = checkDeckVerbatim(['会計業務の自動化を支援する'], units);
    expect(result.ok).toBe(false);
    expect(result.unmatchedTexts).toEqual(['会計業務の自動化を支援する']);
  });

  it('accepts form-only variants under the shared normalization (commas, whitespace, NFKC)', () => {
    // 統合側と共有の正規化（NFKC・空白とカンマ類の除去）を通した一致は
    // 逐語として扱う。値の換算・丸めは等価扱いしない。
    expect(checkDeckVerbatim(['月額は3500円です'], units).ok).toBe(true);
    expect(checkDeckVerbatim(['月額は3,501円です'], units).ok).toBe(false);
  });

  it('skips empty placed texts', () => {
    const result = checkDeckVerbatim(['', '  '], units);
    expect(result.ok).toBe(true);
    expect(result.checkedCount).toBe(0);
  });
});

describe('checkDeckNumericPreservation', () => {
  it('accepts identical numeric multisets', () => {
    const result = checkDeckNumericPreservation(
      ['月額は3,500円です。初期費用は50,000円です。'],
      ['初期費用は50,000円です。', '月額は3,500円です。'],
    );
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  it('normalizes thousands separators and full-width digits before comparing', () => {
    expect(checkDeckNumericPreservation(['価格は３，５００円です'], ['価格は3500円です']).ok).toBe(true);
    expect(checkDeckNumericPreservation(['価格は1.50です'], ['価格は1.5です']).ok).toBe(true);
  });

  it('detects a dropped number as missing', () => {
    const result = checkDeckNumericPreservation(
      ['月額は3,500円です。初期費用は50,000円です。'],
      ['月額は3,500円です。'],
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([{ token: '50000', materialCount: 1, placedCount: 0 }]);
    expect(result.unexpected).toEqual([]);
  });

  it('detects an invented number as unexpected', () => {
    const result = checkDeckNumericPreservation(
      ['月額は3,500円です。'],
      ['月額は3,500円です。導入効果は30%改善です。'],
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([{ token: '30', materialCount: 0, placedCount: 1 }]);
  });

  it('detects an altered value as missing + unexpected', () => {
    const result = checkDeckNumericPreservation(['月額は3,500円です。'], ['月額は4,500円です。']);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([{ token: '3500', materialCount: 1, placedCount: 0 }]);
    expect(result.unexpected).toEqual([{ token: '4500', materialCount: 0, placedCount: 1 }]);
  });

  it('compares multiplicities, not just presence', () => {
    const result = checkDeckNumericPreservation(
      ['月額は3,500円です。', '追加料金も3,500円です。'],
      ['月額は3,500円です。'],
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([{ token: '3500', materialCount: 2, placedCount: 1 }]);
  });

  it('does not check units, targets or periods (documented scope, design §7.2)', () => {
    // 数字が逐語でも「月額」と「年額」の取り違えは本照合の対象外である
    // ことを固定する（保証範囲を広げて語らないための恒常テスト）。
    const result = checkDeckNumericPreservation(['月額3,500円のプランです。'], ['年額3,500円のプランです。']);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 回帰フィクスチャ: トリアージ#11 のフィクスチャ K 群
// （第11回本番失敗の再構成。文面は proposalDeckSkeletonV1.fallbackV11
// .test.ts の W39 系と同一の再構成であり、本番回答の原文そのもの
// ではない）。ここでは旧経路のパース結果ではなく、新経路の材料
// 分割・逐語照合・数値照合の観点で K の形を固定する。
// ---------------------------------------------------------------------------

const K_STEP_TEXTS = [
  '無料相談のお申し込み',
  'ヒアリングと現状確認',
  '導入支援と初期設定',
  '運用開始とサポート',
];
const K_SEC6 = `料金プランは事業規模に合わせて選べる3つのプランを用意しています。
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
| 追加容量 | 300円 | 10GBごと |
${K_STEP_TEXTS.map((step, index) => `${index + 1}. ${step}`).join('\n')}`;

const K_SEC2_BODY = `- タイトル：中小企業が抱える経理の課題
- 内容：現状の課題は次の2点です。いずれも日々の業務に直結する問題です。
1. 経理担当者が少なく、月末に業務が集中している
2. 紙の領収書や請求書の管理に時間がかかっている`;

const K_SEC3_BODY = `本サービスは、会計業務の自動化を支援するクラウド型のサービスです。
- タイトル：CloudAccounting Proの概要と特長
- 内容：銀行口座やクレジットカードと連携し、仕訳を自動化します。請求書の発行や入金の消込も一つの画面で行えます。
- 特長：自動仕訳で入力作業を削減できます`;

describe('fixture K (triage #11) as deck material', () => {
  it('K §6: the price table stays one unit and the numbered steps become bullet units', () => {
    const units = buildDeckMaterialUnits(K_SEC6);
    expect(units.map((unit) => unit.kind)).toEqual(['sentence', 'table', 'bullet', 'bullet', 'bullet', 'bullet']);
    expect(units[0].text).toBe('料金プランは事業規模に合わせて選べる3つのプランを用意しています。');
    // 表は11行（見出し＋区切り＋9データ行）を1単位のまま保持する。
    expect(units[1].text.split('\n')).toHaveLength(11);
    expect(units[1].text).toContain('| ベーシック | 3,500円 | 個人事業主 |');
    expect(units.slice(2).map((unit) => unit.text)).toEqual(K_STEP_TEXTS);
  });

  it('K §2 body: dash bullets and numbered lines are bullet units, unsplit', () => {
    const units = buildDeckMaterialUnits(K_SEC2_BODY);
    expect(units.map((unit) => unit.text)).toEqual([
      'タイトル：中小企業が抱える経理の課題',
      '内容：現状の課題は次の2点です。いずれも日々の業務に直結する問題です。',
      '経理担当者が少なく、月末に業務が集中している',
      '紙の領収書や請求書の管理に時間がかかっている',
    ]);
    expect(units.every((unit) => unit.kind === 'bullet')).toBe(true);
  });

  it('K §3: verbatim check passes for material units and rejects an invented composite sentence', () => {
    const units = buildDeckMaterialUnits(K_SEC3_BODY);
    expect(checkDeckVerbatim(units.map((unit) => unit.text), units).ok).toBe(true);
    // 架空の製品名を含む単位も「材料の逐語」としては通る。逐語照合が
    // 保証するのは出所（材料にある文字列か）であり、内容の真実性では
    // ない（設計 §7.6。生成側の作らないルールは G2 側の担当）。
    expect(checkDeckVerbatim(['タイトル：CloudAccounting Proの概要と特長'], units).ok).toBe(true);
    // 材料の断片を繋いだ合成文は、材料の逐語ではないため落ちる。
    const composite = checkDeckVerbatim(['CloudAccounting Proは月額3,500円から使える会計サービスです。'], units);
    expect(composite.ok).toBe(false);
    expect(composite.unmatchedTexts).toEqual(['CloudAccounting Proは月額3,500円から使える会計サービスです。']);
  });

  it('K §6: numeric preservation holds for the material as placed, and breaks on alteration or table loss', () => {
    const units = buildDeckMaterialUnits(K_SEC6);
    const materialTexts = units.map((unit) => unit.text);
    expect(checkDeckNumericPreservation(materialTexts, materialTexts).ok).toBe(true);

    const tableUnit = units.find((unit) => unit.kind === 'table')!;
    const altered = materialTexts.map((text) =>
      text === tableUnit.text ? text.replace('3,500円', '4,500円') : text,
    );
    const alteredResult = checkDeckNumericPreservation(materialTexts, altered);
    expect(alteredResult.ok).toBe(false);
    expect(alteredResult.missing).toEqual([{ token: '3500', materialCount: 1, placedCount: 0 }]);
    expect(alteredResult.unexpected).toEqual([{ token: '4500', materialCount: 0, placedCount: 1 }]);

    const withoutTable = units.filter((unit) => unit.kind !== 'table').map((unit) => unit.text);
    const droppedResult = checkDeckNumericPreservation(materialTexts, withoutTable);
    expect(droppedResult.ok).toBe(false);
    const missingTokens = droppedResult.missing.map((entry) => entry.token);
    for (const token of ['3500', '7500', '12000', '500', '1000', '30000', '50000', '8000', '300']) {
      expect(missingTokens).toContain(token);
    }
    // 散文側の「3つのプラン」の 3 は掲載側に残るため欠落にならない。
    expect(missingTokens).not.toContain('3');
  });

  it('K §6 segmentation is deterministic', () => {
    expect(buildDeckMaterialUnits(K_SEC6)).toEqual(buildDeckMaterialUnits(K_SEC6));
  });
});
