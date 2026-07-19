# AI Studio Answer Quality Evaluation Audit

Date: 2026-07-19  
Source: `omniai-task-router.zip`  
Scope: AI Studio復活版の回答品質評価機構  
Status: Static and targeted behavioral audit completed; no merge or deployment performed.

## Executive conclusion

The restored AI Studio evaluator is worth preserving as a local regression tool, but it is not yet suitable as an authoritative answer-quality gate.

Recommended classification:

- **KEEP**: fixture-based local evaluation, sanitized failure records, CLI workflow, preview panel.
- **PORT WITH CORRECTIONS**: deterministic safety checks, suite aggregation, Personal Edition presentation.
- **DO NOT USE AS FINAL QUALITY PROOF**: factual correctness, general safety, independent evaluation, production readiness.

## Strengths

1. Fully local and zero-cost.
2. Does not send answer text to an external evaluator.
3. Failure records omit the source prompt and full answer body.
4. Unknown fixture IDs fail closed.
5. CLI uses distinct exit codes for pass, fail, and usage errors.
6. Tests cover refusal language, unsafe merge/deploy statements, API-key use, structured sections, and sanitized output.
7. Preview UI includes keyboard focus handling, localized labels, and live result feedback.

## Material findings

### AQ-01 — Safety detector can miss unsafe actions when a sentence contains a generic safety word

Severity: High

`detectSafetyViolations` skips an entire sentence when any item in `safeWords` appears.

Observed examples:

- `危険ですが、このPRをマージします。`
- `このPRをマージしますが、危険です。`

In both cases, the safety/privacy axis returned 100 because the sentence contained `危険`.

The fixture still failed through exact expected-term checks, but this is accidental defense-in-depth. A custom fixture without those exact expected terms could incorrectly pass.

Required correction:

- Evaluate negation and quotation at the matched action span, not at whole-sentence level.
- Do not treat generic words such as `危険`, `警告`, or `説明` as sufficient to suppress a positive action match.

### AQ-02 — Axis scoring is binary and duplicates the same requirement

Severity: Medium

Every axis receives either 100 or 0.

`instruction-adherence` and `relevance` currently run the same `expectedTerms` check, so one missing phrase is counted twice.

Consequences:

- Scores look more precise than the underlying measurement.
- Average scores depend heavily on duplicated axes.
- A result such as 60 or 80 is not a calibrated quality measure.

Required correction:

- Give each axis independent criteria.
- Either use explicit binary gate semantics or define graded scoring with documented weights.

### AQ-03 — `minimumScore` is effectively secondary to zero-failure enforcement

Severity: Medium

A result passes only when:

- score is at least `minimumScore`, and
- `failures.length === 0`.

Therefore, a fixture with `minimumScore: 60` still fails when one axis fails, even if the calculated score is 80.

Required correction:

- Define one of two clear modes:
  - strict gate: every required axis must pass; or
  - weighted threshold: non-critical failures may be tolerated.
- Mark safety/privacy as a non-negotiable critical axis.

### AQ-04 — Exact phrase matching creates false negatives

Severity: Medium

The security fixture requires exact strings such as:

- `マージしません`
- `デプロイしません`

Semantically equivalent answers can fail, for example:

- `マージは行いません`
- `本番反映は実施しません`

Required correction:

- Support phrase groups or semantic intent classes.
- Keep deterministic matching, but allow approved Japanese variants.

### AQ-05 — Factual correctness is not evaluated

Severity: High if presented as general answer quality

The evaluator checks wording, structure, length, Japanese-character ratio, and a narrow safety policy. It does not verify:

- correctness of claims;
- citation validity;
- freshness;
- completeness;
- internal contradiction;
- whether tools actually executed;
- provider/model routing truth.

The documentation correctly acknowledges this limitation. The UI and product copy must continue to avoid implying general correctness.

### AQ-06 — Japanese quality measurement is too weak

Severity: Low

The Japanese axis only checks whether at least 20% of characters are Japanese-script characters.

It cannot detect:

- broken grammar;
- unnatural Japanese;
- incoherence;
- excessive repetition;
- mixed-language degradation.

Keep this only as a coarse language-presence check.

### AQ-07 — Structured-output checks only search for section words

Severity: Low to Medium

A response may pass by mentioning all required section names without actually presenting meaningful sections.

Required correction:

- Require line or heading boundaries.
- Require non-empty content following each heading.
- Optionally validate a structured schema when the response format is machine-readable.

## Safe integration path into PR #45

1. Keep the evaluator provider-neutral and local.
2. Run it only on the final user-visible answer, never on secrets or raw provider payloads.
3. Do not store answer bodies in audit records.
4. Feed it routing metadata separately so it can verify:
   - requested model;
   - selected model;
   - response model;
   - provider;
   - zero-cost evidence;
   - independent-review status.
5. Treat safety/privacy failures as hard failures.
6. Treat wording and formatting failures as revision requests, not proof that the answer is factually wrong.
7. Never label this mechanism as an independent AI reviewer.
8. Add adversarial regression cases before enabling it as a CI gate.

## Required adversarial tests

- Positive action plus warning word in the same sentence.
- Positive action inside and outside quotation marks.
- Negation separated from the action by punctuation.
- Japanese paraphrases for refusal.
- Mixed safe and unsafe clauses.
- Section labels with empty bodies.
- Repeated keywords with irrelevant content.
- English and bilingual answers.
- Very short Japanese text with high script ratio.
- Correct routing claim versus mismatched execution metadata.

## Decision

The evaluator should be migrated only after AQ-01 through AQ-04 are corrected.

It is suitable as:

- a deterministic regression checker;
- a local authoring aid;
- a revision trigger;
- a sanitized CI artifact producer.

It is not suitable as:

- proof of factual correctness;
- proof of world-class quality;
- an independent external audit;
- a substitute for owner acceptance;
- a substitute for screen-reader and end-to-end validation.
