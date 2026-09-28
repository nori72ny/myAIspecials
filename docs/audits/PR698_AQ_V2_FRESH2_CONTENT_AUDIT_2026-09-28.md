# PR #698 — AQ V2 fresh-2 content audit

Date: 2026-09-28 JST

## Scope

This audit reviews the 48 sanitized answer outputs from trusted run `36376317133` for candidate:

`d0c307fd3d915474730a033fc46e273cbb6a6231`

Binding:
- corpus: `origin-aq-v2-independent-2026-09-28-fresh-2`
- round: `round-2026-09-28-independent-fresh-2-corrected-1`
- trusted execution: 48/48 completed
- zero-cost execution: verified by the trusted run
- sealed prompts/evaluator notes: used only inside the trusted audit and intentionally not reproduced here

This is a **content-only independent audit**. The frozen AQ V2 rubric has 10 axes, but `visualReadability` requires per-case 390px and 1440px evidence. That evidence is not part of the fresh-2 answer artifact, so this report does not claim official AQ V2 absolute qualification.

## Nine non-visual axis means

| Axis | Mean | AQ V2 minimum | Status |
| --- | ---: | ---: | --- |
| truth | 3.1250 | 3.75 | FAIL |
| intentFit | 3.6875 | 3.60 | PASS |
| completeness | 3.5417 | 3.50 | PASS |
| structure | 3.9167 | 3.50 | PASS |
| clarity | 3.9792 | 3.50 | PASS |
| informationDensity | 3.5417 | 3.25 | PASS |
| actionability | 3.5208 | 3.40 | PASS |
| taskFit | 3.6458 | 3.60 | PASS |
| evidenceUsability | 3.1042 | 3.50 | FAIL |

Nine-axis content-only mean: **3.5625**.

Do not compare that number directly with the official AQ V2 overall >= 3.55 gate, because the official overall includes `visualReadability` and requires viewport evidence.

## Family means — content only

| Family | Mean | Minimum | Status |
| --- | ---: | ---: | --- |
| current-factual | 3.8519 | 3.25 | PASS |
| research-synthesis | 3.4444 | 3.25 | PASS |
| multi-source-comparison | 2.8889 | 3.25 | FAIL |
| contradiction-resolution | 3.5185 | 3.25 | PASS |
| explanation-teaching | 3.7407 | 3.25 | PASS |
| summarization | 4.0000 | 3.25 | PASS |
| writing-rewrite | 3.5926 | 3.25 | PASS |
| translation | 3.8519 | 3.25 | PASS |
| quantitative-reasoning | 3.1481 | 3.25 | FAIL |
| data-analysis | 3.8519 | 3.25 | PASS |
| decision-support | 2.8519 | 3.25 | FAIL |
| professional-advice | 3.4444 | 3.25 | PASS |
| coding-explanation | 3.5556 | 3.25 | PASS |
| coding-generation-repair | 3.4074 | 3.25 | PASS |
| artifact-generation | 3.9630 | 3.25 | PASS |
| ambiguity-handling | 3.8889 | 3.25 | PASS |

## Hard delivery failures

Three cases incorrectly refused tasks that did not require live public retrieval:

- `aq4-03-2` — stable conceptual comparison was not delivered.
- `aq4-09-2` — deterministic arithmetic was not delivered.
- `aq4-11-3` — decision-support validation framework was not delivered.

These failures materially explain the family-floor failures above.

## Other material findings

- `aq4-07-1`: removed the original superlatives but introduced unsupported claims about case studies and competitive superiority.
- `aq4-14-3`: the proposed catch-and-log repair still consumes the error unless it is rethrown or otherwise propagated.
- `aq4-12-1`: contains an over-broad legal/compliance assertion despite a request for non-definitive practical guidance.
- `aq4-13-1`: the async `forEach` explanation is misleading; `forEach` does not await callbacks and should not be described as sequential execution.

## Qualification conclusion

PR #698 is **not yet eligible for AQ V2 absolute-quality qualification**.

Current blockers from this content audit:
1. `truth` below minimum.
2. `evidenceUsability` below minimum.
3. Three families below the 3.25 family floor.
4. Per-case 390px/1440px visual evidence is not established for this fresh-2 binding.
5. Blind competitive evidence against >=3 anonymized reference systems and >=2 independent judges remains a separate required gate.

Trusted execution success and `qualificationPassed=true` from the runner prove execution/provenance/isolation/$0 conditions; they do **not** prove answer-experience quality.

## Recommended repair order

1. Fix retrieval routing so stable conceptual, arithmetic and framework tasks never fail closed merely because public retrieval is unavailable.
2. Remove unsupported invented evidence/competitive claims from rewrite behavior.
3. Tighten professional-advice qualification and technical explanation accuracy.
4. Repair error-propagation guidance in coding answers.
5. Run a new independently sealed corpus after the candidate changes; do not reuse the consumed fresh-2 corpus.
6. Only after content thresholds pass, produce exact-binding viewport evidence and blind competitive evidence.

No merge or production publication decision for PR #698 is made by this audit.
