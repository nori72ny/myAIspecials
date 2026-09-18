# ORIGIN — Answer Quality Verification Test Matrix

## Foundation contracts

### Evidence Ledger
- rejects secret-like fields;
- rejects non-HTTPS public-source URLs;
- preserves timestamps and source kinds;
- cannot mutate prior entries;
- records USD cost;
- supports claim relationships;
- distinguishes provider output from independently retrieved evidence.

### Claim Model
- distinguishes factual claim / inference / assumption / recommendation / execution claim;
- marks freshness requirement;
- marks evidence requirement;
- bounds claim count;
- rejects malformed claim IDs.

### Verifier
- PASS only when required evidence exists;
- REPAIR_REQUIRED when fixable evidence/check gap exists;
- BLOCKED_UNVERIFIED when mandatory evidence cannot be obtained;
- citation URL alone is insufficient;
- self-presented citation does not become independently verified;
- stale evidence cannot support current claim;
- source scope mismatch fails;
- contradiction prevents unconditional PASS;
- user-provided fact can be accepted as user-provided without pretending external verification;
- execution claim requires deterministic execution evidence.

## Chat regression matrix

- simple rewrite remains concise and does not trigger unnecessary research;
- current-info request requires fresh evidence;
- no live research path fails closed;
- independent-review-required cannot become PASS without review evidence;
- zero-cost assertion remains enforced;
- provider 429/5xx/timeout does not fall through to paid provider;
- MAX_RETRIES remains 0 where policy requires;
- sensitive input remains blocked before external provider;
- no secret written to logs/evidence.

## Research regression matrix

- 0 sources => blocked/limited, not confident;
- 1 weak source => limited;
- multiple domains retain source identity;
- stale source marked stale/older;
- structured conflict propagates to verifier;
- citation points to actual source;
- source assessment score remains retrieval-only;
- no publisher-authority or truth claim derived from retrieval score.

## Coding regression matrix

- general verifier cannot manufacture Coding status=verified;
- Coding verified still requires typecheck/lint/test/build success;
- stale checks after later edit invalidated;
- timed-out check cannot verify;
- repair round must match final successful checks;
- paid fallback false;
- costUsd exactly 0;
- cancelled remains cancelled;
- blocked remains blocked;
- diff evidence corresponds to changed paths.

## Presenter regression matrix

- PASS may render verified state;
- REPAIR_REQUIRED is never rendered as complete;
- BLOCKED_UNVERIFIED communicates uncertainty;
- fact vs inference vs assumption labels preserved where material;
- unsupported claim removed or qualified;
- citations rendered only for supported claims;
- limitations survive final formatting;
- mobile output does not bury verification state.

## UI state matrix

- Plan state reflects actual plan only;
- Search/Read only shown when executed;
- Execute only shown when execution occurred;
- Verify only shown with verifier state;
- Repair only shown when repair occurs;
- Deliver only after deliverable exists;
- Stop shown only for active cancellable work;
- no simulated progress percentages;
- no fabricated ETA;
- project Sources contains only real evidence;
- project Tasks contains only real task/job/verifier state.

## Security / policy matrix

- secret-like content never serialized;
- arbitrary local file paths not leaked;
- external URLs sanitized;
- private connected evidence not exposed as public URL;
- provider identity/cost evidence bounded;
- logs omit credentials and private corpus content;
- official held-out corpus inaccessible to post-held-out benchmark tooling.

## Benchmark harness matrix

- immutable benchmark version;
- exact runtime SHA captured;
- task IDs stable;
- baseline and candidate use same benchmark version;
- scorer cannot modify runtime outputs;
- raw output preserved;
- aggregate report cannot hide per-family regression;
- rerun records attempt number;
- cost totals reconcile with per-task totals.
