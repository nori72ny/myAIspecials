# ORIGIN Trusted World-Class Quality Gate V2

Status: canonical cross-domain quality gate.

## Why V2 exists

The legacy `origin.world-class-quality-gate.v1` accepted per-domain aggregate summaries such as solved counts, win/loss totals and reference counts. Those summaries were useful for reporting, but they were not strong enough to serve as the final proof boundary because a hand-edited aggregate could satisfy the top-level gate without re-running the domain-specific evidence validators.

V2 removes that shortcut. The canonical `npm run eval:world-class-quality` command now re-evaluates raw domain evidence through the domain-specific evaluators before it can pass.

## Raw evidence required

### Answer

- all 48 trusted case evidence rows;
- exact candidate/corpus/round/execution/evaluator expectation;
- controlled-external exact-answer score bundle;
- trusted blind comparison bundle with exact answer/reference digests and blind judges;
- raw visual evidence;
- full evaluation binding set;
- live-provider completion + exact zero-cost attestation.

The gate reconstructs the trusted answer run, re-qualifies exact-answer quality, re-qualifies blind preference evidence, re-qualifies visual/binding evidence and then invokes the Answer World-Class V2 gate.

### Coding

The gate invokes the trusted held-out Coding comparison directly. Reference results must therefore be derived from task-level controlled-external evidence rather than aggregate counts.

### General Agent

The gate invokes the trusted General Agent comparison directly. ORIGIN and reference agents must be reconstructed from evaluator-owned event ledgers for the same private tasks and permission profile.

### Image

The gate re-runs the 24-case image blind benchmark from the full benchmark packet, including technical evidence, exact output digests, three fixed references and independent judge scores.

For a V1.6 publication claim, the ORIGIN candidate images must originate from the exact-current-main V1.6 private runner (`npm run eval:image-private-world-class`) and the same user-visible `/api/creative/v1.6/world-class/generate` route. Evidence from the V1.5 Cloudflare-only private runner is valid only for that V1.5 route and cannot qualify V1.6. Evaluation-mode outputs must carry the exact release SHA and evaluation marker and must not carry a world-class-qualified header before the blind benchmark passes.

### Artifact

The gate re-runs the 16-case artifact blind benchmark from the full benchmark packet, including technical checks, exact artifact digests, three references and independent judge scores.

## Exact-SHA rule

Every domain must use the same exact candidate SHA as the V2 packet. A domain packet from another revision is rejected before its result can count.

## Evidence digests

The final report records a SHA-256 digest of the full cross-domain packet and one SHA-256 digest per domain packet. These digests make the evaluated evidence packet unambiguous in release records.

## CLI

```sh
npm run eval:world-class-quality -- <trusted-raw-evidence.json>
```

`eval:world-class-quality:trusted` is an explicit alias for the same V2 gate.

The former aggregate-only evaluator remains available only as:

```sh
npm run eval:world-class-quality:legacy -- <aggregate-evidence.json>
```

It is diagnostic/compatibility tooling and must not be used as the canonical release or superiority gate.

## Interpretation

A V2 pass means the checked evidence packet passed every current domain-specific evaluator at the exact candidate SHA. It still does not manufacture external evidence: the underlying sealed/private rounds, reference-system outputs and independent judging must actually be collected.
