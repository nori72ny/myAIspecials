// Shared by the controller, isolated test runner, parity CI, and hosted recovery.
// Observed on exact two-CPU / 3-GiB offline worker parity on 2026-10-09:
// 347 files / 3062 tests all pass, but need 222.50s (over old 180s limit).
// Retain all four checks; never silently skip tests or raise unbounded budgets.
// DB lease max is 300s. Keep a >=30s budget between an individual check and
// the renewed lease so cancellation/status proof can be persisted fail-closed.
export const CODING_CHECK_TIMEOUT_MS = 270_000;
export const CODING_WORKER_LEASE_SECONDS = 300;
export const CODING_WORKER_RECOVERY_WAIT_SECONDS = CODING_WORKER_LEASE_SECONDS + 5;
