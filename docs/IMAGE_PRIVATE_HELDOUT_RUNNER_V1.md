# ORIGIN Image Private Held-Out Runner V1

Status: candidate-side one-shot runner for the 24-case raster image comparison.

## Private corpus
- exactly 24 synthetic tasks;
- exactly 3 tasks per image family;
- every challenge tag covered at least twice;
- prompt SHA-256 + full task digest;
- exact candidate SHA and common execution budget;
- corpus enters only through `ORIGIN_IMAGE_PRIVATE_CORPUS_GZIP_B64`.

## Live provider gate
Before the private corpus is consumed, the workflow runs the existing live raster qualification with `ORIGIN_RASTER_LIVE_QUALIFICATION=true` using server-only Cloudflare credentials.

The one-shot marker is created only after live qualification passes. Missing credentials, paid-plan detection, free-allocation exhaustion, capacity failure, model-plan mismatch, structural failure, semantic failure, or any other blocked qualification does not consume the private corpus.

## Candidate execution
Each frozen prompt is sent exactly once to the real local `/api/creative/v1.5/raster/generate` route.

The runner stores the exact returned candidate image bytes under opaque case IDs and records:
- SHA-256;
- dimensions;
- provider/model identity;
- duration;
- completed/blocked/failed/quota-limited status;
- structural critic result;
- Chromium Canvas pixel critic result;
- delivery-integrity headers;
- zero-cost/fail-closed contract.

Provider or quota failures remain in the evidence and denominator. The workflow does not fan out or retry samples to cherry-pick a favorable output.

## Pixel critic
Chromium decodes each returned PNG/JPEG/WebP, downsamples it to a bounded evaluation canvas, and returns RGBA pixels to the existing deterministic `scoreRasterPixelsV15` critic. This verifies non-empty alpha, non-uniform content, clipping control, and minimum visual information density.

## Sanitized artifacts
The workflow uploads only:
- public task metadata and prompt/task digests;
- candidate image files;
- candidate technical evidence;
- candidate summary.

It does not upload prompt text, negative prompts, or the sealed corpus.

## Final comparison
After the candidate run, an independent evaluator must generate the same 24 frozen prompts with 3 fixed strong reference systems, preserve exact image bytes/digests, and obtain at least 2 independent source-blind judges before assembling `origin.image-blind-benchmark.v2`.

A candidate runner completion alone is not a superiority result.
