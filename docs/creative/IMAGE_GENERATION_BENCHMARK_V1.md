# ORIGIN Image Generation Benchmark v1

Status: **protocol defined; benchmark not yet executed**  
Reference target: **ChatGPT Image 2 or better**  
Release constraint: **$0.00 actual user cost; no paid API, paid fallback, or automatic billing path**

This protocol prevents a successful HTTP response, a valid PNG, or a prompt-planner unit test from being misreported as image-quality parity.

## 1. Test conditions

- Run the same prompt text, aspect ratio, and intended use against ORIGIN and the reference system.
- Use one output per prompt for the first pass; do not cherry-pick. If a system produces multiple candidates, score all candidates and disclose the selection rule.
- Randomize image order and hide provider identity from reviewers.
- Record UTC timestamp, model/provider identifier, output dimensions, latency, errors, and verified cost for every attempt.
- Keep original outputs and the scoring sheet. Do not edit, upscale, retouch, or regenerate only one side.
- For text-bearing images, score exact transcription separately from overall visual quality.
- If the reference product/version cannot be identified reliably, label the comparison **UNVERIFIED**.
- Do not run an external provider until its free allocation and non-billable behavior are confirmed. A credit grant, trial, or payment-method-backed route is not evidence of $0.00 service cost.

## 2. Prompt set

Use the following fixed prompts verbatim. Use the stated ratio for both systems.

| ID | Category | Ratio | Prompt |
|---|---|---|---|
| P01 | Product photography | 4:5 | 高級なガラス香水ボトルの商品写真。透明な琥珀色の液体、精密なガラスの屈折、柔らかなスタジオ照明、淡い石材の台、洗練された高級広告写真。文字・ロゴなし。 |
| P02 | Product + social campaign | 9:16 | 高級化粧品ボトルの春キャンペーン用Instagram Story。花びらは控えめ、商品形状を正確に保ち、中央の安全領域に主役を配置。文字・ロゴなし。 |
| P03 | Human portrait | 4:5 | 自然光の窓辺にいる成人の人物の写実的な編集写真。自然な皮膚の質感、正確な手、自然な目と歯、落ち着いた表情、85mmポートレート写真。 |
| P04 | Hands/anatomy | 1:1 | 木製テーブルの上で陶器のカップを両手で丁寧に持つ成人の手元の写実写真。指の本数、関節、カップとの接触、影を自然に描く。 |
| P05 | Exact Japanese typography | 4:5 | ミニマルな春の広告ポスター。画像内に「春、新しい自分へ。」を一字一句正確に表示。追加の文字・ロゴ・透かしは入れない。 |
| P06 | Infographic | 4:5 | 水循環を説明する日本語の教育用インフォグラフィック。蒸発、凝結、降水、集水の4段階を矢印で明確に示す。各ラベルは正確な日本語。装飾より可読性を優先。 |
| P07 | App UI | 9:16 | 日本語の高級タスク管理アプリのモバイル画面コンセプト。整列したカード、明確な階層、読みやすい日本語ラベル、現実的なステータス表示。不要な透かしなし。 |
| P08 | Illustration/anime | 4:5 | 夕暮れの東京の街を歩く成人キャラクターの高品質アニメイラスト。整合した人体、自然な手、清潔な線、奥行きのある背景、統一された光。 |
| P09 | Watercolor | 1:1 | 青い花と白い鳥を描いた上質な水彩画。紙の質感、自然なにじみ、繊細な筆致、形状の一貫性。文字なし。 |
| P10 | Cinematic scene | 16:9 | 雨上がりの東京の路地を描く映画的な写実風景。濡れた路面の反射は物理的に自然、遠景に奥行き、露出は制御され、文字や透かしなし。 |
| P11 | YouTube thumbnail | 16:9 | 宇宙探査をテーマにしたYouTubeサムネイル。小さく表示しても主役が瞬時にわかる強い階層。画像内文字は「未知へ」を正確に一度だけ表示。 |
| P12 | Brand mark | 1:1 | 「ORIGIN」という文字を含む、シンプルで独自性のあるモノクロの幾何学的ブランドマーク。文字は正確で読みやすく、余計な記号やモックアップなし。 |

