# Agent V3 document generation connection — 2026-10-08 JST

## Implemented

The legacy `document_generator` can now draft Markdown through the existing zero-cost provider adapter. It requires a server-supplied explicit opt-in (`ORIGIN_AGENT_DOCUMENT_GENERATION_ENABLED=true`) and the existing server-side provider credential. This change does not activate production or create credentials.

- V3 exact-operation approval and atomic run consumption precede inference.
- A distinct `draft_document` capability requires explicit intent and the safety check.
- The adapter makes one request through the existing primary provider policy. Cost, routing and privacy evidence are required; paid/fallback/unverified results are rejected.
- Inputs and outputs are bounded. Recognizable secrets, empty/oversized output, exact input echo and active script markup are rejected without exposing provider exception details.
- Only approved caller text is sent; repository reads, arbitrary URLs, filesystem writes and binary Office exports are not part of this operation.
- The actual returned draft is preserved. Structural preflight is not semantic quality certification.
- Legacy orchestration callers cannot gain inference access from ambient environment flags. V3 explicitly supplies its server environment.
- Status separates configuration from live verification. The private evaluation permission-profile digest changes to include this new provider boundary; old sealed corpora must not be silently reinterpreted.

## Executed checks

73 Agent test files / 498 tests passed. TypeScript and production build passed.

The new adapter and HTTP tests use a stubbed provider, with the real zero-cost evidence validator. They cover successful transport through plan/approval/execute/checkpoint, invalid approval, replay, timeout, no automatic retry, missing configuration, invalid input/output, unsupported file format, nonzero/missing billing evidence, fallback routing, privacy evidence and recognized secrets. These do not prove actual model quality or free-provider availability.

Local environment presence checks (values were not read or printed): document feature disabled, free-provider credential absent, coding worker not configured. No live provider inference was attempted.

## Unfinished qualification

1. Authorized remote branch/PR reflection and exact-head CI. Automatic review has blocked the GitHub push pending explicit destination-specific approval. No alternate write route was attempted.
2. Preview-only activation with existing approved server-side configuration, followed by actual document output inspection and task-specific semantic checks. No production activation is authorized by this document.
3. Agent code execution must use the existing Coding V1.4 isolated worker and its owner-bound job authorization. It must not be enabled by running caller code on the HTTP server or by mapping the general Agent operator to a Coding owner without an explicit trusted delegation design.
4. Research must be retested in an authorized network-enabled environment; local DNS failure is not answer-quality evidence.
5. Final sealed evaluation, independent comparison and production release remain incomplete.

The previous inspection ZIP targets an earlier exact SHA and remains historical evidence, not evidence for this revision.
