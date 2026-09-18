# ORIGIN — Post-Held-Out Release Runbook

## Objective

Define the exact sequence from completion of the V1.4 final unseen qualification to production release without contaminating the held-out result or mixing unverified answer-quality changes into the UI/UX stack.

## Preconditions

Do not execute this runbook until all of the following are true:

- the V1.4 final unseen workflow has been run exactly once from the frozen main;
- the public evidence artifact exists;
- the workflow run ID is recorded;
- the frozen base SHA matches `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`;
- no engineering assistant saw the private corpus before the official run;
- the result is frozen before any post-held-out tuning.

## Stage 1 — Freeze qualification evidence

Record:

- workflow run ID;
- corpus digest;
- participant;
- task count;
- solved count / solve rate;
- recovery task results;
- verification axes;
- provider requests;
- total cost USD;
- failures / unsupported claims;
- exact base SHA.

Do not reinterpret or overwrite the raw evidence.

## Stage 2 — Open answer-quality implementation phase

Use PR #331 as design input only.

Create a new implementation branch after the official held-out result is frozen.

Implement in bounded slices:

1. Intent & Risk Classifier
2. Planner
3. Executor evidence capture
4. Independent Verifier
5. Presenter
6. multi-source Research loop
7. coding repair / re-verification loop

Do not tune against the official held-out corpus.

## Stage 3 — Separate answer-quality benchmark

Create a new benchmark corpus unrelated to the official V1.4 final unseen tasks.

Required benchmark families:

- factual QA with recent web evidence;
- multi-source comparison;
- contradiction handling;
- professional long-form advice;
- coding generation and repair;
- artifact generation;
- ambiguity handling;
- fail-closed behavior;
- citation support precision.

Measure before and after:

- factual support rate;
- citation precision;
- unsupported-claim rate;
- contradiction detection;
- task completion rate;
- verifier rejection rate;
- repair success rate;
- latency;
- provider requests;
- cost USD.

## Stage 4 — Integrate validated UI/UX stack

Validated stack:

- Phase 6 PR #319 — Research Sources
- Phase 7 PR #323 — Project Workspace
- Phase 8 PR #325 — Mobile UX
- Phase 9 PR #327 — Accessibility
- Phase 10 PR #329 — Polish

Final validated UI/UX stack head before answer-quality implementation:
`f6955b51bb4817811bcf6addb643ea7e22460fb0`

Integration must preserve commit ancestry or produce an auditable merge sequence.

## Stage 5 — Full release gate

Required before production:

- Node 22 / 24 build success;
- lint / typecheck success;
- unit tests success;
- E2E success;
- production browser checks success;
- Lighthouse gate success;
- artifact isolation Chromium / Firefox / WebKit success;
- Dependency Review success;
- CodeQL success;
- OpenSSF success;
- ACOS success;
- hosted coding sandbox success;
- secret scan success;
- production health success;
- streaming / multi-turn / history / PWA verification;
- fail-closed provider behavior;
- cost = 0;
- no secret leakage;
- no temporary artifact leakage.

## Stage 6 — Production promotion

Only after all gates pass:

1. merge the approved integration branch to main;
2. verify the exact main SHA;
3. verify Vercel production deployment SHA matches main;
4. verify `/api/health` reports healthy and expected release SHA;
5. verify production chat / research / coding critical paths;
6. verify no paid fallback and cost remains 0;
7. verify no secrets in URL/log/localStorage;
8. report production URL and final release SHA.

## Stage 7 — Post-release audit

Immediately after production:

- inspect Vercel runtime errors;
- verify health;
- verify main SHA == production SHA;
- run smoke tests;
- confirm UI/UX stack is visible on production;
- confirm answer-quality pipeline is active only if its dedicated benchmark passed;
- record rollback SHA.

## Rollback rule

If any critical production gate fails:

- stop promotion;
- revert to the last known-good production SHA;
- do not mask failure with fallback behavior that violates the zero-cost policy.

## Release communication

Final release report must include:

- version;
- production URL;
- main SHA;
- production deployment SHA;
- health status;
- gate summary;
- answer-quality benchmark delta;
- cost status;
- known limitations;
- rollback SHA.
