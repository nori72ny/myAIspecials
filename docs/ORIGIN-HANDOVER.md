# ORIGIN Engineering Handover

> Purpose: This document is the operational source of truth for any AI engineer/agent that takes over ORIGIN development. Read this file before changing code.

## 0. Mission

ORIGIN Personal is a personal AI / Agentic Coding OS and PWA. The current engineering track is ACOS / Agentic Coding OS Phase 2, focused on a safe repository-editing foundation. The long-term product goal is a high-quality general-purpose AI workbench capable of reliable coding, research, business planning, artifact generation, and multimodal workflows.

Current phase is infrastructure/security first. Do not jump to broad feature expansion while the safety and release gates below remain incomplete.

## 1. Non-negotiable product constraints

1. Zero-dollar operation is a hard product requirement. Do not introduce paid APIs, paid models, billable fallback, or ambiguous-cost providers.
2. Zero-cost enforcement must be fail-closed. If cost cannot be proven to be $0, block the operation.
3. Never fake success when a provider/tool/build/runtime operation fails.
4. Never leak API keys, credentials, private keys, tokens, environment secrets, or sensitive repository content.
5. Repository writes must remain scoped to the server-owned repository root.
6. File writes must be bounded, atomic, and race-resistant.
7. Verification must be bounded, deterministic, isolated, and unable to execute repository-controlled lifecycle hooks as arbitrary commands.
8. Do not weaken security tests just to obtain a green CI result.
9. Do not claim production deployment or readiness without exact-HEAD evidence.
10. Preserve the Release Boundary: Phase 2 safety foundation is isolated from production until all gates pass.

## 2. Repository / branch / PR

Repository: `nori72ny/myAIspecials`
Active Phase 2 branch: `feat/agentic-coding-os-phase2`
PR: #124
PR URL: https://github.com/nori72ny/myAIspecials/pull/124
Base: `main`

At the time of this update, PR #124 remains open, draft, unmerged. Always re-fetch the current PR and HEAD SHA before acting.

## 3. Current architecture

Key Phase 2 modules:

- `src/agent/agentExecutionPolicy.ts`: capability allowlist and explicit-intent/security gates. Current default allowed capabilities are repository read/write and tests; network and shell are not allowed by default.
- `src/agent/agentOrchestrator.ts`: HTTP/SSE orchestration, task execution, approval flow, verification/self-healing/checkpoint routes. File rollback is asynchronous, state-checked, verified, and requires explicit execution intent.
- `src/agent/toolRegistry.ts`: central tool contract and execution boundary. Eight registered tools currently include code_interpreter, document_generator, web_search_grounding, image_prompt_compiler, repository_explorer, file_reader, file_writer, verification_runner. `file_writer` captures a bounded, secret-safe pre-edit snapshot for verified rollback and fails before mutation if the snapshot itself cannot be safely retained.
- `src/agent/safeRepositoryReader.ts`: hardened repository reader. Linux uses stable directory descriptors and `O_NOFOLLOW`; intermediate symlink replacement is defended; non-Linux fails closed.
- `src/agent/safeRepositoryWriter.ts`: hardened atomic writer. Linux uses stable directory descriptors, `O_NOFOLLOW`, `/proc/self/fd/<fd>` traversal, bounded temp writes, and atomic rename; non-Linux fails closed.
- `src/agent/safeRepositoryDeleter.ts`: race-safe deletion primitive for rollback of files that did not exist before an approved edit. It uses stable parent directory descriptors on Linux and fails closed elsewhere.
- `src/agent/safeFileEditor.ts`: validates against a hardened read, detects stale content, then delegates mutation to the hardened writer.
- `src/agent/verificationRunner.ts`: bounded verification with fixed ORIGIN-owned command contracts, isolated HOME/TMPDIR, bounded output and timeout, and no `npm run` lifecycle execution.
- `src/agent/taskGraphExecutor.ts`: preserves file mutation metadata from tool execution through the task result so checkpoints can record the exact rollback boundary.
- `src/agent/checkpointManager.ts`: stores checkpoint metadata plus optional file mutation snapshots. Rollback verifies that the target still matches the checkpoint's post-edit hash, restores prior bytes atomically through the hardened writer or deletes a newly-created file through the hardened deleter, then verifies the restored state. Logical checkpoints without file mutation metadata fail closed with `CHECKPOINT_ROLLBACK_UNSUPPORTED`.
- `src/agent/checkpointManager.test.ts`: regression coverage for exact restore, stale-state rejection, and deletion of newly-created files.
- `src/agent/benchmarkRunner.ts`: benchmark integrity enforcement; unknown/duplicate cases rejected and missing outcomes count as failures.
- `src/agent/taskExecutionGate.ts`: requires explicit intent, tool execution, verification and completion, with bounded repair attempts.
- `src/agent/selfHealingLoop.ts`: bounded repair/verification attempts.
- `src/agent/benchmarkRegressionGate.ts`: benchmark regression threshold gate.
- `services/mission-engine/src/application/agent/ToolExecutor.ts`: legacy engine boundary. Legacy FileTool write is disabled. Legacy WebTool remains network-capable internally, but the current Personal production composition explicitly does not mount `initMissionEngine`; the release-boundary regression test protects this isolation. Do not remove that isolation without a separate security review.
- `services/mission-engine/src/application/agent/security/SafetyPolicyEngine.ts`: returns BLOCK/REVIEW. AgentRuntime blocks BLOCK for tool inputs; current tool-input checks do not use REVIEW. MessageValidator blocks both REVIEW and BLOCK for messages. Revisit REVIEW semantics before expanding legacy engine exposure.

