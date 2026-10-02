# AQ V2 current status

Status: evaluator infrastructure is implemented; current exact-main answer quality is `NOT MEASURED` until a fresh trusted round is completed for that exact SHA.

## Canonical candidate rule

AQ V2 no longer treats an old feature PR as the permanent candidate.

For a main-mode qualification, the candidate SHA must equal the exact `main` revision dispatched to the trusted workflow and must be revalidated immediately before provider execution. A result from a different SHA is historical evidence only and cannot be inherited by a newer release.

## Evaluator infrastructure now available

The canonical repository includes:

- sealed/private 48-case corpus handling;
- exact-current-main or exact open-PR candidate binding;
- trusted-host ownership of corpus material and provider credentials;
- one-shot reservation / corpus-reuse protection;
- answer-digest binding for all 48 cases;
- independent absolute AQ V2 scoring bound to the exact answers;
- controlled-external blind comparison binding;
- at least 3 reference systems and at least 2 source-blind judges for comparative qualification;
- exact candidate/corpus/round/rubric/result digest binding;
- visual/readability evidence requirements;
- bounded sanitized diagnostics;
- USD 0 / free-only / no-paid-fallback verification;
- canonical cross-domain raw-evidence gate V2.

Canonical answer commands:

```sh
npm run eval:trusted-answer-quality-v2 -- <trusted-execution.json> <independent-score-bundle.json> [output.json]
npm run eval:trusted-answer-blind-v2 -- <trusted-execution.json> <trusted-blind-bundle.json> [output.json]
```

The cross-domain command is:

```sh
npm run eval:world-class-quality -- <trusted-raw-evidence.json>
```

## Historical evidence interpretation

Earlier trusted AQ rounds are engineering evidence, not current-SHA qualification.

A prior fresh round against PR #698 completed trusted execution but did not meet the content-quality bar. Recorded weaknesses included Truth and Evidence Usability deficits, family-floor failures, and stable/non-live tasks that were incorrectly refused through research fail-closed routing.

Subsequent product changes added regression coverage and routing/answer-contract hardening for those failure modes. Those repairs must be evaluated on a fresh independent round; the earlier failed corpus/result cannot be relabeled as a pass and cannot be reused to claim current quality.

## Current blockers before any answer-quality comparative claim

For the exact current main SHA, all of the following are still required unless already produced for that same SHA in a fresh trusted round:

1. independently prepared unused sealed 48-case corpus identity;
2. trusted exact-main execution of all 48 cases;
3. exact-answer independent AQ V2 score bundle;
4. source-blind comparison against at least 3 controlled external references and at least 2 independent judges;
5. required AQ V2 viewport/readability evidence;
6. trusted execution/provenance evidence;
7. verified USD 0, free-only, no-paid-fallback provider evidence;
8. final trusted V2 cross-domain packet if making an overall frontier/world-class claim.

If any prerequisite is missing, exhausted, belongs to another SHA, or cannot be verified, the status remains `NOT MEASURED` rather than inferred PASS.

## Safe execution boundary

Do not run sealed AQ V2 material through an untrusted candidate process with unrestricted host network or credential access.

The trusted evaluator must retain these properties:

- trusted host owns sealed corpus and provider credential;
- candidate receives only the prompt required for the current case, never the full corpus;
- provider credential remains outside candidate control;
- candidate network access remains restricted to the declared trusted proxy/runtime capabilities;
- sanitized logs/artifacts only;
- exact request/retry budget;
- reservation marker before private execution where required;
- fail closed on leakage, answer substitution, corpus reuse, unverifiable cost, or candidate-SHA mismatch.

Production runtime remains free-only and fail-closed independently of benchmark status.