## 3. Scoring rubric

Score each axis from 1 to 5. Use integer scores and write a short evidence note for every score.

- **Instruction adherence (20%)** — required objects, attributes, and exclusions are followed.
- **Composition (15%)** — hierarchy, framing, balance, safe area, and intended format.
- **Subject integrity (15%)** — geometry, anatomy, object consistency, and contact/shadows.
- **Text accuracy (15%)** — exact spelling, script, placement, legibility; mark N/A only for prompts with no text.
- **Style execution (10%)** — requested medium, lighting, materials, and visual coherence.
- **Artifact control (10%)** — malformed details, duplication, clipping, unwanted marks, and obvious generation defects.
- **Professional usefulness (15%)** — suitability for the stated real-world use without corrective editing.

Weighted score = sum(axis score / 5 × axis weight). Report text accuracy separately as well as in the weighted total. A technically valid image does not receive quality points merely for being decodable.

## 4. Decision rules

- **Parity not demonstrated:** fewer than 12 paired prompts, missing originals, non-blind scoring, or any unverified provider/cost facts.
- **Provisional parity candidate:** ORIGIN's mean weighted score is at least the reference mean, neither system has a category mean gap greater than 0.5/5 in ORIGIN's disadvantage, and text-bearing prompts are not materially worse. This is a screening threshold, not a statistical proof.
- **Superiority not demonstrated by mean score alone:** require a larger repeated, blinded evaluation and uncertainty analysis before making a public superiority claim.
- Report all prompt-level results, failures, latency, cost evidence, and limitations. Do not hide failed generations.
- A blocked/unavailable free provider is an availability failure, not a low-quality image; report it separately and do not substitute procedural artwork as an AI result.

## 5. Evidence record template

For each attempt, preserve:

- benchmark version and prompt ID
- provider/model and model version, or **UNVERIFIED**
- request timestamp and latency
- requested and actual dimensions
- output file hash and storage location
- provider's current free-allocation documentation and account-level usage evidence
- observed cost and paid-fallback evidence
- each blind reviewer score plus evidence notes
- errors, retries, and all candidate-selection decisions

## 6. Current evidence state

- **CODE-PROVEN:** repository includes a purpose-specific prompt planner and structural image checks.
- **TEST-COVERED:** the prompt planner has a cross-category unit-test matrix in source; the latest PR head has not yet been shown to have passing CI.
- **UNVERIFIED:** live zero-cost generation, semantic critic effectiveness on real outputs, comparative scores against ChatGPT Image 2, and parity/superiority.
- **Release hold:** do not merge/deploy on the strength of this protocol alone. First get exact-head CI green and independently verify the live free provider and its zero-cost quota.


## 7. Usage-event correlation and retry safety

- A post-generation usage row is not request-specific proof unless the provider exposes a stable correlation identifier that can be tied to the exact generation request.
- ORIGIN currently snapshots event IDs before generation and compares newly observed events afterward. This is a best-effort check, not a distributed lock or cryptographic request-to-event binding.
- If more than one new matching image-generation event is observed, zero-cost verification fails closed. A single matching event is still not proof against a concurrent request from another serverless instance; this limitation must remain visible in release evidence.
- A post-generation usage-verification failure is terminal for that request and marked non-retryable to avoid an automatic duplicate generation. Operators must not manually retry until the first attempt's provider-side outcome and usage are reconciled.
- Do not add automatic provider failover for timeouts, ambiguous network failures, critic failures, or post-generation usage-verification failures. Only a provider response that explicitly proves no inference was accepted may be considered for a separately verified free-provider fallback.
- Process-local serialization, if later introduced, must not be described as global protection across serverless instances.

