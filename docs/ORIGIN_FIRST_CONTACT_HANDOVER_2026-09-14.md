# ORIGIN 完全引き継ぎ書 — 初回担当者向け
更新基準: 2026-09-14 UTC。会話履歴なしで再開するための独立文書。
この文書はスナップショットであり、再開時にGitHub/main、本番、CIを必ず再取得する。

## 1. 依頼者とプロジェクト
オーナーは nori72ny。方針承認を担当し、通常の調査・実装・テスト・PR・安全な公開作業は担当AIに一任している。スマートフォン利用を前提に、端末操作を安易に依頼しない。
ORIGINは総合AI OSを目指す。ユーザーが依頼し、計画・調査・コード変更・検証・成果物保存・必要な承認を経た公開まで行う。
「世界一に近い」「Claude Code級以上」は目標。比較試験なしに達成済みと主張しない。
今回の依頼は開発継続と、クレジット終了・別AIへの移行後も継続できる完全引き継ぎ書の作成。

## 2. 接続先
- Repository: https://github.com/nori72ny/myAIspecials
- Production: https://origin-personal.vercel.app
- Health: https://origin-personal.vercel.app/api/health
- Vercel project: origin-personal / prj_WecnnicbGAamToppgV97rHgd8QSB
- Vercel team: team_2oPfSS7sHa4Db1asn4C0IJkq
- 基準main SHA: e42d6f5f21420d9ac53735ab6e9793985d2e8bd4
- 対象deployment: dpl_AxhTRa4vkPP1L7nDnC17etawGkLc
- デプロイ証拠: https://vercel.com/nori72nyprivate-6923s-projects/origin-personal/AxhTRa4vkPP1L7nDnC17etawGkLc
ローカルcloneの存在は未確認。作業環境に応じて正規の接続を利用。認証情報をこの文書に追加しない。

## 3. ロードマップ
- V1.1 Grounded Research: Web検索、出典、比較、ファクトチェック、調査レポート。
- V1.2 成果物: 文書/PDF/スライド/表計算の生成・保存・検証。
- V1.3 Web/Application Builder: 設計、実装、検証、公開。
- V1.4 Agentic Coding: Repo探索、複数ファイル編集、テスト、修復、Git/PR、公開、監査。現在の最優先。
- V1.5 Creative/Visual: 画像、UI、広告クリエイティブ。
版番号は構想を示し、全機能の実装完了宣言ではない。

## 4. 絶対に維持する境界
- 無料方針: freeOnly=true、costUsd=0、有料fallback無効。表示だけでなく実送信前後のpolicyも確認。
- 有料モデル導入、課金、token権限拡大、私的データ送信範囲の拡大はオーナー判断が必要。理想構想は課金承認ではない。
- 認証、owner境界、OIDC repo/ref/workflow/SHA/audience/期限、暗号化結果の保護を緩めない。
- テストを消す、必須4検証を減らす、成功状態を偽装する、過去SHAの成功を最新証拠として使うことは禁止。
- 検証Dockerへprovider/DB/Gitの秘密値、外部network、Docker socketを渡さない。
- モデル生出力、コード本文、prompt、search/replacement、秘密値は公開ログに出さない。静的allowlistのstageだけを診断に使う。
- Coding verifiedとGit公開・deployを区別。smokeではgitPublished=false、deployed=falseが正しい。
- quota/429で無制限再試行しない。無料枠を浪費しない。
- 他者の変更、既存PRを上書きしない。main直書きではなくPRとexact-head検証を基本とする。

## 5. 実行構成と読むファイル
通常の流れ: owner認証 → Coding job保存 → GitHub Actions durable worker → Repo探索/提案 → 隔離Dockerで4検証 → bounded repair → 暗号化結果保存 → owner限定取得。
- docs/ORIGIN-HANDOVER.md: 既存の詳細履歴。時点の違いに注意。
- docs/V1.4_INTEGRATED_REVIEW_ACTIONS.md: 統合レビュー、境界証拠台帳、今後の受入条件。
- src/agent/codingJobRouterV14.ts / codingJobOperatorAuthV14.ts: 受付と認証。
- src/agent/codingJobSmokeRouterV14.ts / codingJobSmokeOidcV14.ts: 合成課題とOIDC入口。
- src/agent/codingJobWorkerV14.ts: lease、heartbeat、session、結果保存、終端化。
- scripts/run-coding-job-worker-v14.ts: 実host controller、checkout複製、Docker隔離。
- src/agent/codingPlannerV14.ts / codingNavigatorV14.ts / codingSessionV14.ts: 探索、提案、修復。
- src/agent/codingJobExecutionEvidenceV14.ts / codingJobResultV14.ts / codingJobResultStoreV14.ts: 実行元、結果、暗号化保存。
- src/agent/supabaseCodingJobStoreV14.ts: DB状態遷移、回収、claim。
- src/legacy/originProviderClient.ts、src/lib/orchestration/OriginExecutionPolicy.ts、OriginFreeModelCatalog.ts: provider、費用・能力判定。
- .github/workflows/coding-production-smoke-v14.yml: 本番E2E。
- .github/workflows/coding-job-worker-v14.yml: durable worker。
- .github/workflows/ci.yml: Production Release。
- public/origin-artifact-sandbox.html、vercel.json、App.tsx: 成果物隔離。
これらは調査入口であり、全ファイルの現状レビュー済みを意味しない。
ルートAGENTS.md取得は今回404。実装前に対象階層の追加指示を確認する。

