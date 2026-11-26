# ORIGIN AQ V2 Trust-Boundary Audit — 2026-11-02

Status: source-level audit finding. This report is not a benchmark result and does not assert that any external reviewer, competitor, or provider execution actually occurred.

## Executive decision

**Competitive answer-quality certification is currently NOT MEASURED / NOT QUALIFIED.** The repository has sophisticated binding and scoring logic, but the inspected trust boundary does not cryptographically authenticate the external evaluator, reference systems, judges, or host-execution claims. A schema-valid packet can contain self-asserted identity and control flags.

This is an evidence-integrity defect, not proof that the existing data is fabricated. It means the implementation cannot independently distinguish genuine evidence from a correctly shaped self-authored packet.

## Findings

### P1 — External evaluator identity is self-asserted

Source: `src/release/OriginTrustedAnswerQualityV2.ts`

The evaluator record requires `source: "controlled-external"`, `independentFromCandidate: true`, an evaluator ID, evidence ID, artifact digest string, and a bounded timestamp window. The validator checks the field values and digest syntax, but does not verify a digital signature, retrieve the referenced artifact, recompute its digest, or authenticate the evaluator identity against a trust root.

Impact: a caller can construct a syntactically valid evaluator record. The qualifier's `scoringIdentityBound` is therefore a data-binding result, not proof of independent evaluator identity.

### P1 — Blind reference and judge identities are self-asserted

Source: `src/release/OriginTrustedBlindPreferenceV2.ts`

Reference and judge records similarly assert `controlled-external`, independence, and blindness. The code checks unique IDs, digest syntax, evidence IDs, expiry windows, answer digests, and pair digests. It does not verify signed attestations or authenticate the reference/judge identities. The pair digest proves internal consistency of the supplied values, not who produced them.

Impact: the complete 48 × reference × judge matrix can be internally consistent without proving that the named external systems produced the answers or that the judges were independent and blind.

### P1 — Trusted execution control flags are accepted as booleans

Sources:
- `src/release/OriginAnswerTrustedExecutionV2.ts`
- `src/release/OriginTrustedAnswerRunV2.ts`
- `scripts/summarize-trusted-answer-run-v2.ts`

The trusted-execution qualifier checks booleans such as `trustedHostControlled`, `providerProxyEnforced`, `freeOnlyEnforced`, and `zeroCostVerified`. The aggregate builder derives the final evidence record from case JSON and caller-supplied expectations. The summary script obtains host/PR assertions from environment-variable strings. The inspected code does not itself verify a signed host attestation, independently inspect network policy, or reconcile provider billing/usage records.

Impact: the `trusted` label and `zeroCostVerified` field are not independently authenticated by these functions. Do not use them alone as proof of a real, isolated, zero-cost provider run.

### P1 — AQ V2 absolute scoring uses one evaluator record

Source: `src/release/OriginTrustedAnswerQualityV2.ts`

The absolute quality score bundle contains one evaluator object. The blind-preference bundle separately requires at least two judge records, but those judges provide pairwise preferences, not independent per-axis absolute scores. The inspected absolute-score qualifier does not require two independent scorers, inter-rater agreement, or adjudication.

Impact: the documented two-independent-judge standard is not fully enforced for the ten-axis absolute quality scores.

### P2 — Blind preference report omits uncertainty estimates

Source: `src/release/OriginAnswerBlindPreferenceV2.ts`

The report computes win/tie/loss rates, criterion means, and family non-loss rate. It does not calculate confidence intervals, task-clustered uncertainty, or per-opponent effect sizes. Treating all repeated judge/opponent votes as independent would overstate statistical precision.

Impact: a threshold pass alone is insufficient to claim a reliable advantage over each named competitor.

## Required remediation before competitive PASS

1. Add an externally anchored trust registry for evaluator, reference-system, judge, and host identities. The trust root must not be supplied by the evidence packet being evaluated.
2. Require Ed25519 (or equivalently strong) signatures over canonical payloads. Verify signatures against pinned public keys; verify that artifact digests match the actual retrieved evidence artifacts.
3. Sign each reference answer set and each judge's complete vote artifact. Bind signatures to candidate SHA, corpus digest, rubric digest, round ID, and timestamps.
4. Replace caller-supplied host booleans with independently verified CI/host attestations. Bind the exact workflow run, repository, commit, workflow identity, and artifact digest.
5. Require provider-level cost evidence for every live inference request. A free-tier flag, model label, case JSON field, or status endpoint is not sufficient.
6. Require at least two independent absolute scorers per AQ V2 case/axis, report inter-rater agreement, and define adjudication for material disagreement.
7. Add task-clustered 95% confidence intervals and per-opponent effect sizes to the blind-preference report. Require the confidence interval to support the claim for each opponent, not only a pooled average.
8. Add adversarial tests proving that forged IDs, altered artifacts, invalid signatures, expired keys, wrong candidate SHAs, reused signatures, and mismatched provider usage evidence all fail closed.

## Current disposition

| Claim | Disposition |
|---|---|
| AQ V2 scoring code exists | CODE-PROVEN |
| 48-case answer binding logic exists | CODE-PROVEN |
| 3-reference / 2-judge matrix shape is checked | CODE-PROVEN |
| External evaluator identity is authenticated | UNVERIFIED |
| Reference and judge identities are authenticated | UNVERIFIED |
| Host isolation claims are independently attested | UNVERIFIED |
| Per-request $0.00 is reconciled to provider evidence | UNVERIFIED |
| Independent absolute scoring and inter-rater agreement | UNVERIFIED |
| Statistical superiority with uncertainty by competitor | NOT MEASURED |
| ORIGIN is better than ChatGPT / Claude / Gemini | NOT MEASURED |

No competitive superiority statement may be made until all P1 findings are remediated and fresh exact-SHA evidence passes. This does not automatically block unrelated safe feature releases; it blocks answer-quality and competitive superiority claims that depend on these evidence paths.
