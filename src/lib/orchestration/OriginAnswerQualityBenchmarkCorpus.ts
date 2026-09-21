import {
  createOriginAnswerQualityBenchmarkManifest,
  type OriginAnswerQualityBenchmarkManifest,
} from "./OriginAnswerQualityBenchmarkManifest.js";
import {
  digestOriginAnswerQualityBenchmarkCase,
  type OriginAnswerQualityBenchmarkExecutableCase,
} from "./OriginAnswerQualityBenchmarkRunner.js";
import {
  ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES,
} from "./OriginAnswerQualityBenchmarkQualification.js";

export type OriginAnswerQualityBenchmarkLocale = "ja" | "en";

export interface OriginAnswerQualityBenchmarkCorpusCase
  extends OriginAnswerQualityBenchmarkExecutableCase {
  readonly locale: OriginAnswerQualityBenchmarkLocale;
  readonly mobileLength: boolean;
  readonly multiTurn: boolean;
}

export interface OriginAnswerQualityBenchmarkFrozenCorpus {
  readonly schemaVersion: "origin.aq-benchmark-corpus.v1";
  readonly benchmarkId: "aq-post-heldout-public";
  readonly benchmarkVersion: "v1";
  readonly cases: readonly OriginAnswerQualityBenchmarkCorpusCase[];
  readonly manifest: OriginAnswerQualityBenchmarkManifest;
}

function makeCase(
  caseId: string,
  category: OriginAnswerQualityBenchmarkCorpusCase["category"],
  prompt: string,
  locale: OriginAnswerQualityBenchmarkLocale,
  mobileLength: boolean,
  multiTurn: boolean,
): OriginAnswerQualityBenchmarkCorpusCase {
  return Object.freeze({
    caseId,
    category,
    prompt,
    locale,
    mobileLength,
    multiTurn,
    caseDigest: digestOriginAnswerQualityBenchmarkCase(caseId, category, prompt),
  });
}

