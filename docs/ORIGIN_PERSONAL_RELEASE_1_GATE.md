# ORIGIN Personal 一次公開ゲート

Status: Release decision record

Owner: ノリさん

Candidate branch: `infra/cloud-run-production-path`

Last aligned: 2026-08-02

## 公開するもの

一次公開は、ノリさんが日常利用するためのORIGIN Personalを対象とする。

- ホーム、チャット、設定
- 正式な`/api/chat`境界
- 無料と確認できるOpenRouterの`:free`モデルによる単独AI実行
- 回答、出典確認範囲、独立した別AI確認の有無、実費用、実行制約の正確な表示
- 秘密情報の入力遮断と、無料・routing証拠を確認できない場合のfail-closed
- 最新情報の検索が未接続であることを明示し、古い可能性がある知識だけでは回答しない境界

プロジェクト、個人記憶、複数AIの本番合議、出典本文の外部取得、AI Studio direct runtimeは一次公開に含めない。画面や回答で利用可能に見せない。

AI StudioはORIGINそのものではなく、将来追加できるprovider adapterまたは開発環境として扱う。公式の無料条件、保存・学習利用、安定したモデルID、実行前後の費用証拠、fallback無効化、エラー時のfail-closedを確認できるまで正式routeへ接続しない。

## Personal画面の実装境界

- Personal版は旧ダッシュボードの状態管理を読み込まない。
- 端末に保存する設定は表示言語と明暗テーマだけとし、AI選択、費用上限、再試行回数をブラウザ設定から変更できない。
- 実行ポリシーは費用上限`$0.00`、自動有料fallbackなし、回答経路を確認できない場合はfail-closedとする。
- 日本語を初期表示とし、英語を明示的に選択した場合だけ英語へ切り替える。
- AI回答内の外部画像URLは自動読込せず、一次公開で未対応であることを表示する。
- スマートフォン、タブレット、PCを正式な対象端末とする。390×844を含むモバイルでは動的viewportとsafe areaを考慮し、タブレットとPCでは画面を単純に引き伸ばさず、回答本文、入力欄、ナビゲーションの幅と密度を最適化する。
- 端末の縦横回転やウィンドウ幅の変更後も、ナビゲーションが画面外へ残ったり主要操作を覆ったりしない。
- 外部Webフォントを読み込まず、端末のシステムフォントを使用する。

## 許可する公開経路

| 経路 | 判定 | 理由 |
|---|---|---|
| Standard Cloud Build → Cloud Run container `server.ts` | CANDIDATE / BLOCKED | Exact SHAの機械注入とfail-closedは実装候補。課金設定追加なしで必要resourceを利用できるEXECUTED証拠が揃うまで選択しない |
| AI Studio Starter Tier one-click publish | NOT ELIGIBLE | 無料の場合があるが、GitHub Exact SHAの自動注入とSecret境界を公式仕様から証明できない |
| Vercel serverless `api/index.ts` | PREVIOUSLY SELECTED / NOT EXECUTED | 互換コードは維持。接続を確認できずデプロイは実施していない |
| Node/Docker manual deployment | NOT ELIGIBLE | GitHub main、承認済みpipeline、Exact SHA注入を迂回する手動container公開は認めない |
| Cloudflare Worker `worker/index.mjs` | NOT ELIGIBLE | status用途に限定され、provider executionは明示的に無効 |
| legacy provider endpoint | NOT ELIGIBLE | ORIGINの安全・無料実行境界を迂回できないよう無効 |
| AI Studio direct provider runtime | NOT ELIGIBLE | AI Studioは開発・監査・Starter Tier管理に限定し、Gemini providerを正式chat routeへ接続しない |

第2公開の次の公開候補は標準Cloud Build→Cloud Runとするが、無料条件の実アカウント証拠が揃うまでは`BLOCKED`であり正式選択しない。Cloud Build triggerは自動作成・有効化せず、実際のデプロイはオーナーが別途Exact SHAを指定して明示承認した後に限る。この文書はホスティングサービス、アカウント、認証情報、課金設定の変更を承認しない。

## 公開前の必須条件

1. exact candidate SHAのlint、unit test、build、既存E2E、CodeQL、OpenSSF、release workflowが成功している。
2. PRをReadyへ変更する承認と、mainへマージする承認がある。
3. デプロイについて、マージとは別の明示承認がある。
4. 公開環境のサーバー側に既存の`OPENROUTER_API_KEY`が安全に設定されている。値をチャット、ログ、コード、PRへ入力・表示しない。
5. 実行モデルIDが`:free`で終わり、provider fallbackが無効、最大価格がすべて`0`である。
6. 公開環境のsmoke testで、秘密情報を含まない入力に対する成功、実費`$0.00`、要求モデルと提供モデルの一致、fallback未使用を確認する。
7. APIキー未設定、無料証拠欠落、routing証拠不一致、provider不通の場合に回答を表示せず停止することを確認する。
8. ノリさんがモバイルまたは日常利用端末で、入力、回答の読みやすさ、エラー表示を最終確認する。
9. Cloud Run公開直後の`/api/health`が40桁の16進数SHAを返し、デプロイ対象のExact SHAと完全一致する。不一致または`unknown`の場合は公開成功と扱わない。
10. 必要な標準Cloud Build、Artifact Registry、Secret Manager、Cloud Runが対象アカウントで利用可能であり、支払方法、billing account、有料trialの追加を要求されない。要求された場合は停止する。

## 停止条件

次のいずれかに該当する場合、公開またはAI回答を停止する。別モデルや別providerへ自動で切り替えない。

- 無料であることを実行前に確認できない
- 実費`$0.00`を実行後に確認できない
- 要求した`:free`モデルと実際のroutingが一致しない
- provider fallbackが発生した、またはfallback無効を証明できない
- 認証情報が未設定、無効、または露出した疑いがある
- 本番環境だけで発生するP0/P1、秘密情報漏えい、誤表示が見つかった
- デプロイ承認の範囲を超える設定変更が必要になった

## 公開時期の判断

コードとCIが公開候補として全緑で、対象の標準Cloud Run経路、region、Artifact Registry、Secret Manager設定を課金追加なし・値非開示で確認できる場合、Ready変更・mainマージ・デプロイの各明示承認後に公開とsmoke testへ進める。性能は実測までUNVERIFIEDとする。

公開環境または安全なサーバー設定が未準備の場合、日付は確約しない。$0.00と認証情報非開示を維持したまま、利用可能な既存環境と自動化経路を確認してから改めて候補時刻を提示する。

AI Studio direct provider runtimeとone-click publishは第2公開へ含めない。AI Studioは開発・監査補助に限定し、上記のprovider要件と別途の実装・監査・承認なしにGeminiを接続しない。

## 公開完了の定義

「公開済み」と報告できるのは、mainへのマージだけではなく、承認された公開URLで次を確認した後に限る。

- Personal画面が表示される
- `/api/health`のリリースIDがデプロイ対象のExact SHAと一致する
- `/api/chat`が正式ORIGIN境界を通る
- 秘密情報を使わないsmoke inputへ回答できる
- 実費`$0.00`とfallback未使用を確認できる
- 表示した検証範囲が実行記録と一致する
- 未実装機能やfake dataが正式画面に現れない

この確認前は「マージ済み」「デプロイ実行済み」「公開検証中」を区別し、日常利用可能とは表現しない。
