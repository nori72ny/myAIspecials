# ORIGIN — 段階公開・公開後自動アップデートの正本補足（2026-10-08 JST）

> This supplement does not override `docs/ORIGIN-HANDOVER.md` or authorize an automatic Production merge. Treat live GitHub/Vercel evidence as authoritative over dated snapshots.

## Owner intent

- 公開準備ができた **1機能ずつ** 本番公開する。全機能完成まで待たない。
- 公開済み機能も継続的に改善し、**承認済みの更新は自動配信・安全なPWA適用** の対象にする。
- オーナーは原則として承認のみ。実装・独立検査・失敗修正・PR・CI・公開後点検は担当側で実施する。
- 「動いた」「CI green」と「高い回答/画像/Agent実務品質」は別に測定する。

## 変更・公開の共通ゲート（新機能と更新の両方）

1. 変更対象と実行権限を **機能単位** で固定。既存の正常な機能や他機能への影響を回帰検査する。
2. real execution / negative paths / E2E、成果物のreal bytes・保存/ダウンロード・履歴・reconnect/resumeを対象別に検証。
3. `exact-head` 必須CI（Node 22/24、3ブラウザ隔離、security/dependency/CodeQL、Lighthouse等）がすべて GREEN。SHA更新後は再計測。レビュー指摘を解消。
4. UI変更は desktop/tablet/mobile（390px 横スクロール0、composer clipping0、touch/contrast/accessibility、light/dark、Android/iOSキーボード）を実測して **Owner visual approval** を得る。UI未変更でも既存表示を破壊しない。
5. Agent/Coding/Research/画像/回答品質など生成機能は、該当する actual-provider、独立 evaluator、unseen held-out、必要なら対等条件の他AI比較による品質証跡が必要。`NOT_MEASURED`、provider 503、内部synthetic PASSを最終認定としない。
6. `freeOnly=true`、`costUsd=0`、`paidFallbackEnabled=false`。追加費用・課金fallback・privacy不確定・権限拡大・secret露出・未知のmigrationは fail-closed。server-only鍵はログや証拠に含めない。
7. main merge、Production公開・更新、環境/DB/認証/権限/外部providerの変更は、**対象機能・exact SHAを特定したオーナー承認** を確認してから実行。単なるPR作成・CI成功は公開承認にならない。
8. merge後の `exact-main` CIと Vercel Production **exact-main SHA / READY / health / browser・PWA / artifact** を検証。リリース証拠を正本へ追記。失敗ならロールバックして当該機能だけ延期。既存機能を残す。

## 重要な現行ギャップ（自動更新を無条件に安全と主張しない）

2026-10-08 JST に repository `main` の `vercel.json` を点検したところ `git.deploymentEnabled.main=true`。main はその時点で protected=false と確認され、読み取り可能なリポジトリ rulesets は空。一方 `.github/workflows/ci.yml` の `production-smoke` は main push 時にテスト後で実行する **後追い検証** であり、Vercel が先にProductionを配信するのを止める承認ゲートではない。

したがって **リリース前のhard blockingは現時点で未保証**。GitHub branch protection / required reviews & exact-head checks、および Vercel Deployment Checks または Owner承認付き staged production → smoke → promote のゲートを整備・検証するまでは、main の未承認マージを禁止する。更新監視タスクも missing protection をPASS扱いせず報告する。自動マージや無審査の公開はしない。

## 公開済みPWAの安全な自動更新

- Vercelで承認済み Production の新SHAが有効になったとき、Service WorkerはSHAに基づく別キャッシュを使い、定期的に `registration.update()` を確認。
- 入力中、添付、履歴hydration、推論中、画面非表示、**IME変換中、contenteditable draft** は waiting worker の適用と自動reloadを延期。下書きがなくなった後に一度だけ再読み込み。
- **Direct Touch のiframe編集**は親DOMから直接参照できない。編集中の表示を親側で検知し、iframeのinput・IME開始を即時通知する。420ms debounce中は更新禁止。commit後もReact stateの反映だけでは解除せず、**対象revisionを含むスナップショットのIndexedDB saveが `saved` で成功し、後続編集に置き換わっていない**ことを確認して更新を再試行する。保存失敗・容量超過・旧世代書込みはfail-closed。
- ストレージ `degraded` / 未初期化も更新禁止とし、下書き消失の可能性を成功扱いにしない。iframeからの通知は現在のpreview windowに紐づけ、外部フレームの無関係なメッセージでは更新の安全判定を変えない。
- 更新後のIndexedDB復元では、既存のコードが成果物の編集版履歴（`revisions`）を破棄していたため、**本文と整合する検証済みの版履歴を保持**する。破損・過大・古い履歴は実行せず破棄し、表示される最新本文を上書きしない。
- これは **端末への安全な版反映** の対策。Productionへ何を出してよいかの承認・品質ゲートを代替しない。

## 当面の運用

1. 未公開と公開済みの候補を同じ品質基準で審査し、差分が小さく、合格した **一件だけ** を選ぶ。
2. Owner承認とCI/quality証拠がそろえば自動配信経路で反映し、SHAと端末更新を実測する。
3. 次の機能は前のリリースが正常に保たれた後に進める。合格しない機能・高額経路・安全でない接続は引き続き非公開。
