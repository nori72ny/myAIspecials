# ORIGIN UI/UX v3.1 — Phase 7 Project Workspace

## Goal

Create a single, grounded project workspace that lets the user move between Chat, Files, Tasks, Artifacts, and Sources without mixing Mode, Model, Tool, Agent, or Artifact responsibilities.

## Base

- Parent Phase 6 exact head: `bd8e016046c5c192828d70c676cf840a1c9aca45`
- Frozen main remains: `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`
- This branch must not merge to main before the V1.4 final unseen held-out qualification completes.

## Product principles

1. Conversation remains the primary surface.
2. Project navigation is context, not another execution engine.
3. Every panel must be backed by real existing state; no fabricated tasks, files, sources, progress, counts, percentages, or completion claims.
4. Existing Chat, Coding, Research, Artifact, and Agent runtime contracts remain authoritative.
5. Mode, Model, Tool, Agent, Artifact, and Project concepts remain visually and semantically distinct.
6. Mobile must not inherit a permanent desktop multi-pane layout.
7. A11y names, keyboard access, visible focus, and >=44px touch targets are release requirements.

## Phase 7 scope

### Project rail / switcher
- Add a lightweight Project-level navigation surface.
- Views: Overview, Chat, Files, Tasks, Artifacts, Sources.
- Only expose a view as active when its backing data exists.
- Empty-state copy must explain availability without inventing data.

### Overview
- Grounded summary of the current project context only.
- May show existing session/artifact/source/task counts when directly derived from state.
- No health score, fake percentage, AI confidence, or speculative next step.

### Chat
- Preserve the current production Chat mount and history behavior.
- Do not duplicate or fork chat state.

### Files
- Reuse grounded Coding Workspace file evidence when available.
- No filesystem claims from client-only guessed state.

### Tasks
- Project tasks are a navigation/read model over real agent/coding job state.
- Do not introduce a second scheduler or execution runtime in this phase.

### Artifacts
- Reuse the existing ArtifactWorkspace and artifact state.
- Do not create a duplicate editor/renderer.

### Sources
- Reuse the validated Research Sources evidence.
- Preserve safe HTTPS-only navigation and conservative evidence semantics.

## Explicitly out of scope

- New provider/model routing
- New paid fallback
- New Git publication/deployment authority
- New autonomous background execution
- New terminal/checkpoint contracts without server-owned evidence
- Any change to final held-out corpus, runner, scoring, or frozen main

## Validation gates

The exact Phase 7 head must pass:
- Production Release CI/CD
- Node 22 and Node 24 build/test/E2E/Lighthouse
- production browser release gate
- V1.4 hosted coding sandbox
- ACOS 2.0 Quality Gate
- CodeQL
- OpenSSF Scorecard
- Dependency Review
- Artifact isolation Chromium/Firefox/WebKit

Focused UI tests must prove:
- project navigation never mutates Mode by accident;
- Chat history survives reload and project-view switches;
- Artifacts and Sources render only from real backing data;
- Files/Tasks unavailable states are truthful;
- mobile does not render a permanent desktop project rail;
- keyboard and accessible labels cover all project controls.

## Release boundary

Phase 7 may be implemented and exact-head validated on this stacked branch, but it must remain unmerged/unpublished while the V1.4 final unseen held-out qualification is pending.
