# ORIGIN MASTER HANDOVER — 2026-09-16

Owner: ノリさん（オーナー兼社長）  
Repository: `nori72ny/myAIspecials`  
Production: `https://origin-personal.vercel.app`  
Timezone for owner-facing operations: Asia/Tokyo  
Purpose: 次のAI/エンジニアが過去チャットを読まずに、GitHub・Vercelのライブ状態を再検証して安全に作業を継続できるようにする。

---

## 1. 最重要の役割分担

ノリさんはオーナー兼社長で、原則「承認のみ」。実装、設計、原因調査、PR作成、CI確認、マージ、本番検証は担当AI/エンジニアが総合責任者として進める。本人しかできない認証・秘密値の発行・外部サービス承認だけを最小限依頼する。

秘密値、token、API key、private key、DB credentialはチャットやPRへ出さない。接続済みGitHub/Vercel/Supabaseで実行できる操作をユーザーへ丸投げしない。

---

## 2. ORIGINの固定方針

ORIGINは単なるAIチャットではなく、依頼から調査・判断・制作・実行・検証・修正・成果物まで到達するAgentic Production OSを目指す。

ロードマップは以下。

- V1.1 Grounded Research
- V1.2 Real File Artifacts
- V1.3 Web / Application Builder
- V1.4 Agentic Coding OS
- V1.5 Creative / Visual Generation
- V2 Unified Production OS

現在の重点はV1.4。

### 非交渉ルール

- `$0 / freeOnly=true` がハードポリシー。
- paid fallbackは禁止。
- provider/tool/build/runtimeの成功を捏造しない。
- cost/routing/privacyを証明できない経路はfail closed。
- Git write権限とverification containerを分離する。
- benchmark成功とインフラ成功を混同しない。
- held-out benchmark完了前に「Claude Code同等/以上」「世界一」を事実として主張しない。
- pilotを見た後にtask-specific tuningした結果をfinal unseen evidenceとして扱わない。

---

## 3. 2026-09-16 現在のProduction

### main

- Current main SHA: `b7bf039431114e6b297558b65e2e632504ad8292`
- This is merge of PR #285: `fix(v1.4): separate release health from free-provider quota`

### Vercel Production

- Deployment: `dpl_GcSvbU3puStGENVV5wat11m7TwgT`
- Target: production
- State: READY
- Git SHA: `b7bf039431114e6b297558b65e2e632504ad8292`
- Canonical URL: `https://origin-personal.vercel.app`

Latest `/api/health` verified:

- HTTP 200
- `status=ok`
- `service=acos-2`
- `releaseSha=b7bf039431114e6b297558b65e2e632504ad8292`
- `costUsd=0`
- `freeOnly=true`
- `paidFallbackEnabled=false`
- `secretDelivery=server-only`
- `cache-control=no-store`

### Release health vs provider availability

PR #285 separated these concepts.

Release correctness remains gated by exact SHA, build/unit/E2E/Lighthouse/PWA/history/artifact-isolation/security checks. A very specific live inference failure `HTTP 429 + PROVIDER_RATE_LIMITED` after release identity is already verified is recorded as upstream AI availability degraded rather than falsely classifying the deployment itself as broken.

This does NOT mean 429 is ignored. It is preserved as explicit degraded provider availability evidence. Unknown 429s, 503, malformed responses, SHA mismatch, PWA/history/isolation failures remain blocking.

---

## 4. Current provider reality

OpenRouter free models are currently the only configured live provider path for ORIGIN production.

Observed constraints on 2026-09-16:

- OpenRouter free-model quota is account-wide and can hit a daily limit.
- When exhausted, `/api/chat` and V1.4 Coding live inference can return `PROVIDER_RATE_LIMITED`.
- Changing to another OpenRouter free model does not bypass the account-wide quota.
- Groq/Gemini alternate secrets are not currently configured in GitHub Actions.
- Do not solve this by enabling paid fallback.

PR #283 hardened the Coding-only fallback contract:

- invalid North Mini Code fallback was removed;
- a ZDR catalog-verified zero-price tool-capable Ling route was used only for availability failures;
- model failover is not attempted for account-wide 429 rate limit;
- `allow_fallbacks=false`, `data_collection=deny`, `zdr=true`, `max_price=0`, exact served-model verification and reported zero cost remain required.

