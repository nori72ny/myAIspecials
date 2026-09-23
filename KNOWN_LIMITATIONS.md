# Known Limitations

最終確認日: 2026-09-22

この文書はORIGIN Personalの現行コード境界と未検証事項を記録します。旧RC、Vision文書、未実装のエージェント規模、WebSocket、分散メモリ、Enterprise構想を現在のProduction仕様として扱いません。

基準main:

```text
01f7db0c0d48ab3ba533148e99e1847203e13f4c
```

現在の公開候補はPR #608であり、main/Productionとは別です。Candidate SHAは必ずPRとCIのlive evidenceを優先してください。

## 公開・運用

- Productionは稼働していても、配信SHAが最新mainやPR候補と一致するとは限らない
- CI/Preview成功はProduction反映の証明ではない
- Production完了には配信SHA、health、実Chat/Streaming、PWA、failure/recovery、artifact isolationを再確認する
- 日常利用可能性、SLA、可用性、復旧時間はprovider無料枠やVercel無料枠に依存し保証しない

## AIモデル・費用・retry

Chat固定無料モデル:

```text
inclusionai/ling-3.0-flash-sante:free
reviewAfter: 2026-10-01T04:59:37.992Z
```

Codingでtimeout/unavailable時だけ利用可能な別証拠付き無料モデル:

```text
inclusionai/ling-3.0-flash-vl:free
reviewAfter: 2026-10-02T14:36:59.999Z
```

制約:

- 有料fallbackを行わない
- 価格根拠が失効したモデルは実行しない
- served model、reported cost、data policyを検証できなければ停止する
- OpenRouter任せのprovider/model fallbackを許可しない
- 同一provider/modelへの自動retryは行わない
- HTTP 429は即Fail-Closedし、別モデルでquotaを迂回しない
- Codingのtimeout/unavailableのみ、別途証拠が有効な$0/ZDRモデルへ最大1回だけfailoverできる
- malformed response、required-tool truncation/ambiguityは同一要求を自動再送しない
- CodingのSelf Repairはprovider retryとは別であり、実コード変更後のtypecheck/lint/test/build失敗を根拠にbounded repairする
- runtimeで`data_collection: deny`、`zdr: true`、`max_price=0`、served-model identity、reported cost zeroを強制する

無料モデルの価格証拠はscheduled workflowで定期再確認し、期限接近時は更新PRを作成します。証拠更新PRも通常CI/Owner承認境界を越えて自動mergeしません。

## 現行コード範囲

現行コードベースには少なくとも次の境界があります。

- Personal Chat / Streaming / History / PWA
- V1.1 Grounded Research service
- V1.2 Markdown/CSV/PDF/DOCX/XLSX/PPTX real-file generator
- V1.3 Web/Application Builder
- V1.4 Agentic Coding job/worker/verification/result flow
- Artifact preview isolation
- MCP client/OAuth/grant foundation（Production有効化とは別）

ただし「コードに存在する」「CIで通る」「Productionで有効」の3つは別判定です。最新状態は`docs/ORIGIN_COMPLETION_STATUS.md`を確認してください。

現在も保証しないもの:

- 複数AIの自動合議が常時Productionで動作すること
- 長期Memory/端末間同期/永続Knowledge DNA
- 自己進化する組織や無承認の自己更新
- 1,000以上の自律エージェント同時実行
- desktop / IDE / computer-useの完全自律操作
- Claude Code / ChatGPT Agent /その他競合より優れていること

## Agent / Coding品質

Completion gate、self-repair、held-out harness、checkpoint/resume等のコードとテストが存在しても、世界最高水準の比較主張には同一課題・同一成功条件・Exact SHA・ログ・diff・test結果が必要です。

未検証または再検証が必要:

- Task 1–12の同一条件benchmark
- long-task / interruption / resumeの実タスク
- first-pass success rate / repair rounds / unnecessary diff
- Claude Code等との同条件比較
- 最新release candidateでのProduction Coding E2E

## Research / Artifact品質

Research serviceとreal-file generatorの存在だけでは、あらゆる研究回答・成果物品質を保証しません。

再検証が必要:

- 一次情報比率
- citation correctness / freshness
- contradiction handling
- unsupported claim抑制
- PDF/DOCX/XLSX/PPTXを実際に開き直した品質
- Web artifactの視覚品質と操作性

## UI / モバイル

PR #608はconversation-firstへの再設計候補です。Exact-head Preview、390px実画面、物理Androidキーボード、TalkBack/VoiceOver等の手動検証が完了するまで最終UX PASSとはしません。

## セキュリティ

現行MCP OAuth/token経路はserver-side encrypted storeを使用します。旧OS画面に存在したbrowser direct-tokenフローはretired扱いで、Personal正規経路として使用しません。

未検証:

- production penetration test
- 本番Secret/log/TLS/WAF/CORSの独立監査
- prompt injection網羅耐性
- provider側運用の長期変化
- 未知の脆弱性

「SECURED」「100%安全」「Zero Trust認証済み」とは主張しません。

## 完了主張

制約を解消した場合は最低限次を同時に記録します。

```text
exact Git SHA
test method
test environment
evidence location
verdict
known residual risk
actual cost USD
merge status
deployment status
```
