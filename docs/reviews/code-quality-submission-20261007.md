# ORIGIN コード品質検査 提出手順

## 検査対象

PR #917 の最終 head SHA を固定して検査してください。main と未統合PRは別の対象です。提出物の manifest.json に記録された sourceCommit を正とし、変更が入った場合は作り直してください。

## 再現手順

Node.js 22 または24、Git、npmを使用します。

1. リポジトリを取得し、提出対象の40桁SHAを checkout する。
2. `npm ci` を実行する。
3. `npm run lint`、`npm run build`、`npm test`、`npm run test:api` を実行し、終了コードとログを保存する。
4. `npm audit --json` と `npm audit --omit=dev --json` の結果を保存する。
5. `npm run eval:prepare` を実行する。
6. `results/code-review/<SHA>/` 内のソース資料と manifest.json を検査に渡す。GitHub上の対象SHAと、同じSHAのCI結果も添える。

CIのNode 22ジョブは提出資料を自動生成し、`code-review-packet-<SHA>` として30日間保管する。pull_requestのCIではGitHubが作る検証用マージコミットが対象になる場合がある。必ず資料内のsourceCommitを確認し、PR headそのものと区別する。

実行例の全体はGitHubのCIで再現する。ブラウザE2E、Lighthouse、CodeQL、Gitleaksの結果は該当SHAのActionsで確認し、古いSHAの合格を流用しない。

## 今回の提出準備の修正

- src/services だけでなく、server、API、packages、tests、scripts、CI、ルート設定を収集する。
- 作業中のファイルではなくGitの確定済み内容を読み、SHA・各ファイルのSHA-256・バイト数・除外一覧を記録する。
- .env、鍵ファイル、シンボリックリンク、未追跡ファイルを収集しない。
- `@istanbuljs/load-nyc-config` 配下のみ js-yaml 4.3.2 に固定し、旧argparseから入るsprintf-jsを除去する。全体の強制ダウングレードは行わない。YAMLの継承・配列・設定名変換・不正YAML拒否を互換性テストする。

## 検査範囲と報告形式

設計、保守性、型安全性、認証認可、入力検証、無料限定、秘密情報、コード実行隔離、キャンセル、依存関係、テストの妥当性、CIを確認する。

指摘ごとに重要度、対象SHA、ファイル・行、再現方法、影響、修正案、再検証結果を記載する。判定はPASS / FAIL / NOT VERIFIED / NOT APPLICABLEを分ける。

## 明示的な検査限界

- APIのlifecycle.live.test.tsは、RUN_LIVE_PROVIDER_TESTS=true とGeminiの認証設定を要求する任意の実プロバイダ試験。通常のAPI試験では1件スキップされる。スキップを成功件数に含めない。
- この提出準備のために実プロバイダ試験を無条件で有効化しない。無料利用の確認や必要設定なしに課金可能な呼び出しを行わない。
- ソース・CI検査の開始に実プロバイダ試験は必須ではないが、AIの実性能や本番全機能の合格判定には別途実測が必要。
- 生成されたコード資料はコミット済みソースの抜粋。除外一覧も確認する。名前による除外だけでは秘密情報の不存在を証明できないため、対象SHAのGitleaks結果も確認する。
- 他AIを上回る品質、画像生成、回答精度、生成アプリの完成度をこのコード検査だけで認定しない。
- 本番へのマージ・公開はこの提出手順に含まない。
