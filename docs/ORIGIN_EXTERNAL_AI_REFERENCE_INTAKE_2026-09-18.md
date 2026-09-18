# ORIGIN — External AI Reference Intake Review 2026-09-18

## Scope

This document classifies newly supplied third-party AI comparison notes as design inputs. It does not change runtime behavior and must not override current freeze/release governance.

## Critical governance correction

The supplied instruction to repair `src/App.tsx` and merge PR #106 must **not** be executed as written.

Live repository state:
- PR #106 is still open and unmerged.
- PR #106 head: `f45a4c2846c87192d12045025cf7355c1e55d5aa`.
- Its recorded base is old: `37ecbbbb908804b2ff879052b8e8b9125440872a`.
- Current frozen `main`: `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`.
- PR #106 is not mergeable in the current live state.
- V1.4 final unseen requires main to remain unchanged.

Therefore PR #106 is historical reference only until the held-out freeze is released.

## Identity correction

ORIGIN Personal is **not Grok/xAI**.

Any supplied note that equates:
- `ORIGIN = Grok`
- `ORIGIN (Grok/xAI)`

is incorrect and must not be propagated into architecture, UI copy, benchmarks, documentation, or product positioning.

## High-confidence design patterns to adopt as inputs

### 1. Plan → Execute → Verify
Useful across modern agent systems.

ORIGIN mapping:
- RequestIntent / Planner
- bounded Executor
- Evidence Ledger
- Independent Verifier
- Repair Loop
- Presenter

Status: already represented in the post-held-out AQ design and partially implemented on draft branches.

### 2. Grounding before factual confidence
Useful pattern:
- search/retrieve;
- rank/filter;
- map claims to evidence;
- surface conflicts;
- fail closed when evidence is unavailable.

ORIGIN mapping:
- Grounded Research
- Claim Model
- Evidence Ledger
- Source Verification
- Source Network Policy
- Pinned Fetch

### 3. Execution evidence over declarations
A model saying “tests passed” is not sufficient.

ORIGIN mapping:
- deterministic execution evidence;
- coding verification contract;
- trace persistence;
- no synthetic `verified` state.

### 4. Action-level transparency, not raw chain-of-thought
Show:
- Plan
- Search / Read / Inspect
- Execute
- Verify
- Repair
- Deliver

Do not expose or persist raw hidden reasoning.

### 5. Durable external task state
Useful patterns:
- project workspace;
- artifacts/files;
- task state;
- checkpoints;
- trace/evidence;
- persistent user-controlled context.

Avoid claiming “unlimited memory” or proprietary competitor internals without evidence.

### 6. Read-only parallelism / state-changing serialization
Strong implementation pattern for agent safety:
- parallelize independent reads/searches;
- serialize writes/actions that mutate state;
- require approval for consequential operations.

### 7. Progressive disclosure
Load tool/skill instructions only when relevant to reduce context pressure.

ORIGIN candidate:
- capability registry metadata always available;
- detailed tool schema only on activation;
- file/resource instructions loaded on demand.

## Claims requiring first-party verification before adoption

Do not encode these as facts until verified:

- fixed Manus Planner / Execution / Knowledge / Verification architecture;
- exact internal Manus sub-agent roles beyond documented parallel Wide Research behavior;
- Perplexity exact three-stage RAG and DeBERTa-v3 pipeline in current production;
- Perplexity per-claim confidence score as a current first-party product contract;
- OpenAI internal “Labrador index” claim;
- speculative looped-Transformer architecture for GPT-6 Astra;
- exact GPU training counts for proprietary models;
- claims that Astra/Codex preserves all prior context windows without summarization;
- Gemini internal planner/task-model architecture unless confirmed by Google;
- Claude Code exact compaction percentage or fixed recursive-subagent limit unless current official docs state it;
- Genspark exact “9 LLM + 80 tools + 10 datasets” production composition;
- Grok internal multi-agent debate claims;
- global “best AI” rankings and unsourced accuracy ordering.

## Claims contradicted or unsafe to carry forward

### ORIGIN = Grok/xAI
Incorrect.

### Merge PR #106 now
Unsafe/stale under the current freeze and live repository state.

### “Confidence score” as truth probability
Do not present retrieval/relevance/confidence as probability that a claim is true.

If ORIGIN exposes confidence-like UX, it must be narrowly scoped, e.g.:
- evidence coverage;
- source freshness;
- verifier state;
- conflict state.

### Raw internal debate / chain-of-thought display
Do not expose hidden reasoning. Show auditable actions, evidence, decisions, and verification results instead.

## Current first-party confirmations relevant to these notes

### OpenAI
Current official GPT-6 Astra materials support:
- strong computer use, browsing, SWE, cybersecurity, science, professional work;
- end-to-end multistep professional work and artifact creation;
- 1,050,000 context window in API documentation;
- ChatGPT Work / Codex / API surfaces.

Do not infer undocumented internal architecture from these product claims.

### OpenAI deep research
Official materials support:
- multi-step research;
- planning/searching/reading;
- real-time progress;
- interruption/refinement;
- citations;
- trusted-site/app/MCP connections.

### Google Gemini Deep Research
Official API materials support:
- autonomous planning, execution, synthesis;
- iterative search/read;
- cited reports;
- collaborative planning;
- MCP;
- visualization;
- background execution.

### Manus
Official help materials support:
- parallel Wide Research subtasks;
- multiple agents operating on decomposed subtasks;
- paid/credit-based feature constraints.

This does not prove a universal fixed Planner/Execution/Knowledge/Verifier internal architecture.

## ORIGIN implementation implications

### Already implemented / validating
- Evidence Ledger
- Material Claim Model
- Deterministic Verifier
- Answer Evidence adapters
- sanitized execution trace persistence foundation
- chat trace sink wiring
- source DNS/SSRF policy
- pinned HTTPS source fetch
- duplicate-submit browser race
- automated main-chat WCAG scan

### Post-held-out implementation candidates
- claim-to-source support mapping in the final answer pipeline;
- source verifier executor with semantic claim-support checks;
- bounded repair loop;
- verifier-driven presenter;
- progressive tool disclosure;
- durable user-controlled task/project memory;
- read-only parallel task execution with serialized mutation.

## Benchmark policy

Do not copy competitor claims or benchmark tasks into the official V1.4 final unseen corpus.

After held-out:
1. freeze official held-out result;
2. run ORIGIN AQ baseline on a separate benchmark;
3. implement selected patterns;
4. rerun the same separate benchmark;
5. report raw metric deltas and regressions;
6. retain USD 0 / free-only / fail-closed constraints.

## Source quality rule

Prefer:
1. first-party product/docs/system cards;
2. first-party engineering blogs;
3. primary papers;
4. reputable secondary analysis;
5. community posts only as hypotheses.

Secondary sources may suggest what to verify, but must not define ORIGIN architecture as fact.