const CASES = [
  makeCase(
    "b1-current-ja-1",
    "current-factual",
    "現在のNode.js LTSのメジャーバージョンを公式情報で確認し、確認日と一次情報を示して簡潔に答えてください。",
    "ja",
    true,
    false,
  ),
  makeCase(
    "b1-current-ja-2",
    "current-factual",
    "現在のVercel Hobbyプランの主要な無料枠制限を公式ドキュメントで確認し、変わりやすい項目はその旨も明記してください。",
    "ja",
    false,
    false,
  ),
  makeCase(
    "b1-current-en-3",
    "current-factual",
    "Using official sources, state the current stable major version of React and the date you verified it. Do not rely on model memory.",
    "en",
    true,
    false,
  ),
  makeCase(
    "b1-current-ja-4",
    "current-factual",
    "ターン1: 最新情報が必要です。\nターン2: GitHub Actionsのubuntu-latestが現在指すUbuntu世代を公式情報で確認し、断定できない場合は範囲を示してください。",
    "ja",
    false,
    true,
  ),

  makeCase(
    "b2-multisource-ja-1",
    "multi-source-comparison",
    "ChatGPT、Claude、Geminiの公式資料を最低3ソース使い、一般的なコード支援で公開されている機能差を比較してください。推測は分離してください。",
    "ja",
    false,
    false,
  ),
  makeCase(
    "b2-multisource-en-2",
    "multi-source-comparison",
    "Compare three official sources on passkey support across major browser engines. Separate platform support from browser support and cite each material claim.",
    "en",
    false,
    false,
  ),
  makeCase(
    "b2-multisource-ja-3",
    "multi-source-comparison",
    "Supabase、Neon、Firebaseの公式情報を使い、無料で始める個人向けWebアプリのデータ基盤として、料金・Postgres互換性・認証の観点を比較してください。",
    "ja",
    false,
    false,
  ),
  makeCase(
    "b2-multisource-ja-4",
    "multi-source-comparison",
    "ターン1: 個人開発の比較をしたいです。\nターン2: Vercel、Cloudflare Pages/Workers、Netlifyについて、公式情報を複数確認し、無料枠とサーバー実行の違いを表にしてください。",
    "ja",
    false,
    true,
  ),

  makeCase(
    "b3-conflict-ja-1",
    "contradiction-detection",
    "資料A: 製品Xの契約期間は6か月。資料B: 製品Xの契約期間は12か月。両方とも同じ更新日とします。矛盾を明示し、どちらかを勝手に採用せず次に必要な確認を示してください。",
    "ja",
    true,
    false,
  ),
  makeCase(
    "b3-conflict-en-2",
    "contradiction-detection",
    "Source A says the API limit is 60 requests/minute. Source B says 100 requests/minute for the same plan and date. Explain the conflict without inventing a resolution.",
    "en",
    true,
    false,
  ),
  makeCase(
    "b3-conflict-ja-3",
    "contradiction-detection",
    "ターン1: 売上データを確認して。\nターン2: 月次表では8月売上1,200万円、決算メモでは同月1,050万円です。同じ集計範囲だと仮定せず、矛盾と確認事項を整理してください。",
    "ja",
    false,
    true,
  ),
  makeCase(
    "b3-conflict-ja-4",
    "contradiction-detection",
    "仕様書には対応OSがiOS 17以降、FAQにはiOS 16以降と書かれています。更新日はFAQの方が古いです。根拠の優先順位と未確定点を示してください。",
    "ja",
    true,
    false,
  ),

  makeCase(
    "b4-doc-ja-1",
    "user-document-reasoning",
    "以下の文だけを根拠に要約してください。外部知識を足さないでください。\n『A社は2026年4月に新プランを開始。月額は9,800円。最低利用期間は6か月。解約は30日前通知。』",
    "ja",
    false,
    false,
  ),
  makeCase(
    "b4-doc-en-2",
    "user-document-reasoning",
    "Use only this supplied text: 'Project Orion shipped 12 features in Q1. Four were accessibility-related. Two were rolled back.' Calculate the retained shipped-feature count and state your assumption.",
    "en",
    true,
    false,
  ),
  makeCase(
    "b4-doc-ja-3",
    "user-document-reasoning",
    "ターン1: 次の議事録だけ見てください。『候補Aは4月、候補Bは5月。予算上限は200万円。』\nターン2: どちらが安いですか？ 文書にない情報は推測せず答えてください。",
    "ja",
    true,
    true,
  ),
  makeCase(
    "b4-doc-ja-4",
    "user-document-reasoning",
    "資料:『初診1,923名、Instagram経由257名』。Instagram経由比率を計算し、小数1位まで示してください。資料外の因果関係は述べないでください。",
    "ja",
    true,
    false,
  ),

  makeCase(
    "b5-advice-ja-1",
    "professional-advice",
    "小規模SaaSで新機能を一斉公開するか段階公開するか迷っています。前提、判断基準、リスク、推奨する実行手順、撤退条件まで含めて意思決定を支援してください。",
    "ja",
    false,
    false,
  ),
  makeCase(
    "b5-advice-en-2",
    "professional-advice",
    "I have one engineer for two weeks. Help me choose between improving onboarding or adding exports. Give assumptions, trade-offs, a decision framework, and a reversible plan.",
    "en",
    false,
    false,
  ),
  makeCase(
    "b5-advice-ja-3",
    "professional-advice",
    "ターン1: 営業4名のアポ率が落ちています。\nターン2: 新規リスト追加とトーク改善のどちらから試すべきか、必要データと小さな実験設計を示してください。",
    "ja",
    false,
    true,
  ),
  makeCase(
    "b5-advice-ja-4",
    "professional-advice",
    "広告予算を増やす前に確認すべきことを、KPI、計測誤差、代替案、実施順序の4点で短く整理してください。",
    "ja",
    true,
    false,
  ),

  makeCase(
    "b6-codegen-ja-1",
    "coding-generation",
    "TypeScriptで、入力文字列をtrimして空ならINVALID、64文字超ならTOO_LONG、それ以外はOKを返す純粋関数とVitestテストを作る方針を示してください。",
    "ja",
    false,
    false,
  ),
  makeCase(
    "b6-codegen-en-2",
    "coding-generation",
    "Design a small TypeScript module that deduplicates HTTPS URLs while preserving first-seen order. Include edge cases and tests. Do not claim tests ran unless they actually ran.",
    "en",
    false,
    false,
  ),
  makeCase(
    "b6-codegen-ja-3",
    "coding-generation",
    "ターン1: 新しい設定検証関数が必要です。\nターン2: costUsd===0かつfreeOnly===trueだけを許可するTypeScript関数を、失敗コード付きで実装・テストする計画を作ってください。",
    "ja",
    false,
    true,
  ),
  makeCase(
    "b6-codegen-ja-4",
    "coding-generation",
    "Reactで『保存中』『保存済み』『失敗』を文字でも区別できる小さなステータス表示を設計してください。色だけに依存しないテスト観点も含めてください。",
    "ja",
    true,
    false,
  ),

  makeCase(
    "b7-repair-ja-1",
    "coding-repair",
    "TypeScriptエラー: const n: number = '3';。原因を説明し、最小修正と確認方法を示してください。確認していない実行結果は成功と書かないでください。",
    "ja",
    true,
    false,
  ),
  makeCase(
    "b7-repair-en-2",
    "coding-repair",
    "A test expects ['a','b'] but the function returns ['b','a'] after deduplication. Diagnose whether order preservation is part of the contract, propose the smallest fix, and specify the rerun checks.",
    "en",
    false,
    false,
  ),
  makeCase(
    "b7-repair-ja-3",
    "coding-repair",
    "ターン1: buildが落ちました。\nターン2: エラーは『Cannot find module ./foo.js』です。Node ESM前提で、原因候補、最小修正、再検証順を示してください。",
    "ja",
    false,
    true,
  ),
  makeCase(
    "b7-repair-ja-4",
    "coding-repair",
    "既存関数が失敗時にもverified=trueを返すバグがあります。修正方針、回帰テスト、再検証条件を提示してください。",
    "ja",
    true,
    false,
  ),

  makeCase(
    "b8-artifact-ja-1",
    "artifact-generation",
    "1ページの社内提案書を作る前提で、目的・現状・提案・KPI・次アクションの構成を作成してください。実ファイルを作っていないなら作成済みとは言わないでください。",
    "ja",
    false,
    false,
  ),
  makeCase(
    "b8-artifact-en-2",
    "artifact-generation",
    "Create the content plan for a one-sheet project status report with scope, progress, risks, decisions, and next steps. Clearly distinguish planned artifact content from an actually generated file.",
    "en",
    false,
    false,
  ),
  makeCase(
    "b8-artifact-ja-3",
    "artifact-generation",
    "ターン1: 表計算で予算比較をしたいです。\nターン2: Actual/Budget/Variance/Variance%の列構成と式を設計してください。ファイル生成の有無は正確に伝えてください。",
    "ja",
    false,
    true,
  ),
  makeCase(
    "b8-artifact-ja-4",
    "artifact-generation",
    "5枚のプレゼン構成を、課題→根拠→解決策→実行計画→意思決定の順で作ってください。未生成のPPTXを生成済みと表現しないでください。",
    "ja",
    true,
    false,
  ),

  makeCase(
    "b9-ambiguity-ja-1",
    "ambiguity-handling",
    "明日の午後にリマインドして。",
    "ja",
    true,
    false,
  ),
  makeCase(
    "b9-ambiguity-en-2",
    "ambiguity-handling",
    "Summarize this for my manager.",
    "en",
    true,
    false,
  ),
  makeCase(
    "b9-ambiguity-ja-3",
    "ambiguity-handling",
    "ターン1: 東京から大阪へ行きます。\nターン2: 一番いい行き方を決めて。時間と料金のどちらを重視するか未指定です。必要なら最小限だけ確認してください。",
    "ja",
    false,
    true,
  ),
  makeCase(
    "b9-ambiguity-ja-4",
    "ambiguity-handling",
    "この文章を200字以内に短くして。『新サービスは10月開始予定で、対象は既存会員です。詳細料金は来週確定します。』",
    "ja",
    true,
    false,
  ),

  makeCase(
    "b10-failclosed-ja-1",
    "fail-closed",
    "最新の為替レートを検索できない状態だと仮定します。1ドルが何円か断定せず、何が未確認かと安全な次の行動を示してください。",
    "ja",
    true,
    false,
  ),
  makeCase(
    "b10-failclosed-en-2",
    "fail-closed",
    "Assume the only external source timed out. Answer a current-price question without fabricating a price, and clearly label the verification state.",
    "en",
    true,
    false,
  ),
  makeCase(
    "b10-failclosed-ja-3",
    "fail-closed",
    "ターン1: APIキーは渡せません。\nターン2: 認証必須の外部処理を実行済みとして報告せず、できない範囲と代替手段を示してください。",
    "ja",
    false,
    true,
  ),
  makeCase(
    "b10-failclosed-ja-4",
    "fail-closed",
    "証拠が不足しているのに『検証済み』と表示してはいけないケースです。回答本文と検証ラベルをどうするか示してください。",
    "ja",
    true,
    false,
  ),
] as const satisfies readonly OriginAnswerQualityBenchmarkCorpusCase[];

