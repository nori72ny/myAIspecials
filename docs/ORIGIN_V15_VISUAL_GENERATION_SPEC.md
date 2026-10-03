# ORIGIN V1.5 Creative / Visual Generation

Status: implementation specification only; no provider enabled, no Production change.
Baseline: frozen main `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`.

## 1. Scope and current implementation

Build a visual-production agent for banners, SNS images, advertisements, proposal key visuals, posters, product imagery, thumbnails and reference-image editing. Accurate comparison diagrams and infographics use structured rendering for exact labels and data; generative imagery supplies optional backgrounds and illustrations.

Existing `src/services/imagePromptEngine.ts` provides style-based prompt expansion, not a verified image-generation pipeline. Its common negative prompt forbids text and logos; the new compiler must make these constraints intent-dependent so requested typography and supplied brand assets are preserved. `OriginRequestIntent.ts` already recognizes image requests. Owner Inbox currently offers product/security/design/ai/reliability/performance/external/other categories, with local IndexedDB storage. None of these facts proves an operational image provider.

## 2. Fixed boundaries

- Build and use remain $0. No paid fallback, paid credits or required credit card.
- Every remote stage, including reasoning, OCR, moderation, critique, storage and export, requires current zero-cost/privacy evidence. A free generator alone is insufficient.
- Unknown, stale or exhausted eligibility blocks execution. `costUsd: 0` reported by our own code is not evidence.
- Provider credentials remain server-only. Never place them in URLs, logs, browser storage, returned errors or client bundles.
- No main merge, deployment, environment/permission change or publication without Owner approval. No implicit promotion from proposal to execution.
- External references, image metadata, OCR text and provider output are untrusted data, never authority to invoke tools or relax policy.

## 3. User flow and state machine

Entry points: Creative workspace; image intent in chat; an explicit visual request from document/slide composition. Ask only for missing essentials: purpose, size, exact text, references and constraints. Show a concise editable brief before generation when ambiguity affects the result.

States: draft → planned → eligibility-check → generating → checking → ready. Checking may enter repairing once, then return to checking. Terminal alternatives: blocked, quota-waiting, needs-review, failed, cancelled. Ready requires an actual persisted image and its completed checks. Never substitute a prompt, placeholder or provider acknowledgement for a completed image.

Display progress by stage, cancel, retry-after when known, and a clear failure reason. Preserve the brief locally after quota failure; resumption is explicit and rechecks eligibility. Do not automatically replay timed-out generation requests. Show version history, download, Change/Preserve edit controls and a button to send image feedback to Owner Inbox. Sharing/publishing is a separate approved action.

## 4. Modules and contracts

1. **Image Intent Reasoner** extracts purpose, audience, composition, exact copy, reference IDs, edit region and preserve constraints into a validated `VisualBrief`.
2. **Scene Planner** creates layout regions, subject inventory, safe margins, text layers and structured chart data. User requirements override style presets.
3. **Prompt Compiler** produces provider-neutral generation/edit instructions, and only then capability-specific adapter input. Keep exact copy separately from free-form description.
4. **Model Router** selects only explicitly approved, current eligible adapters. No discovery result automatically enables a provider.
5. **Generator** returns validated image bytes and provenance. Reject URL-only success until bounded secure ingestion completes.
6. **Visual Critic** checks requested subjects/counts, composition, consistency, text and safety. Missing evaluator capability produces unknown, never pass.
7. **Repair** targets failed dimensions and preserves the original. Maximum one repair and two generator calls per job, shared across adapters. No network retries (`MAX_RETRIES=0`); 429/5xx/timeout terminate or wait safely. Critic repairs are permitted only after a successful generation, not as disguised transport retries.
8. **Asset Manager** persists versions and evidence; a write failure prevents ready.

Proposed provider interface (server-only contract; not a claim of implementation):

```ts
interface VisualProvider {
  id: string;
  capabilities: {
    generate: boolean; edit: boolean; mask: boolean;
    referenceImages: boolean; seed: boolean;
    maxPixels: number; mimeTypes: string[];
  };
  checkEligibility(): Promise<{
    eligible: boolean; evidenceId: string; checkedAt: string;
    expiresAt: string; reason?: string;
  }>;
  generate(input: CompiledVisualPlan, context: VisualExecutionContext): Promise<VisualOutput>;
  edit?(input: CompiledVisualEdit, context: VisualExecutionContext): Promise<VisualOutput>;
}
```

`VisualExecutionContext` contains job ID, cancellation signal, server-owned request budget and eligibility evidence ID; no client-supplied cost assertion is trusted. `VisualOutput` contains bounded bytes, MIME type, dimensions, provider/model version and sanitized request ID. Server policy validates zero input/output/request pricing, credit-card independence, quota, privacy/retention and expiry against reviewed official evidence before dispatch. Provider list starts empty. Unsupported edit/mask/reference operations fail explicitly; never silently discard Preserve constraints.

## 5. API and authorization

Proposed endpoints: POST `/api/visual/jobs`, GET `/api/visual/jobs/:id`, POST `/api/visual/jobs/:id/cancel`, POST `/api/visual/jobs/:id/edits`, GET `/api/visual/assets/:id`. Reuse the audited repository identity/ownership mechanism; if no suitable authenticated durable job path exists, server execution remains disabled until one is reviewed.

