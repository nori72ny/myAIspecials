# ORIGIN V1.4 — Independent Final Held-Out Evaluator Brief

Purpose: create the **first and only unseen final held-out corpus** for ORIGIN V1.4 without exposing private task material to the engineering assistant before execution.

This document is public. The final private corpus is not.

## Non-negotiable provenance

1. Author the final corpus only **after** the one-shot runner has been merged to `main`.
2. Resolve the then-current 40-character `main` SHA and use that exact SHA as `baseSha` for every task. The final workflow rejects any other base SHA.
3. The engineering assistant that implemented ORIGIN must not receive or inspect task goals, hidden tests, expected patches, solutions, or reference patches before the one-shot run.
4. Do not reuse, translate, lightly mutate, or derive the final tasks from the observed engineering pilot.
5. Do not run ORIGIN against any final task before the official one-shot workflow.
6. Do not tune ORIGIN after viewing final task material and then call the same corpus unseen.
7. Deliver the finished corpus only as a gzip+base64 sealed value for the GitHub Actions secret `ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64`. Do not paste the plaintext corpus into an engineering chat, PR, issue, commit, or public artifact.

## Public contracts to follow

Read these files from the exact frozen `main` revision:

- `src/agent/heldOutCodingTrustedRunnerV14.ts`
- `src/agent/heldOutCodingFinalPrivateCorpusV14.ts`
- `src/agent/heldOutCodingFinalQualificationV14.ts`
- `src/agent/heldOutCodingProviderRequestBudgetV14.ts`
- `.github/workflows/held-out-coding-final-v14.yml`

The private task packet version is:

`origin-held-out-private-task-v1`

The private final corpus version is:

`origin-held-out-final-private-corpus-v1`

The qualification version is:

`origin-held-out-final-qualification-v1`

## Corpus requirements

The official first final corpus must contain **exactly 6 tasks**. The sealed corpus parser intentionally supports a wider bounded range for future audit use, but the one-shot final workflow rejects any task count other than six. This keeps the official run inside the reviewed zero-cost provider-request envelope.

Each final task receives at most **7 actual provider executions**, shared across primary attempts, retries, and the explicit zero-cost/ZDR failover. Therefore the six-task official run can issue at most 42 provider requests, leaving headroom under the reviewed free-provider daily request ceiling. Reaching the per-task cap fails closed with a stable public terminal code; it never enables paid fallback or relaxes privacy policy.

Every task must:

- use the same exact frozen `main` SHA;
- use the same time budget; use `900000` ms unless the independent evaluator precommits another uniform budget;
- require at least two production paths in `requiredChangedPaths`;
- keep hidden/evaluator paths in `protectedPaths`;
- contain at least one hidden test;
- use a unique opaque task ID;
- have no task-specific information in its ID;
- be solvable from repository code plus the private goal, without external network access during verification;
- avoid secrets, credentials, destructive operations, publishing, deployment, or paid-service requirements.

At least two tasks must set `recoveryRequired: true` and must be designed so a meaningful failed verification/repair cycle can be demonstrated before final success.

The corpus as a whole must cover all five public qualification dimensions:

- `navigationMultiFile`
- `featureWithNewFile`
- `regressionRecovery`
- `buildOrTypecheckRepair`
- `securityPathBoundary`

Required six-task composition:

1. multi-file existing-code bug/navigation task;
2. multi-file feature requiring a new production file;
3. regression task intended to require a failed test then repair;
4. build/typecheck repair spanning at least two production paths;
5. security/path-boundary task that must preserve protected-path rules;
6. mixed multi-file recovery task combining behavior and verification constraints.

These are category requirements, not solutions. Do not expose expected edits in the goal.

## Private corpus shape

Top level:

```json
{
  "version": "origin-held-out-final-private-corpus-v1",
  "qualification": "origin-held-out-final-qualification-v1",
  "corpusId": "opaque-final-corpus-id",
  "tasks": [
    {
      "coverage": ["navigationMultiFile"],
      "packet": {
        "version": "origin-held-out-private-task-v1",
        "id": "opaque-task-id",
        "baseSha": "40-char-frozen-main-sha",
        "timeBudgetMs": 900000,
        "requiredChangedPaths": ["src/path-a.ts", "src/path-b.ts"],
        "protectedPaths": ["tests/__origin_heldout__/opaque.test.ts"],
        "recoveryRequired": false,
        "goal": "PRIVATE TASK GOAL",
        "hiddenTests": [
          {
            "path": "opaque.test.ts",
            "content": "PRIVATE HIDDEN TEST SOURCE"
          }
        ]
      }
    }
  ]
}
```

The example shows structure only. Do not copy its placeholder goal/test as a real task.

## Important path rule for hidden tests

Inside each private packet, each `hiddenTests[].path` is relative to the trusted hidden-test directory created by the evaluator. `protectedPaths` should identify the corresponding repository-visible protected evaluator path(s) expected by the public contract. Follow the exact validators in the frozen source rather than guessing.

## Sealing

After validating the plaintext JSON privately, gzip it and base64-encode the gzip bytes as one continuous string.

Cross-platform Python example:

```bash
python - <<'PY'
import base64, gzip, pathlib
raw = pathlib.Path('origin-final-corpus.json').read_bytes()
print(base64.b64encode(gzip.compress(raw, compresslevel=9)).decode('ascii'))
PY
```

The sealed corpus must remain within the public limits enforced by the frozen source:

- compressed: at most 128 KiB;
- expanded: at most 1536 KiB.

## Delivery

Deliver only:

1. the sealed gzip+base64 value, privately, for direct registration as GitHub Actions secret `ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64`;
2. optionally, the non-secret public metadata: corpus ID, task count, frozen base SHA, and coverage categories.

Do **not** deliver plaintext goals, hidden-test source, expected solutions, or reference patches to the ORIGIN engineering assistant before the official run.

## Execution rule

The official workflow is:

`V1.4 final held-out coding qualification`

It must be run from `main`, full batch only, exactly once for unseen evidence. The workflow records a corpus-digest start marker before running tasks. A rerun or later observation may be retained as audit evidence but is not unseen final evidence.

The final result reports raw observed evidence only: attempted tasks, solved tasks, solve rate, axis results, durations, terminal codes/statuses, and cost. No post-hoc pass threshold, winner, or Claude Code parity claim may be invented after seeing the result.
