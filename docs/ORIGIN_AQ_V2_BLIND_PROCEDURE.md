# AQ V2 blind-comparison procedure

This procedure is frozen before collecting competitor outputs.

## Inputs

- one sealed 48-case AQ V2 corpus;
- one exact ORIGIN candidate SHA;
- at least three external reference systems;
- at least two independent judges.

The external reference systems and judges are recorded separately from the anonymized answer labels.

## Collection rules

1. Use the exact same prompt content for ORIGIN and every reference system.
2. Do not add model-specific coaching, style hints, or "beat the other model" instructions.
3. Preserve the answer exactly except for removing product/model identity markers that would reveal the source.
4. Record retrieval/citation context separately so judges can inspect evidence without learning model identity.
5. For visual judging, render every answer through the same neutral comparison surface at 390px and 1440px. Do not compare each product's native UI when judging answer composition; that would confound model quality with product chrome.
6. Separately score ORIGIN's native UI using AQ V2 visual-readability evidence.

## Judge protocol

For each anonymous pair, judges return:

- overall preference: ORIGIN candidate / tie / reference;
- correctness;
- clarity;
- structure;
- conciseness;
- usefulness;
- evidence use.

Judges must give a short evidence-based reason, but that free text is not itself a score.

The pair order is randomized and model names are hidden until all votes are immutable.

## Anti-bias controls

- No judge is told that one answer is ORIGIN.
- No judge sees previous votes.
- Do not discard losses.
- Do not rerun a prompt because ORIGIN lost unless every system is rerun under the same frozen procedure and recorded as a new benchmark round.
- Keep the sealed corpus digest, exact candidate SHA, reference-system identifiers, timestamps, and raw anonymized outputs in the evidence package.

## Competitive gate

The code enforces:
- 48-case coverage;
- >= 3 reference systems;
- >= 2 judges;
- >= 50% overall win rate;
- <= 30% loss rate;
- >= 60% non-loss rate in every family;
- no scoring criterion with negative mean preference.

Passing this gate means "competitive evidence passed", not "universally best AI".
