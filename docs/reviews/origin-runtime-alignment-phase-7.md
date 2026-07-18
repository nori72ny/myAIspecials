# ORIGIN Runtime Alignment — Phase 7 Reviewed Execution Coordinator

Target: PR #45  
Tracking issue: #44  
Status: Draft, unmerged, undeployed

## Objective

Connect the review requirement, primary execution record, independent reviewer record, and synthesis decision into one fail-closed coordinator that can be tested without external credentials.

## Implemented

### Measurable-value review policy

A review is required when any of the following is true:

- the user explicitly requests independent review;
- the result affects a consequential decision or action;
- the answer contains freshness-dependent claims;
- the task is security, operations, architecture, or current information;
- a supplied primary confidence is below the review threshold.

Low-risk documentation work can skip review when no review signal exists.

### Reviewed execution coordinator

The coordinator:

1. executes the primary candidate;
2. verifies that the reported primary provider and model match the plan;
3. decides whether review adds measurable value;
4. fails closed when a required reviewer is unavailable;
5. rejects a reviewer from the same provider as the primary;
6. executes the reviewer when eligible;
7. verifies reviewer provider and model identity against the plan;
8. passes both records to deterministic synthesis;
9. returns accepted, needs-revision, or rejected status with trace references.

## Tests

Deterministic mock tests cover:

- high-risk primary plus independent review;
- required reviewer unavailable;
- same-provider reviewer rejection;
- primary execution metadata mismatch;
- low-risk review skipping;
- measurable-value review policy reasons.

## Important limitations

- No second live provider is called.
- The current free-model catalog contains one provider path, so a live independent reviewer is not yet eligible.
- A high-risk live request must therefore remain single-answer with truthful `verificationStatus: not-run`, or fail closed once reviewed execution is activated.
- The coordinator is not connected to `/api/chat` in this phase.
- Correction/re-execution after `needs-revision` is not implemented.

## Next gate

Before enabling this coordinator in Personal Edition:

- define at least two independently controlled, evidence-current, zero-cost and data-policy-eligible provider paths;
- apply the same secret, context, cost, timeout, routing-evidence, and retention checks to both;
- minimize reviewer context to the original task, primary result, evidence, and explicit limitations;
- prevent review prompts from requesting hidden reasoning;
- add a bounded correction loop with a strict maximum attempt count;
- expose conclusion-first accepted/revision/rejected states;
- complete an independent architecture and adversarial review of the exact candidate SHA.

No merge, deployment, DNS, billing, credential, account, or paid-service action is authorized.
