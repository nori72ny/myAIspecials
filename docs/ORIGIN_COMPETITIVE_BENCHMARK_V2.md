# ORIGIN Competitive Benchmark V2

Status: protocol and validator contract only. No current performance claim is made by this document.

## Objective

Measure ORIGIN Personal as a complete product and, separately, as a model/runtime where comparable. The benchmark is designed to expose weaknesses, not produce a marketing ranking. No winner is declared unless fresh, paired, independently reviewed evidence supports it.

## Hard constraints

- Budget ceiling: USD 0.00. No paid APIs, models, fallback, provider-triggered billing, or CI inference.
- Live competitor/product runs are manual and outside CI. CI validates schema, policy, and deterministic fixtures only.
- Keep API keys, private task content, account identifiers, and personal data out of evidence bundles.
- Never assign a score to a NOT_RUN system/task.
- Every claim is tied to an exact candidate SHA, task-set digest, rubric digest, evaluator digest, and round ID.
- A free-tier label is not proof of zero cost. Record a verifiable free entitlement or usage record. Local-only is valid only for deterministic local execution with no external calls.
- A quality pass is not permission to merge or deploy.

## Comparison systems

The default target set is:
1. ORIGIN Personal, with exact commit SHA, surface, model/runtime, tools, and free-only routing recorded.
2. ChatGPT, with exact surface and model label shown at run time. Chat, coding, and agent/work surfaces are separate entries.
3. Claude, with exact surface and model label. Claude chat and Claude Code are separate entries.
4. Gemini, with exact surface and model label. Web app and coding/agent surfaces are separate entries.

The evidence must record access tier, date, tools, browsing, file permissions, context, time budget, and execution mode. Product names alone are insufficient identifiers. If a surface is unavailable, include it as NOT_RUN with a reason. At least ORIGIN and two external products must have genuine executed rows before comparative conclusions are allowed.

## Task design

Use at least 30 frozen tasks per round across at least six task families, with at least three tasks per family. Cover:
- Japanese and English factual synthesis and reasoning;
- multi-constraint instruction following and context continuity;
- research, freshness, source grounding, and citations;
- code comprehension, bug diagnosis, patches, and regression tests;
- multi-step agent workflows, tools, recovery, cancellation, and approval boundaries;
- document/artifact creation and editing;
- image understanding/generation/editing where the system genuinely supports it;
- mobile usability, accessibility, and end-to-end task completion.

For answer-quality certification, also run the frozen 48-case / 16-family AQ V2 corpus and its canonical ten axes. For product usability certification, run the dedicated 12-journey suite defined in `ORIGIN_INDEPENDENT_QA_AUDIT_STANDARD_V1.md`. These suites are additive, not substitutes for one another.

Every task must have a frozen prompt/input hash, expected outcome, prohibited behaviors, applicable scoring dimensions, and failure conditions. Preserve the same task, files, constraints, time budget, and comparable permissions across systems. When the surfaces are not comparable, label the result product-level, not model-level.

## Scoring

For each executed system/task pair, retain task-level scores from 0–5 for applicable dimensions:
- correctness and evidence;
- instruction adherence and completeness;
- artifact/code quality;
- robustness, recovery, and calibrated uncertainty;
- usability and clarity;
- efficiency.

Use the common anchors: 0 harmful/failed, 1 severe, 2 weak, 3 acceptable, 4 strong, 5 exceptional. Every score needs observable evidence and a rationale. Coding correctness is gated by tests. Image quality is scored from the actual returned image/artifact. NOT_RUN rows have no score and no pass flag.

Use at least two independent blind judges for subjective scoring, randomized output order, and adjudication for material disagreement. Preserve ties, losses, failures, and timeouts. Report task-level and category-level results, denominators, missingness, effect sizes, and uncertainty intervals. Do not publish a rank from aggregate averages alone.

## Evidence packet V2

The JSON evidence packet must contain:
- schema version, unique round ID, creation time;
- exact candidate SHA;
- task-set, rubric, and evaluator SHA-256 digests;
- at least three distinct system profiles, including ORIGIN and two external products;
- at least 30 distinct tasks across at least six families;
- one row for every task/system pair, including NOT_RUN rows;
- unique execution IDs and input/output SHA-256 hashes for every executed row;
- exact surface/model/plan metadata, execution timestamp, duration, per-dimension scores, pass/fail, and evidence reference;
- zero-cost evidence for each executed row.

The validator checks structural integrity and policy consistency. It does **not** authenticate that a claimed run, judge, score, or cost record is genuine. A human auditor must independently open the evidence reference, verify provenance, recompute hashes, inspect the output, and reconcile cost evidence. Schema PASS is never a benchmark PASS.

## Release and competitive decisions

Release readiness and competitive superiority are independent decisions. A release may be safe without proving superiority. No superiority claim is permitted until the benchmark round is complete, fresh for the exact candidate SHA, independently adjudicated, and free of P0/P1 defects.

Any unresolved P0/P1, fabricated execution, unapproved side effect, cost uncertainty, failed exact-SHA CI, or missing critical evidence is NO-GO. Keep the existing 90% overall / 100% critical release threshold.

## CI scope

CI may run deterministic schema tests and fixtures only. It must not call ChatGPT, Claude, Gemini, image providers, or other live inference endpoints. Live comparisons are explicit, manual, budget-checked, and outside CI.
