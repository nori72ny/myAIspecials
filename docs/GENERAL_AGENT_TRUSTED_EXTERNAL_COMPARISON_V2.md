# ORIGIN General Agent — Trusted External Comparison V2

Status: official multi-reference comparison path for the independent General Agent round.

## Purpose

Candidate-side execution and external-reference comparison are intentionally separate. This workflow consumes only a successful sanitized candidate artifact from the official private runner plus a sealed evaluator-owned reference pack. It does not accept hand-entered aggregate scores.

## Required candidate evidence

The workflow input `candidate_run_id` must identify a successful GitHub Actions run of `.github/workflows/general-agent-private-heldout-v2.yml` on exact current `main` and exact `candidate_sha`.

The workflow fetches only the artifact named `general-agent-private-v2-<candidate_run_id>` and requires:

- `public-tasks.json`;
- `candidate-trusted-evidence.json`;
- `candidate-score-summary.json`.

Another workflow, another SHA, a failed run, an expired artifact, or an ambiguous artifact name fails closed.

## Reference pack

The independent evaluator supplies gzip+base64 JSON only through the GitHub Actions secret `ORIGIN_GENERAL_AGENT_REFERENCE_PACK_GZIP_B64`.

The decoded shape is:

```json
{
  "schemaVersion": "origin.general-agent-reference-pack.v1",
  "candidateSha": "<40-char exact SHA>",
  "corpusId": "<same candidate corpus id>",
  "corpusDigest": "<same candidate corpus digest>",
  "permissionProfileDigest": "<same published permission-profile digest>",
  "references": [
    {
      "source": "controlled-external",
      "independentFromCandidate": true,
      "participant": "<reference system id>",
      "evidenceId": "<evaluator evidence id>",
      "createdAt": "<ISO timestamp>",
      "expiresAt": "<ISO timestamp>",
      "runs": ["<trusted evaluator-owned event ledgers for every task>"]
    }
  ]
}
```

At least two distinct reference systems are mandatory. The reference pack must not contain private prompt text or hidden solutions; it contains only trusted event evidence bound to the same public task IDs/digests.

## Digest binding

`artifactDigest` values are not trusted from input. The assembler computes them itself from canonicalized evidence. The comparator independently recomputes the same digests and rejects any mismatch.

The round digest binds:

- exact candidate SHA;
- evaluator identity;
- permission-profile digest;
- full public task packet;
- exact candidate trusted event evidence.

Each reference digest binds:

- participant identity;
- permission-profile digest;
- exact reference trusted event evidence.

Therefore changing a task event, participant, candidate event, or permission profile after evidence sealing invalidates the comparison.

## Workflow

`.github/workflows/general-agent-trusted-external-comparison-v2.yml` is manual-only and main-only.

Inputs:

- `candidate_sha`;
- `candidate_run_id`;
- `corpus_id`;
- `evaluator_id`;
- `round_id`.

Secret:

- `ORIGIN_GENERAL_AGENT_REFERENCE_PACK_GZIP_B64`.

The workflow uploads only the assembled trusted comparison input and report. These contain public task metadata and evaluator-owned event ledgers, not private task goals or tool parameters.

## Decision boundary

A workflow pass means ORIGIN met the existing General Agent comparison gate against at least two controlled external references under the same task set and permission profile. It remains only one domain of the overall Trusted World-Class Quality Gate V2.