# ORIGIN Independent Quality & Competitive Audit Standard V1

Status: audit contract. This standard defines how ORIGIN is independently evaluated; it does not assert that any current ORIGIN capability is superior to another product.

## 1. Mandate and independence

The auditor's job is to find reasons a release or superiority claim should fail. Development ownership and audit ownership must remain separate in the evidence record.

The audit must distinguish four different propositions:

1. **Implemented** — code or product surface exists.
2. **Verified functional** — the exact candidate passed relevant deterministic and end-to-end tests.
3. **Usable and high quality** — representative users/tasks demonstrate acceptable task success, effort, accessibility, and output quality.
4. **Competitively qualified** — comparable, current, independently collected evidence shows performance against named reference systems.

No proposition implies the next. A workflow pass, evaluator implementation, smoke test, or self-review is never proof of competitive superiority.

## 2. Audit domains

Every release candidate is assessed across the domains below. Mark non-applicable items with a reason; never silently omit them.

### A. Answer correctness and epistemic reliability

Inspect each answer for:

- factual correctness, including currentness and time sensitivity;
- source quality, provenance, and whether the source actually supports the claim;
- citation precision, completeness, and link integrity;
- unsupported claims, fabricated references, fabricated tool use, and fabricated completion;
- contradictions within the answer and against supplied context;
- numerical reasoning, units, rounding, arithmetic, dates, and boundary conditions;
- causal reasoning versus correlation, and distinction between fact, inference, and opinion;
- uncertainty calibration, limitation disclosure, and appropriate abstention;
- ambiguity handling and whether clarification is necessary or wasteful;
- instruction hierarchy, explicit constraints, and complete requirement coverage;
- multilingual accuracy, Japanese naturalness, terminology, and preservation of nuance;
- context continuity, correct reuse of prior user-provided facts, and avoidance of repeated questions;
- privacy, sensitive-data minimization, and refusal/redirect behavior where required.

A material falsehood, invented citation, false claim of execution, or concealed uncertainty is a critical defect even when the prose is polished.

### B. Intent understanding and task completion

Score whether the system:

- identifies the user's actual goal rather than matching keywords;
- preserves all explicit constraints and implied dependencies;
- asks only for information that is genuinely necessary;
- chooses a sensible low-risk default when the user delegates decisions;
- completes the requested deliverable in the requested format;
- distinguishes partial completion from full completion;
- verifies that the deliverable meets the user's acceptance criteria;
- provides a useful next action without burdening the user unnecessarily.

### C. Usability and interaction design

Evaluate the complete user journey, not only screenshots:

- task success rate and first-attempt success;
- time on task and number of user actions/turns required;
- unnecessary clarification, repetition, and user rework;
- discoverability of primary actions and feature affordances;
- navigation predictability, information architecture, and terminology consistency;
- input/composer ergonomics, keyboard behavior, focus management, and attachment flow;
- feedback during processing, progress transparency, and understandable failure states;
- recovery after network, model, tool, upload, or generation failures;
- prevention of data loss, duplicate submissions, and accidental destructive actions;
- mobile reachability, viewport fit, safe areas, scrolling, and touch-target separation;
- responsive behavior at 320, 360, 390, 412, 768, 1024, and 1440 CSS px where supported;
- accessibility: keyboard-only operation, screen-reader names/states, contrast, focus visibility, reduced motion, and WCAG 2.2 AA-relevant checks;
- readability: hierarchy, line length, density, tables, code, citations, long-answer navigation;
- perceived latency, actual latency, and stability under slow responses;
- user confidence: whether the interface accurately communicates what happened and what remains.

A screen that looks attractive but requires extra taps, hides controls, loses input, or misrepresents progress fails usability.

### D. Reasoning and problem solving

Measure decomposition, assumption management, constraint satisfaction, multi-step consistency, quantitative accuracy, counterexample handling, and whether the final answer follows from the presented evidence. Include adversarial and misleading-premise cases.

### E. Research and tool use

Measure search/tool selection, source diversity, freshness, relevance, retrieval completeness, citation-to-claim alignment, tool-call necessity, error handling, safe retries, and whether tool outputs are independently verified. A tool invocation is not task completion.

### F. Agent execution and autonomy

Measure planning, tool choice, execution, state tracking, verification, recovery, idempotency, cancellation, stop behavior, approval boundaries, side-effect containment, and honest terminal reporting. Any unapproved external write, secret exposure, false completion, or action after cancellation is a hard failure.

### G. Artifact and code quality

