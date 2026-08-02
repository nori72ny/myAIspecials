# ORIGIN review preview

Status: review-only — no production deployment

## Purpose

ノリさんがReady化や本番公開を承認する前に、スマホ、タブレット、パソコンから現在の画面と実装内容を確認できるようにする。

## Visual evidence in GitHub

PRの`Production Release CI/CD`は、次の7画角でホーム、チャット、設定、回答画面を検証し、スクリーンショットをPlaywright HTML reportへ保存する。

- 320 × 568
- 390 × 844
- 844 × 390
- 640 × 720
- 834 × 1112
- 1280 × 720
- 1440 × 900

確認するExact Head SHAと、GitHub Actions runのhead SHAが完全一致する場合だけ証拠として扱う。

1. 対象PRの`Checks`から`Production Release CI/CD`を開く
2. 成功したrunの`Artifacts`を開く
3. 通常は`playwright-report-node-22.x`を優先し、必要に応じて`test-results-node-22.x`を確認する
4. ホーム、チャット、設定、回答のスクリーンショットを画角ごとに確認する

artifactは30日で失効するため、恒久的な本番証拠として扱わない。画面の美しさ、文章の繊細さ、操作感は自動テストだけで合格にせず、人の目で確認する。

スマホやタブレットでartifactのZIPまたはHTML reportを開けない場合は、対象runとExact Head SHAを指定し、ChatGPT/Codexがartifactから画像を抽出して会話内へ提示する。端末側で複雑な展開操作を求めない。

これらのスクリーンショットはレイアウトと表示内容の証拠であり、実providerの回答精度、応答速度、費用、タッチ操作感の証拠ではない。

## Interactive preview in AI Studio

Google AI StudioにはGitHub projectのimport機能がある。ただし、Draft branchとExact Head SHAを選択・表示できることを画面上で確認できない場合、PRの対話プレビューには使用しない。

使用する場合は次の境界を守る。

- repository: `nori72ny/myAIspecials`
- branch: `infra/cloud-run-production-path`
- import後に表示されるcommitがPRのExact Head SHAと一致する
- previewのみ。Publish、Cloud Run deploy、GitHub export、mainへの書き戻しは行わない
- Gemini機能、Gemini API key、別provider、課金機能を追加しない
- AI Studioがmainしかimportできない、またはExact SHAを確認できない場合は停止する

AI Studio上の編集状態はGitHub正本ではない。修正が必要な場合は、指摘内容を作業ブランチへ実装し、再度GitHub CIとスクリーンショットで確認する。

## Interactive preview limitation

GitHub Actions artifactは画面証拠であり、スマホで直接操作できる公開URLではない。操作可能な共有URLを作る行為はpreview deploymentに該当するため、別途明示承認が必要である。今回のPRは公開URLを作らない。
