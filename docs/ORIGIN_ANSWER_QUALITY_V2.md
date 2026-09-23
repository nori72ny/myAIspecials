# ORIGIN Answer Quality V2

Status: evaluation infrastructure only. This document does not claim ORIGIN is already better than other assistants.

## Goal

Measure the qualities the Owner actually cares about:

- answer correctness and groundedness;
- whether the response understood the real intent;
- completeness without unnecessary padding;
- logical structure and hierarchy;
- clarity on first read;
- information density;
- immediate actionability;
- visual readability on mobile and desktop;
- format fit for the requested task;
- useful, inspectable evidence.

V1 AQ remains valuable for factual support, citation precision, contradiction detection, verification integrity and zero-cost execution. AQ V2 adds the missing answer-experience and competitive-evidence layer.

## Frozen minimum corpus shape

AQ V2 uses 48 cases: 16 families x 3 cases.

1. current factual
2. research synthesis
3. multi-source comparison
4. contradiction resolution
5. explanation / teaching
6. summarization
7. writing / rewrite
8. translation
9. quantitative reasoning
10. data analysis
11. decision support
12. professional advice
13. coding explanation
14. coding generation / repair
15. artifact generation
16. ambiguity handling

The prompts themselves must be frozen separately from candidate implementation and must not be rewritten after seeing candidate results.

## Ten scored axes

Each answer is scored 0-4 for:

1. truth
2. intent fit
3. completeness
4. structure
5. clarity
6. information density
7. actionability
8. visual readability
9. task fit
10. evidence usability

This is an **absolute** gate, not merely a regression check.

Current minimums:
- truth >= 3.75
- intent fit >= 3.60
- completeness / structure / clarity / visual readability / evidence usability >= 3.50
- task fit >= 3.60
- actionability >= 3.40
- information density >= 3.25
- overall >= 3.55
- worst family >= 3.25

Any P0, P1, unsupported material claim, critical clipping/overflow, broken heading hierarchy or mobile table failure blocks qualification.

Every case must have both 390px mobile and 1440px desktop evidence.

## Blind competitive evidence

"Better than other AI" is never inferred from branding or self-review.

Before competitive readiness:
- all 48 cases must be represented;
- at least 3 anonymized reference systems must be compared;
- at least 2 independent judges must score the comparisons;
- model names are hidden during judging;
- overall win rate must be >= 50%;
- loss rate must be <= 30%;
- every family must have >= 60% non-loss rate;
- no criterion may have a negative mean preference.

The comparison criteria are correctness, clarity, structure, conciseness, usefulness and evidence use.

This deliberately separates:
- **absolute quality**: is the answer good enough?
- **competitive evidence**: does it hold up against strong alternatives?

## World-class candidate wording

The system may use "world-class candidate" only when all of the following are present for the same exact SHA:

1. AQ V2 absolute answer-experience qualification passes.
2. AQ V2 blind competitive evidence passes.
3. A live provider run completed.
4. USD 0 is verified.

Until then, the correct status is "not yet proven".

## External AI use

External assistants are judges/evidence sources, not authorities. Their findings are hypotheses until backed by reproducible evidence.

Recommended roles when needed:
- Claude: independent content/structure/code/security review.
- Gemini: multimodal UI/readability review.
- Perplexity: research/citation comparison.
- Astra, if available: additional high-difficulty blind reference/judge.

Do not ask external reviewers until the frozen corpus, scoring rubric and anonymization procedure are fixed; otherwise the benchmark can drift toward the reviewers' preferences.