The UI already has dedicated safe handling for `PROVIDER_RATE_LIMITED`; do not add automatic repeated inference that burns quota.

---

## 5. Important merged V1.4 work

### PR #276
Prioritize explicit held-out paths in bounded discovery. Added safe terminal `CODING_*` evidence.

### PR #277
Provider resilience + deterministic owner-named scope while keeping fixed zero-cost policy.

### PR #278
Trusted held-out runner binds public `requiredChangedPaths` directly into trusted coding scope. This removed benchmark discovery/navigation from blocking editing evaluation.

### PR #279
Per-trusted-request bounded retry budget and one fresh re-plan after strict edit-match correction failure.

### PR #281
Added bounded Coding-only free-model failover. Initial model choice later proved unusable under strict ZDR.

### PR #282
Fixed failover evidence UTC clock bug.

### PR #283
Hardened zero-cost ZDR coding failover and stopped model-switching on account-wide rate limits.

### PR #284
Merged final held-out qualification gate.

Qualification gate requires, before any final V1.4 completion claim:

- 6–16 final held-out tasks;
- at least 2 `recoveryRequired` tasks;
- one frozen base SHA;
- uniform time budget;
- unique opaque task IDs and task digests;
- multi-file contracts;
- coverage of:
  - navigation/multi-file editing
  - feature/new-file work
  - regression recovery
  - build/typecheck repair
  - security/path boundary
- first-run/one-shot provenance;
- `engineeringObservedBeforeRun=false`;
- `taskSpecificTuningAfterFreeze=false`;
- no observed pilot corpus/task identities;
- zero-cost evidence.

### PR #285
Separated release integrity from temporary free-provider quota degradation without weakening release checks.

---

## 6. Held-out pilot history — diagnostic only

Public pilot corpus digest:
`164fd7fb686b982f2ef9b8226388f5eb82038e03266ea84174daafeaba61e808`

This pilot was observed repeatedly during engineering. It is contaminated for final generalization evidence and MUST NOT be used for final V1.4 qualification.

Observed pilot task digests are encoded in `src/agent/heldOutCodingFinalPrivateCorpusV14.ts` and are explicitly rejected by the final qualification path.

Historical pilot progression:

- initial runs: discovery/path failures prevented edits;
- PR #278 removed that benchmark-controller discovery blocker;
- later run reached real multi-file editing and verification on at least one task;
- subsequent runs were dominated by provider timeout/truncation/rate-limit failures;
- account-wide free quota prevented a clean final pilot performance reading.

Never convert the pilot score into a final capability claim.

---

## 7. Current unfinished work — MOST IMPORTANT

### Active branch

`feat/v14-final-heldout-sealed-runner`

Current branch head:
`82f1d2217f61c4d62306cf55c195297387813780`

The branch is based on the latest main `b7bf0394...` and is currently 4 commits ahead of main with no PR yet.

Changed files vs main:

- `src/agent/heldOutCodingFinalPrivateCorpusV14.ts` — added
- `src/agent/heldOutCodingFinalPrivateCorpusV14.test.ts` — added
- `src/agent/heldOutCodingFinalQualificationV14.ts` — extended
- `src/agent/heldOutCodingFinalQualificationV14.test.ts` — extended

Recent commits on the branch include:

- reject observed final task digests;
- reject observed final task identities;
- add sealed final held-out corpus format;
- cover sealed final held-out corpus.

### Sealed final private corpus format

`HELD_OUT_FINAL_PRIVATE_CORPUS_VERSION_V14 = origin-held-out-final-private-corpus-v1`

The private corpus:

- contains private task packets plus public coverage labels;
- requires 6–16 tasks;
- validates unique IDs and task digests;
- converts to a public projection without exposing prompts/hidden tests/reference solutions;
- computes a canonical SHA-256 corpus digest;
- rejects known observed pilot corpus/task identities;
- enforces the already-merged final qualification gate;
- accepts gzip+base64 sealed input;
- maximum compressed size: 128 KiB;
- maximum expanded size: 1536 KiB.

Private prompt, expected solution, reference patch and hidden tests MUST remain outside the public repository.

### Immediate next engineering action

