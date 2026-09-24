# ORIGIN Personal V3.2 — Single-Surface UX Contract

Status: Draft post-release candidate
Stacked on: PR #647 automatic Grounded Research
Do not merge while P0 release freeze Issue #650 is active.

## Product principle

**Simple outside. Rigorous inside.**

A user should be able to use ORIGIN without learning what mode, agent, model, tool, project, pipeline, or verification stage is active.

The normal interaction is one conversation surface and one request field.

## 1. Default surface

The default screen shows:
- ORIGIN identity
- history
- settings
- new conversation
- one request composer
- existing conversation / result when present

The default screen does **not** show:
- a permanent mode bar
- Model / Tools / Agent cards
- Project dashboard
- empty Files / Tasks / Sources
- workflow stages
- unavailable capabilities
- simulated progress
- internal routing terminology

## 2. Progressive capability access

The existing composer **＋** is the only advanced-capability entry point.

When opened, it may show:
- ファイルを添付
- 調べる
- コード
- 作る
- 詳細

The menu is closed by default on PC and mobile.

No additional permanent toolbar is added to the chat surface.

## 3. Automatic capability routing

Normal language remains the primary control.

Examples:
- “今日の公開情報を調べて” → Grounded Research can activate automatically.
- “この内容を比較して” → ORIGIN may use research when current/public evidence is required.
- stable explanatory questions remain on the normal answer path.
- code execution, repository mutation, publishing, deployment, permission changes, and other state-changing operations remain explicit and fail closed.

Automatic routing must not weaken:
- $0-only policy
- provider/network retry = 0
- sensitive-input blocking
- secret isolation
- approval boundaries
- provenance requirements

## 4. Tool workspaces

Research / Code / Create remain available as dedicated workspaces for users who intentionally open them.

When a dedicated workspace is open:
- show one clear “← 会話” return action
- show the workspace name
- show “詳細” only when grounded detail exists or can be opened intentionally
- do not restore the old four-mode navigation bar

## 5. Mobile contract

Target: 320px and 390px.

Requirements:
- no page-level horizontal overflow
- no permanent capability row above chat
- composer add-menu target >= 44x44
- all menu items >= 44px high
- dedicated workspace header remains one line
- chat draft survives opening and closing a workspace
- artifacts retain 会話 / 成果物 switching only when an artifact exists

## 6. Desktop contract

Target: 1280px and 1440px.

Requirements:
- first-use hierarchy is ORIGIN → request → answer
- advanced capability menu stays visually secondary
- no duplicated header/navigation layers
- no project management chrome unless explicitly requested
- answer width remains readable and centered

## 7. Truthfulness contract

ORIGIN must not look more capable than it has proven.

- no fake progress percentage
- no fake ETA
- no unavailable Terminal / Checkpoint tabs
- no “verified” wording beyond measured evidence
- no hidden paid fallback
- no silent automatic retries

## 8. Release acceptance

- unit tests cover capability callbacks and menu disclosure
- E2E covers Code/Create access through the composer menu
- direct workspace URLs still work
- browser back navigation works
- chat draft is preserved across workspace changes
- visual QA is captured for 390 / 768 / 1440 widths
- accessibility serious/critical violations remain zero
- Artifact isolation stays green on Chromium / Firefox / WebKit
- no production or main change while Issue #650 is active

## 9. Strategic intent

ORIGIN should feel simpler than the system it actually is.

The product advantage is not showing more controls. It is doing more work correctly after the user states the outcome they want.
