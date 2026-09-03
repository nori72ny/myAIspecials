# ORIGIN Versioned Capability Release Roadmap

## Purpose

ORIGIN is intended to accept an unpredictable mix of questions and tasks rather than a fixed command list. Examples include ordinary conversation, research, document creation, web/application creation, data work, and image requests.

The release strategy is therefore capability-oriented and incremental: each version must be genuinely usable, independently verified, and safe to publish before the next capability family is added.

## Non-negotiable release rules

1. $0 production execution remains mandatory. No paid fallback is allowed.
2. A capability is not considered available merely because a planner, prompt, UI label, or stub exists. The execution path must be connected and tested.
3. ORIGIN must distinguish planning, execution, verification, and delivery. It must never claim an artifact, search, review, or external action happened when it did not.
4. Current-information requests require real source evidence. If no compliant source is available, ORIGIN must say so rather than fabricate freshness.
5. Every release has an exact audited commit SHA and must pass the applicable automated, security, runtime, and user-facing gates.
6. New capabilities are added without weakening existing security boundaries.

## Release sequence

### V1 — Reliable Universal Conversation Core
**Goal:** Make the current ORIGIN reliable for arbitrary conversational requests and intent routing.

- Stable question/answer handling
- Intent classification
- Correct distinction between stable knowledge and current-information requests
- Safe failure states
- Provider identity and $0 enforcement
- Basic answer-quality verification
- PWA/UI stability

**Exit:** ordinary questions do not get incorrectly blocked; provider policy is enforced server-side; core tests/build/runtime are green.

### V1.1 — Grounded Research
**Goal:** Make "search/research/current information" a real capability rather than a declared capability.

- Explicit research intent
- Zero-cost, policy-compliant source connector(s)
- Source retrieval and sanitization
- Source/evidence record attached to the answer
- Freshness timestamp where available
- Source-unavailable state
- Regression tests for source available/unavailable

**Exit:** a current-information request either returns traceable evidence or truthfully reports that research could not be executed.

### V1.2 — Real Artifact Studio
**Goal:** Produce actual user-requested files, not only draft their contents.

Capability families:
- Documents
- Presentations
- Spreadsheets
- Charts/data outputs
- Export/download delivery

Each artifact requires:
`request → plan → generate → validate → deliver`.

**Exit:** every advertised artifact type has a real creation path and deterministic validation; unsupported types remain explicitly unavailable.

### V1.3 — Web & Application Builder
**Goal:** Turn a natural-language request into a usable web/application workspace.

- App/site specification
- File tree generation
- Safe repository/workspace boundaries
- Preview/build
- Runtime verification
- Iterative repair with hard budgets
- User-visible change summary

This is the main Claude-Code-style capability family and must inherit the existing Agentic Coding OS safety model.

**Exit:** an application can be created and verified inside an isolated workspace without arbitrary host access or uncontrolled repair loops.

### V1.4 — Agentic Coding OS
**Goal:** Make coding tasks genuinely agentic while preserving hard safety limits.

- Repository exploration
- Safe file reads/writes
- Tool registry and capability authorization
- Checkpoint/recovery
- Context isolation
- Tool-output sanitization
- Prompt-injection resistance
- Symlink/path/TOCTOU protection
- Command/network restrictions
- Bounded tool calls and repair attempts
- Completion verification

**Exit:** red-team regression suite covers shell escalation, sandbox escape, secret leakage, network egress, malicious repository instructions, checkpoint replay/poisoning, output exhaustion, and cross-task contamination.

### V1.5 — Creative & Visual Generation
**Goal:** Handle image/visual requests as a first-class capability where a compliant execution provider is actually available.

- Image request intent
- Prompt planning
- Image generation/editing execution
- Result validation
- Honest provider/model/cost reporting
- No fake "generated" result when generation was not executed

A free-only constraint means this capability cannot be marked available until its real provider path satisfies the $0 evidence gate.

### V2 — Unified Production OS
**Goal:** Combine conversation, research, artifacts, application building, agentic coding, and visual generation behind one adaptive request router.

The user should not need to know which subsystem to invoke. ORIGIN determines the required capability, executes only permitted steps, verifies the result, and presents the deliverable.

## Capability state model

Every capability is one of:

- `available`: execution path exists and is verified in the current release.
- `partial`: some planning/preparation exists, but end-to-end execution is not yet verified.
- `unavailable`: execution path is absent or blocked by policy.

The UI and API must use this state consistently.

## Definition of done for each version

A version is publishable only when:

- implementation is connected to the authoritative execution path;
- relevant unit/integration/E2E tests pass;
- build and production-runtime checks pass;
- security and $0 policy gates pass;
- capability claims match actual execution;
- exact release SHA is audited;
- production smoke tests pass;
- known limitations are documented.

## Immediate execution order

1. Finish current CI/test stabilization.
2. Lock V1 universal conversation behavior.
3. Complete V1.1 grounded research end-to-end.
4. Complete V1.2 real document/presentation/spreadsheet artifact delivery.
5. Complete V1.3 web/application workspace.
6. Complete V1.4 Agentic Coding OS red-team gate.
7. Complete V1.5 visual generation only when a compliant $0 execution path is proven.
8. Integrate the capability router and publish V2.

This roadmap intentionally favors frequent, usable releases over attempting to complete every capability in one change set.
