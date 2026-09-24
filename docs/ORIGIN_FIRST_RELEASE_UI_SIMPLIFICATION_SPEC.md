# ORIGIN Personal — First Release UI Simplification Specification

Status: implementation contract for PC + mobile
Scope: Personal first release surface only
Owner intent: ORIGIN should feel like an immediately usable personal AI, not an operations dashboard.

## 1. Product rule

The first screen must answer one question within one second:

**What can I do here right now?**

The answer should be obvious without understanding Workspace, Model, Tools, Agent, Project, job state, terminal, checkpoint, or internal orchestration concepts.

## 1.1 Single-input principle

The normal path is one request field. Mode selection is optional, not required knowledge.

- the user describes the outcome in ordinary language
- ORIGIN detects whether the work needs direct reasoning, decision support, research, or a deliverable
- safe read-only capabilities may be invoked internally without adding dashboard UI
- state-changing actions, code execution, publication, deployment, permission changes, and other approval-boundary actions remain explicit and fail closed
- the UI reports real results and evidence; it does not simulate progress or expose internal orchestration as decoration

## 2. Primary hierarchy

### Always visible
- ORIGIN identity
- history
- settings
- primary modes:
  - 会話
  - 調べる
  - コード
  - 作る
- the current task input
- the current answer or result

### Progressive disclosure only
- project workspace
- sources
- artifacts metadata
- coding readiness diagnostics
- job identifiers
- Plan / Execute / Test / Verify / Deliver breakdown
- Files / Diff / Tests
- security / publication boundaries

### Never show as an empty primary control
- unavailable Work
- unavailable Terminal
- unavailable Checkpoint
- empty Files / Tasks / Sources cards
- empty workflow stage cards
- internal capability names with no user action attached

## 3. PC first screen

Target: one viewport, no page-level horizontal scroll.

Visible:
- compact mode bar
- ORIGIN chat header
- centered task input / conversation
- history and settings

Hidden by default:
- Project details
- model/tool/agent diagnostics
- coding internals

Advanced information opens from one explicit **詳細** affordance.

## 4. Mobile first screen

Target widths: 320px and 390px.

Visible:
- compact header
- four primary modes
- task input / conversation
- result

Rules:
- no permanent dashboard cards above the task
- no empty Plan/Execute/Test/Verify/Deliver stack
- no empty Files/Diff/Tests/Terminal/Checkpoint row
- unavailable capabilities do not occupy tabs
- minimum interactive target: 44px
- no horizontal document overflow

Artifacts:
- when present, use 会話 / 成果物 switching
- artifact details stay out of the first screen

## 5. Coding mode

Before a job:
- show goal input
- show execution key
- show one primary submit button
- compact readiness state
- connection diagnostics and existing-job recovery stay inside details

During a job:
- show current status and cancel/stop
- detailed workflow stages stay collapsed under 実行詳細

After evidence exists:
- show only evidence-backed views: Files / Diff / Tests
- Terminal and Checkpoint stay absent until real server-backed contracts exist
- do not fabricate progress %, ETA, logs, checkpoints, or success

## 6. UX anti-patterns prohibited

- stacked navigation layers
- duplicated ORIGIN headers that compete for hierarchy
- dashboard-first presentation
- empty status cards used as decoration
- unavailable features presented as normal navigation
- technical vocabulary required for first use
- second 100dvh surface stacked under another application shell

## 7. Release acceptance

PC:
- 1280x720 and 1440x900: task input visible without page-level horizontal scrolling
- Project details closed by default
- no Model / Tools / Agent cards on the primary surface

Mobile:
- 320x568 and 390x844: no horizontal document overflow
- primary task input remains directly reachable
- Code mode does not render empty workflow/result dashboards
- four primary mode targets remain usable

Functional:
- chat drafts survive mode changes
- history/settings remain available
- artifact isolation unchanged
- coding auth/secrets unchanged
- free-only / no-paid-fallback unchanged
- approval and deployment boundaries unchanged

## 8. Product principle

ORIGIN may be technically complex internally. The user should not have to carry that complexity.

**Simple outside, rigorous inside.**