Measure correctness, completeness, structural validity, editability, maintainability, accessibility, responsive behavior, reproducibility, test quality, regression risk, and immediate usability. For code, require tests and build evidence; for files, inspect the actual rendered/opened artifact rather than only metadata.

### H. Reliability, performance, security, and cost

Measure availability, latency distributions, timeout behavior, concurrency, retry safety, data integrity, dependency/security findings, privacy boundaries, secret handling, least privilege, resource use, and failure containment.

The economic gate is independent: verified USD 0.00, free-only routing, and no paid fallback. If exact request cost cannot be proven before execution and reconciled afterward, label cost UNKNOWN and block the relevant live test. Never infer zero cost from a free-tier label alone.

## 3. Scoring anchors

Use the canonical AQ V2 0–4 rubric for its ten answer-experience axes. Do not rescale or replace it.

For the broader product/UX benchmark, score each applicable dimension from 0–5:

- **0 — harmful/absent:** task fails, unsafe side effect, material falsehood, or unusable interaction.
- **1 — severe:** major defects; user cannot reliably complete the task without intervention.
- **2 — weak:** partial success with substantial errors, friction, omissions, or rework.
- **3 — acceptable:** task completes, but meaningful limitations or avoidable friction remain.
- **4 — strong:** accurate, efficient, clear, robust, and independently verifiable.
- **5 — exceptional:** consistently excellent across edge cases, with no material weakness and measurably lower user effort.

Every score must cite an observable behavior, answer span, screenshot, trace, test, or artifact. Unsupported impressions are not scores. Judges must record confidence and a short rationale. Keep per-task and per-dimension results; aggregate averages must never hide a critical failure or a weak category.

## 4. Required task suites

Use separate suites so model capability is not confused with product experience.

### Answer suite

Use the frozen 48-case / 16-family AQ V2 corpus and its canonical ten axes. Preserve all failed, refused, timed-out, and incomplete cases in the denominator. Each case needs 390px and 1440px readability evidence.

### Comparative product suite

Use the reproducible benchmark contract and a versioned held-out suite. Include Japanese and English, factual/research, reasoning, code, multi-step agent, artifact, image, and product UX tasks. Use exact same prompts, input files, success criteria, time budgets, and equivalent permissions wherever possible.

### Dedicated usability suite

The broad comparative suite's small UX subset is not enough to certify product usability. Add at least 12 dedicated user journeys per release candidate, covering:

1. first-use onboarding and first successful task;
2. start a new conversation and resume an existing one;
3. discover and use primary navigation;
4. compose, edit, submit, and recover a message;
5. attach and inspect a file;
6. use a secondary action/menu without obscuring content;
7. complete a research task and inspect sources;
8. create and reopen an artifact;
9. recover from a simulated network/provider failure;
10. cancel a running operation and confirm no later side effect;
11. complete a long answer on mobile, including tables/code/citations;
12. complete representative tasks with keyboard and assistive-technology checks.

Run on real browser engines and representative physical devices when available. Emulation is useful but must not be mislabeled as physical-device evidence. Capture task success, time, taps/clicks, turns, errors, recovery, viewport, browser, and evidence references.

### Agent suite

Use the existing held-out General Agent protocol: at least 12 tasks, including recovery, approval-boundary, and stop/cancel cases. Use evaluator-owned event evidence, not participant self-reported success booleans.

### Coding suite

Use exact equal base commits, identical hidden tests, equal time and permissions, at least two reference systems, and preserved failures. A plausible explanation is not a successful patch.

### Artifact and image suites

Validate file/image integrity before subjective judging. Compare actual outputs blind. A generated image must be a real generated image; placeholder or procedural output cannot be scored as model generation.

## 5. Competitive comparison controls

For every named reference system, record:

- product and exact surface (web, mobile app, CLI, agent/work mode);
- model/version label actually shown at execution time;
- plan/access tier and date;
- enabled tools, browsing, file access, and permissions;
- context supplied, prompt, input hashes, and time budget;
- whether the comparison is model-level or product/workflow-level;
- execution identity, timestamps, elapsed time, retries, and failures.

Never compare ORIGIN's full agent workflow with a competitor's text-only chat and call it a model comparison. Label incomparable surfaces explicitly.

For subjective preference:
- anonymize outputs and randomize pair order;
- use at least three reference systems and two independent judges for AQ V2;
- judges must not know which output is ORIGIN or see prior votes;
- retain ties and losses;
- do not rerun only losing prompts;
- adjudicate material judge disagreement with a third independent reviewer;
- keep source/citation context available without revealing system identity.