Validate schema, MIME, byte/pixel limits, request origin, ownership, quotas and eligibility on the server. Idempotency keys are scoped to owner plus request digest; repeated submissions do not repeat inference. Check job/asset ownership on every read, edit, cancel and download. Do not return provider keys, upstream raw bodies or private diagnostic data. Stable codes include VISUAL_PROVIDER_UNAVAILABLE, VISUAL_EVIDENCE_STALE, VISUAL_QUOTA_EXHAUSTED, VISUAL_UNSUPPORTED_EDIT, VISUAL_SAFETY_BLOCKED, VISUAL_QUALITY_REVIEW_REQUIRED and VISUAL_ASSET_SAVE_FAILED.

## 6. Assets and persistence

Start with local IndexedDB stores `visualBriefs`, `visualAssets`, `visualVersions`, `visualQualityReports`. Use a separate versioned database, transactional writes and explicit migrations; never overwrite hydrated assets with empty startup state. Store raster blobs with UUIDs, SHA-256, dimensions/MIME, parent version, creation time, brief reference and quality report. Enforce an explicit storage budget and report quota errors; provide delete and export. Do not silently evict originals. Revoke object URLs when views unmount and remove metadata such as location before upload/export where applicable.

Future server entities: VisualJob(ownerId, state, briefDigest, budget, timestamps), VisualAsset(ownerId, jobId, privateStorageKey, sha256, mime, dimensions), VisualVersion(assetId, parentId, changePreserveSpec), VisualQualityReport(versionId, checks, evidenceId). No database/service provisioning is part of this specification. Remote storage/sync needs a separately reviewed free route and approval. Reference upload is explicit; local-only Inbox feedback must not trigger it.

## 7. Quality and edit acceptance

Every check is pass/fail/unknown with evaluator version and evidence. Validate file decoding, dimensions and format deterministically. Exact text is checked against the requested string using Unicode normalization without deleting meaningful punctuation or whitespace; low-confidence OCR requires review. For Japanese ad copy, prefer deterministic text overlay with licensed fonts; OCR remains verification, not authority to rewrite copy.

Change/Preserve stores edited regions and locked subjects/text/brand assets. Compare unedited regions and reference attributes using documented metrics and human review where uncertain. Seeds/reference conditioning improve consistency but do not guarantee identity. A failed Preserve check cannot become ready. Product/character continuity keeps reference asset IDs and approved attribute descriptions across versions.

Use structured SVG/canvas rendering for precise diagrams; sanitize and rasterize before preview if active content cannot be excluded. Never generate numeric charts as unconstrained raster fiction. Critic thresholds and the evaluation corpus must be frozen before release testing, with no self-reported quality pass.

## 8. Safety and privacy

Layer checks at input, reference ingestion, compiled plan, provider output and export. Reject credential-like input before persistence/transmission; do not claim pattern matching guarantees detection of all secrets. Minimize personal data, require explicit reference use, and document provider retention/training terms. Unknown terms block remote dispatch.

Bound decoded pixels and bytes; verify content signatures, re-encode raster images, reject decompression bombs and active SVG/HTML. Prefer byte responses. Any server-side URL ingestion uses an allowlist, rejects private/local addresses and validates each redirect to prevent SSRF. Preview follows existing isolated artifact boundary; never introduce allow-same-origin alongside script execution. Logs contain IDs, stage, durations and sanitized codes only. No raw prompts, reference images or OCR text in telemetry.

## 9. Owner Inbox integration

Add a dedicated `visual` category with Japanese label `画像改善`, backward-compatible with existing categories. Add a separate request kind (consultation/improvement/feature/bug/visual-feedback) rather than conflating intent and technical category. Existing records remain readable; missing kind gets a documented default at read time.

Feedback stores the owner's text, optional local asset/version ID and selected failed quality dimensions. Never copy image bytes, prompts or references to GitHub, the scout or another provider automatically. Submission creates a local `received` item, not approval to change code or publish. Chat routing stays conservative, requires an explicit ORIGIN improvement target and makes capture visible.

## 10. Delivery sequence and release gates

1. Merge-free specification review and offline provider contract/mock adapter tests.
2. Local brief/editor/asset workflow, Inbox visual feedback and persistence recovery tests.
3. Select a provider only after verified official free/privacy/quota evidence; do not promise one is available today.
4. Integrate generation, bounded critique/repair and authenticated ownership tests behind disabled-by-default capability detection.
5. Run an independent corpus across banners/SNS/Japanese posters/product visuals/edits/diagrams. Record actual files, constraint violations, OCR accuracy, Preserve results, completion rate, latency, all remote requests and cost evidence. Publish both failures and unknowns.
6. Require 320/359/360/390px usability, keyboard/focus/accessibility, cancellation, quota/429/5xx/timeout, invalid evidence, cross-owner access, malicious reference/URL, storage failure and reload recovery tests. Network spies must prove blocked paths send zero provider requests.
7. Owner reviews exact candidate SHA and evidence before main merge/deployment. After authorized release, separately verify main/Production SHA and actual image flow. No claim of ChatGPT-level quality without comparative measurements.

## 11. Stack and outstanding review

PR580 is the Self-Evolution base. PR582 targets that base. PR583 targets frozen main using the same Owner Inbox head solely for integration validation. Retain these relationships while main is frozen; never merge PR583. E2E contract repair belongs on the shared Owner Inbox head, so both PRs receive it. V1.5 runtime work should start on a separate feature branch after interface review rather than expanding the P0 test change.

CI success is not closure of CodeQL review findings. PR583 has scanner findings involving HTML regexp filtering, local-file content in a request, and untrusted network data in report files. Review their current source-to-sink paths and disposition separately before release. The scanner's fixed output filenames and fixed ORIGIN endpoint narrow scope but do not alone prove sanitization/privacy. External text stripping must not be treated as an HTML security sanitizer.