## 6. これまでの到達点
引き継ぎ報告による完了:
- #2 Artifact Preview Isolation: PR #257/#258/#259はmainへmerge。任意JS、外部通信、navigation、form、iframe、外部CSS等を無効化。
- 当該リリースでChromium/Firefox/WebKit隔離、本番Chromium、PWA/履歴/新規chat/復旧、AI streaming/複数turn PASSと報告。
- 上記の旧基準SHA: 4bd0c0300b819487ce42c620456a67745c9be540。
- PR #260: 単一scopeの実行不可能側空配列省略の安全な正規化。merge SHA d2fcf5ae3977b4d7c2519c528ca9e2965fbfaaa9。
- PR #261: schema違反の構造stage診断。merge SHA 349d600256c2c3f63c8c7a7da95b3b5352e21555。
今回会話内で接続先から確認したこと:
- PR #263: allowlistに限定したschema stageのdurable公開。全PR CI成功後にsquash merge済み。
- PR #263 head: bd6ede887c2bec31f277ceba5cd87ff2fb8b481f。
- main: e42d6f5f21420d9ac53735ab6e9793985d2e8bd4。
- このmainのProduction Release run 34881606791、CodeQL 34881606773、Quality Gate 34881606743、OpenSSF 34881606699はsuccess。
- Production smoke #24のexact-main readiness stepはsuccess。
過去の完了報告と今回の実測を混同しない。

## 7. 現在の最優先: #3 Production Codingをverifiedまで
未完了。worker workflowのsuccessはCoding成功ではない。
- Smoke #24: https://github.com/nori72ny/myAIspecials/actions/runs/34881606707
- Smoke job ID: 104101986451
- Coding job: coding-1YzSIb3_91ZS3vXIPRq5lw
- Worker run: https://github.com/nori72ny/myAIspecials/actions/runs/34881679490
- Worker Actions job ID: 104102228657
- Worker checkout: e42d6f5f21420d9ac53735ab6e9793985d2e8bd4
- 最終取得時、smokeはin_progress。完了時ログを再取得する。

実際のworkerログ:
- 18:38:05 UTC: coding-verification-check-failed / test / exitCode 1 / timedOut false
- 18:40:50 UTC: 同じtest失敗
- 18:42:02 UTC: state retryable / CODING_WORKER_STAGE_FAILED
- 18:44:08 UTC: state not_claimed / CODING_JOB_NOT_CLAIMED
- worker workflow自体はsuccessで終了。
今回のrunからschema stageはまだ確定できていない。「schema問題は解決」「verified成功」と書かない。
前回回答の「現在検証/修復中」は当時の推測を含む。今回は上記実ログを優先する。

## 8. 新しく特定した再取得の不整合
コードで確認:
- scripts/run-coding-job-worker-v14.tsはWORKER_LEASE_SECONDS=240を渡す。
- workflowのretryループはコメントでlease 120sを前提に、exit 2後にsleep 125を行う。
- worker coreはrecoverStaleJob → claimJobを行い、claimできなければnot_claimedを返す。
- scriptはretryable/lease_lostのみexitCode=2。not_claimedはexit 0。
したがって240秒leaseが残っている間に125秒後の再取得を試み、not_claimedでretryループが正常終了し得る。今回のログと整合する具体的な不整合。
ただし実DBのlease_expires_atを今回読んでいないので、今回の因果確定にはその確認または再現テストが必要。
CODING_WORKER_STAGE_FAILEDの最初の例外と、test失敗の直接原因は別途未確定。
次はleaseと再試行待機を同じ信頼済み設定へ揃え、not_claimedを無条件成功にする意味を再検討。並行workerが正しくclaimしている場合を壊さないこと。推測だけで時間を延長し続けない。