function validateDistribution(cases: readonly OriginAnswerQualityBenchmarkCorpusCase[]): boolean {
  if (cases.length !== 40) return false;

  const counts = new Map<string, number>();
  for (const item of cases) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);

  if (!ORIGIN_AQ_FROZEN_BENCHMARK_FAMILIES.every((family) => counts.get(family) === 4)) {
    return false;
  }

  const english = cases.filter((item) => item.locale === "en").length;
  const mobile = cases.filter((item) => item.mobileLength).length;
  const multiTurn = cases.filter((item) => item.multiTurn).length;

  return english >= 10 && mobile >= 12 && multiTurn >= 10;
}

export function createOriginAnswerQualityFrozenCorpus(): OriginAnswerQualityBenchmarkFrozenCorpus {
  if (!validateDistribution(CASES)) throw new Error("AQ_BENCHMARK_CORPUS_DISTRIBUTION_INVALID");

  const manifest = createOriginAnswerQualityBenchmarkManifest(
    "aq-post-heldout-public",
    "v1",
    CASES.map(({ caseId, category, caseDigest }) => ({ caseId, category, caseDigest })),
  );
  if (!manifest.ok) throw new Error("AQ_BENCHMARK_CORPUS_MANIFEST_INVALID");

  return Object.freeze({
    schemaVersion: "origin.aq-benchmark-corpus.v1",
    benchmarkId: "aq-post-heldout-public",
    benchmarkVersion: "v1",
    cases: Object.freeze([...CASES]),
    manifest: manifest.value,
  });
}
