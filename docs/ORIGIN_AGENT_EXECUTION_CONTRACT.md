# ORIGIN Agent Execution Contract

The Agent must never equate a plan with execution.

## Completion invariant
A task may be reported as completed only when:
- a registered tool actually executed;
- verification returned success;
- repair attempts did not exceed the bounded limit;
- no security policy was violated.

## State machine
queued -> running -> awaiting_approval -> completed
queued/running/awaiting_approval -> aborted
A failed verification cannot transition directly to completed.

## Production gate
Before merge to production, CI, security regression tests, benchmark regression gate, and production smoke tests must pass. Draft Agent work remains isolated until those gates are green.