1. Review exact branch diff and ensure no private benchmark material is present.
2. Open a PR from `feat/v14-final-heldout-sealed-runner` to `main`.
3. Run exact-head required CI/security/release gates.
4. Fix anything failing in the PR only; do not relax safety checks.
5. Merge only after all required checks pass.
6. Confirm Vercel Production exact new main SHA and `/api/health` boundaries.
7. Then add/complete the trusted final-run execution workflow/controller that consumes the sealed final private corpus exactly once.
8. Only after runner infrastructure is frozen should a NEW unseen final private corpus be authored/frozen outside the public repo.
9. Final corpus must satisfy PR #284 qualification requirements and must not reuse any pilot identities.
10. Execute the final corpus once. Do not selectively rerun failed tasks to improve the score.
11. Collect public evidence: task identity digest, base SHA, participant/provider/model, duration, cost, attempts, changed paths, typecheck/lint/test/build, terminal status/code, axis results, solve count/rate.
12. Do not tune against the final corpus after first observation. Any such tuning invalidates it as final unseen evidence and requires a NEW corpus.

---

## 8. Final held-out result interpretation

The final qualification gate is a provenance/eligibility gate, not a marketing score generator.

A final run can report observed solve count/rate and axis counts. Do not invent a pass threshold after seeing results. If a threshold is desired, define it before the final run or report raw evidence neutrally.

Claude comparison, if ever performed, must use the same frozen task packet/base/hidden tests/time budget/evaluator conditions. External paid Claude runs require explicit owner authorization for account/cost. No such parity has been proven yet.

---

## 9. Open/stale branch/PR hygiene

PR #280 (`fix/v14-free-coding-model-20260916`) is still open and is stale relative to later merged provider work. Do NOT merge it as-is. Review and close it once the current sealed-final runner work is safely PR'd, unless a still-unique change is proven necessary.

Diagnostic branches used for provider probing/benchmark triggering must never become product authority. Keep main + current feature PR as the source of truth.

---

## 10. How the next AI should resume

At the start of a new chat:

1. Read this file and `docs/ORIGIN-HANDOVER.md`.
2. Live-check GitHub `main`, open PRs, and `feat/v14-final-heldout-sealed-runner`.
3. Live-check Vercel Production and `/api/health`.
4. Confirm whether provider availability is degraded; do not confuse it with deployment integrity.
5. Continue from the sealed-final corpus branch; do not return to the observed pilot for tuning.
6. Keep owner involvement to approval/auth only.
7. Update this handover or create a newer dated handover before ending a long work session.

Recommended first prompt for the next chat:

> `ORIGIN_MASTER_HANDOVER_2026-09-16.md` を正本として読み、GitHub/Vercelのライブ状態を再確認してから続けてください。私はオーナー兼社長で原則承認のみです。現在の最優先はV1.4 final held-outのsealed corpus runnerをPR化・CI・merge・Production確認し、その後に未見final corpusを一度だけ実行できる状態へ進めることです。$0/freeOnly、paid fallback禁止、ZDR/秘密保持、pilot汚染排除を絶対に維持してください。

---

## 11. 現時点の完了/未完了

### 完了

- V1.4 durable Coding infrastructure
- bounded discovery/scope safety
- multi-file mutation/verification plumbing
- hosted held-out runner infrastructure
- pilot corpus runner
- retry/replan hardening
- production exact-SHA health verification
- artifact preview isolation
- zero-cost/ZDR fail-closed routing policy
- final held-out qualification gate (#284)
- release health vs provider quota separation (#285)
- current Production deployment of main `b7bf0394...`

### 未完了

- sealed final private corpus runner PR/merge
- final-run trusted one-shot workflow wiring, if not already fully covered by the branch after live re-check
- creation/freeze of a NEW unseen final private corpus
- first and only final unseen run
- final evidence analysis
- any Claude Code parity claim
- V1.4 completion declaration

---

## 12. Safety note for future work

The biggest current risk is not a missing feature but accidentally invalidating the final benchmark by observing/tuning against it. Freeze runner infrastructure first, then freeze a never-before-observed final corpus, then run once. If the final corpus is inspected before run or engineering changes are made using its failures, retire it and create a new corpus.

The second major risk is treating a free-provider quota as a software-release failure or bypassing it with paid/less-private routing. Preserve the separation introduced in PR #285 and the `$0/ZDR/fail-closed` policy.
