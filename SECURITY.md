# Security Policy

最終確認日: 2026-08-11

この文書は、ORIGIN（ACOS 2.0）の現行`main`で確認できるセキュリティ境界と、未検証事項を区別して記録します。「安全性100%」「Zero Trust認証済み」「完全に防御済み」とは主張しません。

## 対象

基準main:

```text
36731864fbd4cda3947fc02dbd2e2c43eb3e029b
```

現在の公開開発候補はORIGIN Personalです。旧Mission Engine、旧Gemini経路、未承認プロバイダー経路はPersonalランタイムの実行対象として扱いません。

## 確認できる実装境界

### サーバー側AI実行

- 権威あるAI実行経路は`POST /api/chat`
- OpenRouter APIキーは`OPENROUTER_API_KEY`環境変数からサーバー側で取得
- ブラウザーへAPIキーを渡す設計ではない
- `FREE_ONLY=true`を前提に無料限定を強制
- 固定された単一モデルだけを許可
- 自動モデル選択と有料フォールバックを禁止
- 要求モデルと提供モデルが一致しない場合は安全停止
- 無料根拠の期限切れ時は`FREE_MODEL_EVIDENCE_STALE`で安全停止

固定モデル:

```text
google/gemma-4-26b-a4b-it:free
```

無料根拠の再確認期限:

```text
2026-08-19T23:59:59.999Z
```

### HTTP/API境界

現行サーバーには次の境界があります。

- `x-powered-by`の無効化
- セキュリティヘッダー
- `/api/chat`のレート制限
- JSON request bodyの64KB上限
- 不正JSONを400で拒否
- 過大request bodyを413で拒否
- 未定義APIをJSON 404で返し、SPA HTMLへのフォールスルーを防止
- 旧プロバイダー対応経路をfail-closedで遮断
- JSON以外のAPI応答を安全側で拒否

### 表示境界

- Reactの通常レンダリング境界を使用
- Markdown表示に`react-markdown`を使用
- DOMPurifyを依存関係として使用
- PWA/offline経路でAPI成功応答を捏造しない

これらはコードと自動テストで確認した境界であり、あらゆるXSS、prompt injection、認証・認可問題を完全に防止する保証ではありません。

## CIで確認している項目

直近PRでは次の検査が成功しています。

- TypeScript / design-token lint
- unit / API / Playwright E2E
- production build / Node.js runtime smoke
- dependency review / `npm audit`
- Gitleaks
- CodeQL
- OpenSSF Scorecard
- Lighthouse
- SBOM生成

CI成功は、本番環境、未知の攻撃、運用設定、外部プロバイダーを含む完全な安全性証明ではありません。

## 未検証事項

- 本番URLと配信SHA
- 本番Secret設定とログへの非露出
- 本番WAF、TLS、CORS、rate limitの実効性
- penetration test
- 第三者による最新Exact SHAの独立セキュリティ監査
- prompt injectionに対する網羅的耐性
- provider側の保存・学習・地域処理の実運用確認
- 長期間運用時の依存関係・モデル・費用変化
- 物理端末と実ネットワークでの検証

## 秘密情報

次をIssue、PR、Discussion、commit、スクリーンショット、テストログへ投稿しないでください。

- APIキー
- access token
- cookie / session
- 個人情報
- private prompt
- 本番URLに紐づく非公開設定
- 脆弱性を再現できる秘密情報

サンプルには空値だけを使用します。

```env
OPENROUTER_API_KEY=""
FREE_ONLY="true"
```

## 脆弱性の報告

公開Issueへ秘密情報や未修正の攻撃手順を投稿しないでください。

GitHubリポジトリでPrivate vulnerability reportingが利用可能な場合は、Securityタブの非公開報告経路を使用してください。利用できない場合は、秘密情報を含めずにリポジトリ所有者へ非公開の連絡手段を確認してください。

所有確認できないメールアドレスを正式な通報先として記載しません。

報告には、可能な範囲で次を含めてください。

```text
affected Git SHA
affected path
impact
minimal reproduction
required preconditions
whether secrets were exposed
suggested mitigation
```

## 修正と公開

セキュリティ修正も通常の承認境界に従います。

- 専用ブランチ
- Exact SHAを固定したテスト
- Draft PR
- 独立確認
- Ready化の個別承認
- mainマージの個別承認
- デプロイの個別承認

緊急性があっても、有料サービス・Secret・DNS・クラウド・リポジトリ設定を暗黙に変更しません。
