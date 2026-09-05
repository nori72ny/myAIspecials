# ORIGIN Personal v2 — Capability Routing

## Release intent

v2 adds a deterministic capability-selection layer before provider execution.
It identifies the work type (`answer`, `research`, `coding`, `writing`, `analysis`) without making network calls and without selecting a paid provider or model.

## Safety invariants

- $0 policy remains mandatory.
- No paid fallback is introduced.
- Provider selection remains owned by the existing zero-cost execution policy.
- Capability selection is bounded and deterministic; it cannot create retry loops.
- Explicit capability selection wins over keyword inference.
- Unknown requests safely fall back to `answer`.

## v1 → v2 boundary

v1 hardened zero-cost provider execution by removing internal retry amplification and preserving fail-closed cost validation.
v2 adds task-capability routing as an independent layer so later provider/model specialization can be added without coupling capability inference to billing or provider fallback.