## 4. Security model

### Repository scope
Caller-supplied filesystem roots are ignored. Repository root is server-owned (`process.cwd()`). Never reintroduce a client-provided root.

### Path safety
Reject absolute paths, traversal, protected directories/files, protected key extensions, and secret-like content. Keep limits bounded.

### Race safety
The important property is not merely `realpath()` validation. Reads/writes/deletes must remain tied to stable opened directory/file descriptors so a symlink cannot be swapped between validation and mutation.

### Writes
Use temp-file + atomic rename. Do not directly overwrite target files after validation. Keep the 256 KiB writer/editor/checkpoint snapshot budget aligned.

### Checkpoint rollback
A rollback is only authoritative when the checkpoint contains a file mutation record. Before bytes are never persisted if they match the agent's secret detector. Snapshot size is checked before mutation, so an unsafe-to-snapshot pre-edit file cannot be modified and then leave the agent without a rollback record. Rollback is optimistic-concurrency guarded: if the target no longer matches the recorded post-edit hash, rollback fails closed instead of overwriting newer work. New-file rollback uses stable-parent deletion and is verified after deletion.

### Verification
Do not trust repository `package.json` scripts as executable policy. Verification commands are ORIGIN-owned constants. Do not use `npm run` for verification because npm pre/post lifecycle hooks can become an injection path. Use isolated HOME/TMPDIR and bounded timeout/output.

### Secrets
Secret-like content must be rejected before mutation. Never print secret contents in errors/logs. A file containing detectable secret-like pre-edit content is currently not eligible for `file_writer` checkpointing/editing because the agent must not snapshot that content.

### Network / shell
Default agent policy denies network and shell capabilities. The legacy Mission Engine is intentionally outside the Personal production release boundary. Do not add unrestricted shell execution. If network is later enabled, require an explicit capability, strict allowlist, SSRF defenses, zero-cost proof where relevant, bounded response sizes/timeouts, and redaction.

## 5. Verification command contracts

The repository currently defines approved verification intents for test/typecheck/build. The exact commands are intentionally ORIGIN-owned. If package scripts change legitimately, update the ORIGIN command manifest and tests deliberately rather than allowing arbitrary package-controlled execution.

Before changing verification, add regression tests for:
- malicious pretest/posttest hooks
- modified package scripts
- shell metacharacters
- timeout
- oversized stdout/stderr
- spawn failure
- cleanup on all exit paths
- secret-bearing environment variables

## 6. Current known gaps / next priorities

P0/P1 candidates to resolve before broad Phase 2 completion:

1. **Approval authenticity**: `approval.approved` / `intentExplicit` are request-level claims, not strong user authentication. If ORIGIN is remotely exposed, introduce authenticated sessions and server-side approval state/nonces before treating a write approval as authoritative.
2. **Safety REVIEW semantics**: determine whether tool-input REVIEW must pause for human approval. If yes, enforce it in AgentRuntime rather than only in messaging. Legacy Mission Engine remains isolated from Personal production meanwhile.
3. **Verification direct-exec portability**: current hardening is intentionally strict. Preserve fail-closed behavior on unsupported platforms; do not silently fall back to unsafe path traversal.
4. **Capability semantics audit**: every tool's declared capability and sideEffects must match its real behavior. Document generation should remain modeled as in-memory artifact generation, not repository write.
5. **Benchmark quality**: current scoring integrity is improved, but future benchmark suites must measure real task outcomes, not only internal self-consistency. Add blind external baselines for coding/research/artifact tasks later.
6. **Provider policy**: only exact model/provider combinations with current evidence of $0 may be used. Never infer that an entire provider is free. Current research confirmed an OpenRouter model entry `google/gemma-4-26b-a4b-it:free` with zero prompt/completion pricing at the time checked; re-check current pricing before relying on it.
7. **Checkpoint persistence boundary**: the in-memory server checkpoint map is authoritative for active rollback. If checkpoints are persisted client-side, ensure snapshot content remains protected and stale checkpoints cannot be replayed as authority across sessions.

