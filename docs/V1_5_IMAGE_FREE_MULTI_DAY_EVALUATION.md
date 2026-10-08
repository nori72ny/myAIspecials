# ORIGIN image — Free-only, multi-day private qualification (candidate V1)

**Status: engineering candidate / NOT production-approved.** This document does not authorize merging, image model expenses, new public access, or claims of world-class superiority.

## Why multi-day

Cloudflare Workers AI Free grants 10,000 Neurons per UTC day. FLUX.2 Klein 9B costs 1,363.64 Neurons for the first megapixel, with additional charges for subsequent output megapixels and image inputs. A 24-case one-day round is unsafe. The old 24-case manual workflow is deliberately blocked **before any inference**.

The immutable planner retains **all 24 held-out cases, eight families × three cases**, without cherry-picking. It divides them into **12 shards of at most two cases**. The conservative planner reserves room for the permitted one repair generation and the semantic critic. Those are **estimates**, not authenticated Cloudflare usage records. Other ORIGIN requests may already have consumed Free daily Neurons.

## Exactly which software runs

- `scripts/inspect-image-private-corpus-v1.ts`: validates the sealed original corpus and prints public-only case hashes and the frozen plan digest. Never prints private prompt text.
- `scripts/preflight-world-class-image-v16.ts`: verifies that the actual V1.6 compatibility router reports the **Cloudflare Free** provider, zero spend, no paid fallback and evaluation readiness. It does not perform a generation.
- `scripts/run-world-class-image-private-heldout-v2.ts`: now **requires** `ORIGIN_IMAGE_SHARD_INDEX`, `ORIGIN_IMAGE_SHARD_PLAN_DIGEST` and `ORIGIN_IMAGE_SHARD_UTC_DAY`; evaluates only those case IDs through the actual `/api/creative/v1.6/world-class/generate` route. Invalid or missing shard inputs fail closed; a direct unsharded execution cannot generate 24 images.
- `.github/workflows/world-class-image-private-shards-v1.yml`: manual-only, exact-main-SHA, global serialized Free-account queue; checks one-shot per-shard GitHub artifacts and prohibits two shards on one UTC day. A candidate commit older than 31 days cannot run after the 90-day marker retention interval.
- `npm run eval:image-private-shards-verify`: offline auditor, expecting subfolders `shard-0` through `shard-11` under `ORIGIN_IMAGE_SHARD_BUNDLE_ROOT`. Verifies **actual image file bytes vs SHA-256**, 24 case identities, zero-cost case metadata, the technical and semantic verdict, model consistency and 12 distinct UTC days. It writes `local-integrity-report.json` only after successful integrity checks.

## Evaluation operator steps

