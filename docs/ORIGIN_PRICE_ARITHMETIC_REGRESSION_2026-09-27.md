# Production answer-routing regression

Observed against production release `564a1a144e89f2543b4f0066e2e7a6ada5e68261`.

## Live smoke results

- `今日の天気は？` correctly asked `どの地域の天気をお調べしますか？`.
  HTTP 200, local clarification, actualCostUsd=0.
- `商品を20%値引きした後、値引き後の価格を25%値上げしました。元の価格と同じになりますか？元の価格を1000円として計算し、結論と計算式を日本語で簡潔に説明してください。`
  returned `確認できる公開情報を取得できなかったため、現在の情報を推測して回答しません。`.
  HTTP 200, answerMode=research, sourceCount=0, synthesisStatus=not-run,
  actualCostUsd=0. This is a product failure, not an acceptable arithmetic answer.
  Expected: 1000 × 0.8 × 1.25 = 1000, so the price returns to its initial value.

## Cause and change

The freshness classifier treated `価格を` as requiring current public information
regardless of the supplied arithmetic context. An explicit calculation with a
supplied currency amount and percentage now takes the ordinary answer path.
Explicit freshness, market/exchange/tax information and external-source requests
remain subject to research. The exemption is intentionally narrow.

## Verification boundary

- Related policy, chat-router and streaming-router tests: 83 passed.
- Regression test checks that the answer executor runs and research does not.
- Executor output in that test is mocked: it verifies routing, not live model
  mathematical performance. Post-release live answer verification is still needed.
- Existing free-only provider/cost checks are unchanged.
- This branch is independent of image-auth PR #696 and based on canonical main.
- No main merge, production update, credentials or environment changes performed.

## Continuation priorities

1. Review exact-head CI for this PR and PR #696 independently.
2. Complete image connection UI, real provider authorization and image delivery.
3. Verify desktop/mobile renders and accessibility. Local browser installation is
   blocked by certificate/download failures; do not claim visual acceptance.
4. Run trusted exact-candidate answer/coding evaluations, preserving sealed-corpus
   isolation and zero-cost gates. These smoke tests do not establish superiority.
5. Ask owner to approve the reviewed release only after evidence is complete.
