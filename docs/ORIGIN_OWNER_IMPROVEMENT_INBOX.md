# ORIGIN Owner Improvement Inbox — Phase 1

## Goal

Give the Owner a dedicated, low-friction place inside ORIGIN to submit product ideas, bugs, security information, UI/UX feedback, AI/model suggestions, and external-service proposals.

## Interaction model

ORIGIN uses a hybrid model:

1. Dedicated **Improve ORIGIN** button as the canonical tracked entry point.
2. Conservative normal-chat routing for explicit ORIGIN/app/UI improvement requests.

Normal chat is never silently converted into implementation authority. When an explicit improvement request is detected, ORIGIN stores a local backlog item and continues the chat normally.

## Phase 1 storage boundary

- Improvement items are stored only in a dedicated browser IndexedDB database.
- No GitHub/Vercel/Supabase write occurs from the Owner Inbox.
- No Production deploy occurs.
- No secret/API token is required.
- Inputs detected as sensitive are rejected before storage.
- Items carry `localOnly: true`.

## Backlog states

- received
- researching
- decision-ready
- building
- verifying
- owner-approval-required
- ready-to-release
- released
- rejected-or-deferred

Phase 1 UI creates only `received` items. Later phases may advance states after verified work.

## Categories

- product
- security
- design
- ai
- reliability
- performance
- external
- other

## Security model

Owner intent is trusted as intent, but pasted external material remains untrusted evidence.

Phase 1 does not connect the Inbox directly to a repository-write or deployment sink. This intentionally preserves the Self-Evolution Source→Sink boundary.

A later server-side sync to the Evolution Backlog / GitHub Issues requires explicit Owner approval because it introduces a credentialed external write path.

## Routing rule

Automatic capture from normal chat requires both:

- an explicit ORIGIN/app/UI target; and
- an explicit improvement/change verb.

Examples that should route:

- "ORIGINの回答画面をもっと見やすく改善して"
- "このアプリのセキュリティを強化して"

Examples that must not route:

- "ReactのuseMemoを説明して"
- "Claude Codeの特徴を教えて"
- "ORIGINについて教えて"

## Promotion

This feature remains a stacked Draft PR while V1.4 final qualification keeps main frozen.
