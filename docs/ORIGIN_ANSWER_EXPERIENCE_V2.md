# ORIGIN Answer Experience Quality Gate V2

Status: evaluator-only Draft. This does not change the user-facing ORIGIN response yet.

## Goal

ORIGIN should not claim "world-class" or "better than other AI" from internal confidence or CI success alone.

V2 separates three kinds of evidence:

1. **Absolute answer quality** — intent alignment, directness, clarity, structure, information density, task fit and actionability.
2. **Rendered readability** — 390 / 768 / 1440 evidence with overflow, contrast, heading hierarchy, primary-answer readability, touch-target and table/code usability checks.
3. **Blind comparative preference** — anonymized ORIGIN-vs-competitor judgments with answer order balanced and at least two independent judges.

A promotion claim fails closed if any one of the three evidence families is missing.

## Semantic scale

Every semantic dimension uses the same 0–4 scale.

- 0: unusable, wrong shape, or materially misses the request.
- 1: major weakness; user must reconstruct the answer.
- 2: usable but has a material clarity/structure/task-fit gap.
- 3: strong professional answer with only minor friction.
- 4: exceptionally clear, direct, well-structured, appropriately dense and immediately useful.

Do not reward verbosity, decorative headings, excessive tables, unnecessary "management" metadata or confident tone. The best answer is the smallest structure that preserves correctness, important nuance and actionability.

## Promotion thresholds

The V2 gate intentionally uses both absolute and comparative thresholds.

Absolute:
- at least 24 semantic cases;
- all four surfaces represented with at least four cases each;
- Japanese and English evidence;
- every semantic dimension mean >= 3.4 / 4;
- no individual case may score below 2 on any semantic dimension.

Rendered:
- at least four cases at each of 390, 768 and 1440 widths;
- no horizontal overflow;
- WCAG AA text contrast;
- valid heading hierarchy;
- primary answer remains readable;
- mobile touch targets cannot fail 44px;
- table/code usability cannot fail when present.

Blind comparison:
- at least 24 judgments;
- at least two independent judges;
- at least two competitors;
- candidate shown as A between 40% and 60% of comparisons;
- ORIGIN win rate >= 60%;
- ORIGIN non-loss rate >= 80%;
- no surface may have win rate below 50%.

These thresholds mean only **promotion evidence eligible**. They do not prove universal model superiority.

## Blind-review protocol

For each case:

1. Generate one ORIGIN response and one competitor response under the same user prompt and relevant tool/freshness conditions.
2. Strip brand/model/provider names and any identifying boilerplate.
3. Hash the exact answer bodies and retain only the digests in public evidence.
4. Randomize A/B order independently for each judge.
5. Judge the answer, not the brand, using:
   - correctness / unsupported claims;
   - intent alignment;
   - clarity;
   - structure;
   - information density;
   - actionability;
   - task fit;
   - rendered readability when screenshots are included.
6. Record candidate / competitor / tie. Do not ask the judge to rank model brands.
7. Keep raw answers/screenshots private when they could expose user data. Public artifacts should use IDs, digests and aggregate metrics.

## External-AI roles

When independent reviewers are needed:
- Claude: code/design review and blind answer-quality judgment.
- Gemini: screenshot/UI information-density and multimodal readability review.
- Perplexity: Research/citation/source-use comparison.
- Astra, if actually available: an additional high-difficulty independent judge.

No single external AI is authoritative. External findings remain hypotheses until they are reproduced or supported by exact evidence.

## Relationship to AQ V1

AQ V1 remains the factual/verification safety gate: factual support, citation precision, contradiction handling, task completion, verifier integrity, fail-closed behavior and actionability.

AQ V2 is additive. It specifically prevents a technically correct but dense, awkward, over-structured or visually difficult response from being promoted as the best user experience.

The release-quality path therefore becomes:

AQ V1 factual/verification gate
→ AQ V2 answer-experience gate
→ exact-SHA browser/render evidence
→ blind independent comparison
→ fix only reproduced weak categories
→ rerun both gates.

No merge or Production deployment is authorized by this evaluator.


## Blind-pack implementation

`OriginAnswerExperienceBlindPackV2` produces two deliberately separated outputs:

- `reviewItems`: prompt + Answer A + Answer B only. No model/provider identity, candidate position, competitor ID or answer digest is exposed to the judge.
- `answerKey`: retained by the controller only and used after judging to convert A/B/tie into candidate/competitor/tie evidence.

For an even number of comparisons, candidate presentation is exactly 50/50 A/B after a deterministic seeded ordering. This avoids letting the evaluator choose a favorable answer order after seeing results.

The public promotion evidence should contain only unblinded result rows and answer digests, not raw answer bodies.