1. Freeze one candidate commit SHA, one evaluator-controlled, prompt-sealed 24-case corpus, one prompt compiler and model, reference models, blind evaluator, independent judges and rubric. Bind corpus `candidateSha` to that **exact commit**. Do not silently regenerate prompts or remove failing cases.
2. Configure `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `ORIGIN_IMAGE_PRIVATE_CORPUS_GZIP_B64` **in authorized secrets settings**. Never paste credentials or sealed prompt text into commits, logs, ChatGPT, issue comments or artifacts. A Vercel Production secret is distinct from GitHub Actions secrets; neither may be assumed present merely because the other exists.
3. Perform real provider Free plan/read-permission verification and check **actual remaining daily Neurons** from the provider dashboard/verified accounting before each day. Do not infer live quota from the planner, billable estimates or self-reported JSON. Stop before inference if Free-account status or remaining allowance is ambiguous.
4. Use a trusted evaluator runner at the exact candidate SHA. The new GitHub manual workflow is restricted to `main`: it cannot be used as an excuse to merge an unqualified image feature to Production. Until its controlled evaluator workflow is available on the default branch, a pre-publication run requires an independently authorized, access-controlled runner using the exact candidate checkout. **Do not bypass the Release Gate by merging this PR to activate the workflow.**
5. Run **one frozen shard per distinct UTC day**. Each failed or aborted attempt consumes that shard's one-shot marker. It cannot be retried on the same frozen corpus to pick a luckier sample; use a fresh precommitted corpus/evaluator round for a new attempt.
6. Obtain authenticated GitHub Actions run IDs/artifact hashes and actual provider usage evidence **independently**. Collect the 12 sanitized shard artifacts into `shard-0` ... `shard-11` and run the offline file-integrity verifier. The local verifier checks hashes, **not** authenticated artifact origin, provider accounting or relative image quality.
7. Construct the normal 24-case technical-and-blind packet with **three fixed competitor references and at least two independent blind judges**, plus a separate **16-case editing benchmark**. Apply all current exact-head and held-out publication thresholds. Missing/worse/unknown quality is a blocking result, not a pass.
8. Verify all exact-head CI, independent audits, real desktop/mobile UI and Android keyboard checks, output visual fidelity and the owner's required visual and explicit release approvals. Then—and only then—merge/deploy an approved exact commit and run Production smoke tests. Do not label `world-class` merely because a provider or local digest check passed.

## Authenticating the 12-day image artifacts (still unexecuted)

The manual `.github/workflows/world-class-image-private-collect-v1.yml` workflow is read-only, main-only, exact-SHA-bound, and requires the precommitted corpus+plan digests. It calls `scripts/collect-world-class-image-free-shards-v1.ts`, which uses GitHub's authenticated API to confirm **12 successful distinct workflow-dispatch runs** on the same exact candidate SHA and main branch, all from the frozen per-shard workflow, with distinct UTC days, one-shot markers and non-expired named artifacts. It obtains only those named artifacts with `gh run download` into 12 separate directories. The offline `npm run eval:image-private-shards-verify` then verifies the **24 actual image files** against the original sealed case digests, reference-free task metadata, provider identity and zero-cost/semantic/technical flags.

An accepted GitHub artifact **does not establish Cloudflare billing usage**. The trusted collector deliberately reports `cloudflareFreeQuotaIndependentlyVerified=false`. Likewise the local hash verifier never sets independent blind image quality or owner approval to true. Only a separate trusted full 24-case blind comparison and approved release gate can qualify the product.

This workflow is not callable on the draft branch without default-branch workflow registration. Do not weaken that rule, merge unfinished changes or expose sealed corpus secrets merely to make evaluation easier.

## Separate high-quality image-edit qualification (still unexecuted)

V1.5's sealed 16-case edit runner targets `/api/creative/v1.5/raster/edit`; it **cannot** qualify the newer V1.6 high-quality edit API. Reusing its pass as a V1.6 pass is forbidden.

The V1.6 `/api/creative/v1.6/world-class/edit` router now rejects a returned image whose SHA-256 matches any unchanged source/reference image, before semantic critique, and labels task and reference count on successful outputs. This only proves a non-identical output, **not** preservation of people/products/background or accurate local edits.

`src/release/OriginImageEditFreeShardPlanV1.ts` freezes the existing eight image-edit task families (16 cases total) into eight conservative two-case per-UTC-day Free-only shards. It binds candidate SHA, original corpus digest, task ID, edit instruction SHA-256 and source image SHA-256. Its planner **does not** send image requests or assert quality passes. The new `scripts/run-world-class-image-edit-private-shard-v1.ts` and manual `world-class-image-edit-private-shards-v1.yml` now provide the V1.6 **execution path**, restricted to exactly the frozen 1–2 cases per UTC day. They verify Free provider status before opening the sealed corpus, require a pinned candidate/plan/UTC day, and run the actual `/api/creative/v1.6/world-class/edit` route. Their per-shard record explicitly says independent blind edit quality and Production qualification have **not** passed. Authenticated 16-case source-preservation comparison, independent edit judges and actual 8-day execution remain mandatory.

The same Cloudflare Free allowance is **account-wide**. Both manual evaluation workflows share one serialized concurrency group and check/upload the same `origin-image-ai-free-account-day-YYYY-MM-DD` artifact **before inference**, so only one benchmark shard is permitted on that UTC day. This is an accounting lock for these GitHub workflows only: ordinary Production traffic and other Cloudflare clients are outside it. A genuine provider usage check remains required.

## Fail-closed release interpretation

Even when the local 24-image aggregator succeeds, it intentionally returns:

- `authenticatedGitHubArtifactProvenance: false`
- `liveFreeQuotaUsageVerified: false`
- `independentBlindQualityPassed: false`
- `ownerVisualApproval: false`
- `productionQualified: false`

Those require independent trusted evidence and approval. They **must not** be overwritten by manual editing or a script that merely combines self-reported summaries.

## Current blockers

- Provider credential and real Cloudflare Free status/usage have not been established for the candidate; configured Vercel Production token presence was not verified.
- The GitHub manual workflow is draft-branch code; default-branch registration and/or an independent pre-release runner is required before running the real sealed round.
- No authenticated 12-day 24-case imagery or independent blind superiority packet is available.
- The separate editing held-out round and owner visual approval have not been completed.
- All exact-head workflows must pass again whenever this PR's head changes.

Sources for Cloudflare pricing and Free allocation: https://developers.cloudflare.com/workers-ai/platform/pricing/