## 7. Release gate

Do NOT merge or deploy Phase 2 until all are proven for the exact current HEAD:

- typecheck PASS
- complete unit tests PASS
- integration/API tests PASS
- production build PASS
- production Node runtime PASS
- serverless runtime PASS
- E2E/Lighthouse/security gates PASS where configured
- secret scanning PASS
- CodeQL/security checks refreshed and PASS where configured
- benchmark/security regression evidence PASS
- exact-HEAD deployment evidence exists
- exact-HEAD production/runtime smoke checks PASS if production promotion is being considered
- current zero-cost/provider evidence is documented
- no unexplained CI warnings or skipped critical gates

A green CI run for an old SHA does not prove the current HEAD.

## 8. Current CI interpretation

GitHub Actions currently includes an ACOS Quality Gate and a Production Release CI/CD workflow. Jobs include lint/typecheck/tests/build/runtime checks and broader security/E2E/Lighthouse work. Always inspect the latest run by exact HEAD SHA. Treat `pending`, `in_progress`, `skipped`, or missing evidence as not proven.

## 9. Operating procedure for the next AI

Step 1: Fetch PR #124, current branch HEAD SHA, changed files, workflow runs/jobs, and repository status.
Step 2: Read this handover plus the relevant module/tests before editing.
Step 3: Compare current HEAD against the documented state; this file can become stale, so trust the repository and current CI over historical statements.
Step 4: Reproduce failures before fixing them. Never speculate when a deterministic test can be added.
Step 5: Make the smallest security-preserving change.
Step 6: Add a regression test for every security bug fixed.
Step 7: Run typecheck, unit/integration tests, build and runtime checks.
Step 8: Inspect the diff for accidental permission broadening, network enablement, secret exposure, path escape, or production changes.
Step 9: Re-run CI on the final SHA and wait for all required gates.
Step 10: Only after exact-HEAD evidence is complete, consider merge/deploy. If any required gate is unavailable, say so and do not claim readiness.

## 10. Do not do these things

- Do not add paid fallback.
- Do not add unrestricted shell.
- Do not accept a caller-provided repository root.
- Do not replace descriptor-based race defenses with `realpath()` alone.
- Do not directly mutate a file after a separate validation step.
- Do not execute arbitrary package scripts as verification.
- Do not weaken or delete security regression tests.
- Do not mark failed tasks as completed.
- Do not inflate benchmark scores by dropping missing/unknown cases.
- Do not claim deployment from a preview or older SHA.
- Do not expose secrets in diagnostics.
- Do not treat a logical checkpoint marker as a successful repository rollback.
- Do not remount the legacy Mission Engine into Personal production without a new security/release review.

## 11. Product direction after Phase 2

Once the safety foundation is proven, continue in separate controlled lanes:

A. Agentic Coding OS: planning -> repository exploration -> diff -> approval -> edit -> verification -> repair -> checkpoint/rollback -> completion.
B. Intelligence Engine: provider mesh, routing, structured reasoning, reliability and zero-cost enforcement.
C. Research Engine: grounded search/retrieval, source quality, citation integrity, stale-data handling.
D. Artifact Engine: documents, slides, spreadsheets, code artifacts, validation and downloadable outputs.
E. Business Engine: planning, analysis, marketing/sales workflows and reusable templates.
F. Benchmark/Blind Evaluation: compare ORIGIN against strong external systems on identical tasks using outcome-based scoring.
G. UX/PWA: fast mobile-first interaction, resilient streaming, clear failure states, update UX, accessibility and offline-aware behavior.

Keep these lanes independently testable. Avoid one giant rewrite.

## 12. Definition of done

ORIGIN is not "done" because a UI renders or a build is green. For a production-ready release, a task must be reproducible, secure, bounded, verified, observable, and actually useful to the end user. For agentic code changes, the minimum successful path is: explicit user intent -> authorized tool -> safe bounded change -> verification -> successful completion, with honest failure otherwise.

## 13. Handover rule

When another AI takes over, its first message/action should explicitly state that it has read `docs/ORIGIN-HANDOVER.md`, then report the current exact HEAD and verification state. It should continue work autonomously in batches rather than asking for approval after every tiny change, while stopping only at genuine safety/release boundaries.

_Last updated by the ORIGIN engineering handover process on 2026-09-02 JST. Re-validate every volatile claim against the live repository and CI before relying on it._
