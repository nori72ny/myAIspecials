// Shared by the controller and hosted recovery loop. No environment overrides:
// a recovery attempt must wait beyond the most recently renewed lease.
export const CODING_CHECK_TIMEOUT_MS = 180_000;
export const CODING_WORKER_LEASE_SECONDS = 240;
export const CODING_WORKER_RECOVERY_WAIT_SECONDS = CODING_WORKER_LEASE_SECONDS + 5;
