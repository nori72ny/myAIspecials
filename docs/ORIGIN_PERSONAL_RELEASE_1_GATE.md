# ORIGIN Personal 一次公開ゲート

Status: Release decision record

Owner: ノリさん

Candidate branch: `plan/origin-ai-studio-foundation-v0-1`

Last aligned: 2026-07-23

## 公開するもの

一次公開は、ノリさんが日常利用するためのORIGIN Personalを対象とする。

- ホーム、チャット、設定
- 正式な`/api/chat`境界
- 無料と確認できるOpenRouterの`:free`モデルによる単独AI実行
- 回答、出典確認範囲、独立した別AI確認の有無、実費用、実行制約の正確な表示
- 秘密情報の入力遮断と、無料・routing証拠を確認できない場合のfail-closed

プロジェクト、個人記憶、複数AIの本番合議、出典本文の外部取得、AI Studio direct runtimeは一次公開に含めない。画面や回答で利用可能に見せない。

AI StudioはORIGINそのものではなく、将来追加できるprovider adapterまたは開発環境として扱う。公式の無料条件、保存・学習利用、安定したモデルID、実行前後の費用証拠、fallback無効化、エラー時のfail-closedを確認できるまで正式routeへ接続しない。

## 許可する公開経路

| 経路 | 判定 | 理由 |
|---|---|---|
| Vercel serverless `api/index.ts` | CANDIDATE | `createOriginApp()`から正式`/api/chat`を提供する |
| Node/Docker `server.ts` | CANDIDATE | `createOriginApp()`から正式`/api/chat`を提供する |
| Cloudflare Worker `worker/index.mjs` | NOT ELIGIBLE | status用途に限定され、provider executionは明示的に無効 |
| legacy provider endpoint | NOT ELIGIBLE | ORIGINの安全・無料実行境界を迂回できないよう無効 |
| AI Studio direct runtime | NOT ELIGIBLE | fail-closed境界のみで、正式routeへ未接続 |

公開先は、オーナーが別途デプロイを明示承認した後に限り選択する。この文書はホスティングサービス、アカウント、認証情報、課金設定の変更を承認しない。

## 公開前の必須条件

1. exact candidate SHAのlint、unit test、build、既存E2E、CodeQL、OpenSSF、release workflowが成功している。
2. PRをReadyへ変更する承認と、mainへマージする承認がある。
3. デプロイについて、マージとは別の明示承認がある。
4. 公開環境のサーバー側に既存の`OPENROUTER_API_KEY`が安全に設定されている。値をチャット、ログ、コード、PRへ入力・表示しない。
5. 実行モデルIDが`:free`で終わり、provider fallbackが無効、最大価格がすべて`0`である。
6. 公開環境のsmoke testで、秘密情報を含まない入力に対する成功、実費`$0.00`、要求モデルと提供モデルの一致、fallback未使用を確認する。
7. APIキー未設定、無料証拠欠落、routing証拠不一致、provider不通の場合に回答を表示せず停止することを確認する。
8. ノリさんがモバイルまたは日常利用端末で、入力、回答の読みやすさ、エラー表示を最終確認する。

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

コードとCIが公開候補として全緑で、選択済みのVercelまたはNode/Docker環境に必要なサーバー設定が既に存在する場合、Ready変更・mainマージ・デプロイの各明示承認後、公開とsmoke testを同日中の作業として扱える。作業目安は承認後1〜3時間であり、外部サービスの障害や無料モデルの提供状況は含まない。

公開環境または安全なサーバー設定が未準備の場合、日付は確約しない。$0.00と認証情報非開示を維持したまま、利用可能な既存環境と自動化経路を確認してから改めて候補時刻を提示する。

AI Studio direct runtimeは一次公開の期限を遅らせる条件にしない。AI Studio連携の本番有効化時期は、上記のprovider要件と別途の実装・監査・承認が揃った時点で判断する。

## 公開完了の定義

「公開済み」と報告できるのは、mainへのマージだけではなく、承認された公開URLで次を確認した後に限る。

- Personal画面が表示される
- `/api/chat`が正式ORIGIN境界を通る
- 秘密情報を使わないsmoke inputへ回答できる
- 実費`$0.00`とfallback未使用を確認できる
- 表示した検証範囲が実行記録と一致する
- 未実装機能やfake dataが正式画面に現れない

この確認前は「マージ済み」「デプロイ実行済み」「公開検証中」を区別し、日常利用可能とは表現しない。