Unavailable products or inaccessible tiers are NOT RUN, not zero, not a guessed score. Do not imply that a reference system was executed when it was not.

## 6. Statistical and reproducibility requirements

Every report must preserve task-level rows and category-level breakdowns. Report denominators, missingness, ties, failures, and uncertainty intervals for proportions and paired comparisons. Use paired analysis because each system receives the same task. Report effect size and confidence interval, not only a p-value or rank.

Freeze corpus, rubric, evaluator, and candidate identity before collection. Bind all evidence to:
- exact candidate SHA;
- exact task/corpus digest;
- exact rubric/evaluator revision;
- benchmark round ID;
- participant/system identity;
- input and output digests;
- execution timestamps and bounded evidence lifetime.

A new candidate SHA requires new qualifying evidence. Historical results remain historical. Keep raw evidence private where required and publish only sanitized, integrity-checked reports.

## 7. Severity and release gates

- **P0 Critical:** data/secret exposure, unapproved external side effect, paid execution, fabricated completion, material safety issue, unrecoverable data loss. Release blocked.
- **P1 High:** material factual error, critical task failure, broken core journey, major accessibility blocker, unsafe retry/cancel behavior, serious security issue. Release blocked.
- **P2 Medium:** significant friction, partial feature failure, inconsistent layout, recoverable regression. Must be fixed or explicitly excluded from release scope with evidence.
- **P3 Low:** cosmetic or low-impact inconsistency. Track and prioritize.

Release acceptance must retain the existing rule: at least 90% of applicable checks pass and 100% of critical checks pass. Any unresolved P0/P1, critical UNVERIFIED item, unproven cost boundary, or failed exact-SHA required CI is NO-GO regardless of aggregate score.

After remediation, rerun the same failed checks and the relevant regression suite under the same browser/device/viewport conditions. Do not replace failed evidence with a different easier test.

Competitive acceptance is separate from release acceptance. A product can be safe to release without proving it is better than another AI; it must not make superiority claims until the relevant fresh competitive gate passes.

## 8. Evidence integrity and anti-gaming

Use the labels:

- **CODE-PROVEN:** supported by inspected exact-SHA implementation.
- **TEST-COVERED:** supported by a passing test on the exact SHA.
- **EXECUTED:** observed in the stated environment with timestamp and evidence.
- **UNVERIFIED:** not observed or not sufficiently evidenced.
- **NOT MEASURED:** required evaluation has not been executed.
- **NOT RUN:** a system/task was not executed; no score may be assigned.

A schema validator proves only that a packet has an accepted shape. It does not prove that the claimed execution, score, reviewer identity, or zero-cost event is genuine. Verify provenance independently, recompute digests, inspect execution artifacts, and reconcile cost evidence with the actual provider/runtime boundary.

Never discard failures, select only best runs, alter the rubric after seeing results, reuse one-shot sealed corpora, or transfer evidence between candidate SHAs.

## 9. Audit report format

Every audit report must contain:

1. exact candidate SHA and environment;
2. scope, exclusions, and reference systems actually run;
3. task/corpus/rubric/evaluator versions and digests;
4. per-domain status and scores;
5. task-level failures and severity;
6. UX journey success, effort, latency, accessibility, and device evidence;
7. answer correctness, grounding, citations, uncertainty, and instruction adherence;
8. comparative results with denominators and uncertainty;
9. security/privacy/cost evidence;
10. known limitations and NOT RUN / NOT MEASURED items;
11. remediation owner, acceptance criteria, and retest plan;
12. final decision: PASS, CONDITIONAL PASS, or NO-GO.

## 10. Current repository integration

This standard supplements rather than replaces:

- docs/ORIGIN_ANSWER_QUALITY_V2.md;
- docs/ORIGIN_AQ_V2_BLIND_PROCEDURE.md;
- docs/ORIGIN_WORLD_CLASS_QUALITY_STANDARD.md;
- docs/TRUSTED_WORLD_CLASS_QUALITY_GATE_V2.md;
- docs/V2_GENERAL_AGENT_HELD_OUT_BENCHMARK.md;
- docs/ORIGIN_COMPETITIVE_BENCHMARK_V1.md (when its benchmark PR is integrated);
- docs/ORIGIN_RELEASE_QUALITY_STANDARD.md (when its release-governance PR is integrated).

The current exact-main answer quality status must remain NOT MEASURED until a fresh trusted round passes for that exact SHA. The presence of these documents or workflows is not a quality result.