## 9. 他の未merge候補
Vercel履歴にPR #262 branch fix/v14-durable-schema-stage、head 5fa801b355c522ca859409a1cc7e5153091ae91cがある。
公開環境テンプレートをhash検証してsandboxへ残す変更と、隔離環境full suite再現が含まれるというcommit messageを確認。
今回PR全文・CI・安全性は未レビュー。mainには同内容が入っていない可能性がある。test失敗との関係を調査する。
.env全体をsandboxへコピーして解決してはいけない。既存PRを盲目的にmergeせず、#263との重複を確認。

## 10. verifiedの受入条件
新しい同一SHAの本番jobで以下が一続きに成立すること:
1. API releaseShaが期待mainと一致。
2. OIDC認証でsmoke受付202、job作成、正規worker dispatch。
3. 結果job.statusとsessionStatusがverified。
4. executionEvidence.sourceRevisionが同じSHA。workerRunIdとattemptが有効。
5. typecheck/lint/test/buildの4件すべてok=true、exitCode=0、timedOut=false。最終repair roundに属する。
6. 合成課題の差分が正確に1ファイル: src/agent/__origin_coding_smoke_v14__.ts。
7. 内容は export const ORIGIN_CODING_SMOKE_V14 = true; と末尾改行。ほかの変更なし。
8. 暗号化保存後にowner限定取得でき、resultDetailsState=available。
9. freeOnly=true、costUsd=0、paidFallbackUsed=false、gitPublished=false、deployed=false。
health 200、DB ready、worker CI緑だけでは不足。

## 11. 次の担当者が最初に行う順番
1. 最新main、PR一覧、deployment、smoke #24の終端結果を再取得。新しい作業があればそちらを優先。
2. worker run 34881679490ログとコードのlease不整合を照合。
3. PR #262全文/CI、隔離テストとmainとの差分を確認し、テスト失敗を秘密値なしで再現。
4. lease retry不整合に回帰テストを加え、最小修正PRを作成。元のWORKER_STAGE_FAILEDは安全な静的stage診断で追う。
5. exact-head CI、レビュー、安全性を確認してからmerge。protected workflowの承認が必要ならオーナーへ戻す。
6. same-SHA Production更新と新規smokeを検証。現在のsmokeはmain pushのpath filterで起動する。workflow_dispatchがあると仮定しない。
7. 成功証拠をこの文書または後続引き継ぎへ追記。
8. #3完了後、実行証拠の表示/期限、低頻度継続確認、UI/回答品質、held-out比較へ。

## 12. 将来構想: モデルと実行基盤を分離
ユーザー案: Supervisor → Research/Coding/Work → Model Router → 各種モデル。
採用すべき設計原則:
- Supervisor: plan、分解、memory、再計画、承認。
- Capability Router: Research/Coding/Work/Artifact。
- Model Router: 無料根拠と期限、データ送信条件、能力、利用枠を先に判定し、完了率/速度/費用で選択。
- Harness: Browser/Computer Use/Terminal/Git/Sandbox/Test/Self Repair/Deployment/Artifact。
- Verification: 成果物・実行元・安全・費用の証拠を生成処理と分離。
Astra/Claude/Geminiの固定順位・星評価・単価はユーザー提供の参考情報で、今回十分な公式検証をしていない。コードや契約条件へ転記しない。モデル名は交換可能にする。
現時点でrouter/Supervisorの追加実装を本ターンで行ったわけではない。有料利用は未承認。
UIは390/834/1440pxで長文/コード/表/出典/失敗/コピー/keyboardを検証。固定の文字数下限ではなく実用性で評価。
比較は未使用課題を分離し、同一時間・権限・予算・修復上限で完了率、回帰、危険操作、人の介入を記録。

## 13. 環境と再開の注意
本ターンはGitHub/Vercel接続で調査。ローカルshell/apply_patch/ファイル作成機能は露出していないためローカルテスト未実施。
文書はGitHub branchに保存。クレジット終了後もこの文書を次のAIへ渡せる。終了後の自動作業継続・監視は設定していない。
GitHub runs一覧を取得する場合、利用可能ならGET /repos/nori72ny/myAIspecials/actions/runsを使いhead_shaで絞る。fetch_commit_workflow_runsはPRイベントだけのwrapperなのでmain push調査に使わない。
秘密値の再取得・チャット貼付を求めない。本人認証、権限、課金のみ必要条件をまとめて質問する。

## 14. 次のAIへ渡す依頼文
「この引き継ぎ書を最初から読み、最新のGitHub/main・PR・本番・CIを確認して、すでに進んだ作業を重複せず続けてください。最優先は#3 Production Codingの新規same-SHA verifiedです。worker CI successとverifiedを混同せず、lease/retry不整合、test失敗、WORKER_STAGE_FAILEDを分けて調査・最小修正・回帰検証してください。無料方針、秘密値保護、権限分離を維持し、必要な承認以外は担当側で進めてください。進捗と新しい証拠を引き継ぎ書に更新してください。」
