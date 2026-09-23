# Conversation viewport release candidate

Observed on 2026-09-21. This is a focused UX-01 follow-up to the enhancement handover; it does not replace the full capability ledger.

## Current evidence

- main: `01f7db0c0d48ab3ba533148e99e1847203e13f4c`.
- Production `/api/health` reports `2f1d7069006c21050611e9703fb6506697b1bac1`, status ok, costUsd 0, freeOnly true, paidFallbackEnabled false. This is readiness evidence only.
- PR603 and PR604 remain open drafts. PR604 head `669775015920dbd76f9cc5418627540582e65bba` has five successful PR workflows. Real owner consent, repository installation verification, live MCP E2E and activation remain separate unfinished gates.
- PR605 head `5fa3c4d4deb63c13889428b7b2dfdf1e8f10ce77` has five successful PR workflows and a successful Vercel status. It is not merged.
- PR607 contains PR605 plus a shared-viewport fix. Existing PR605 is not modified. PR607 targets main because CI filters require main-targeted PRs. Coordinate overlapping candidates before merging.

## Change and local verification

After the first message, the inner App occupied 100dvh below the workspace controls. The enclosing conversation now owns 100dvh, bounds navigation to 45% with scrolling, and gives the rest to the chat. The header and composer do not shrink. The App stays mounted through mode and artifact navigation.

Production build, TypeScript, design-token lock and 14 PersonalEditionApp tests passed. Added browser assertions for the send button and document height at 390/768/1440px plus a reduced 390x380 viewport and reset to Home.

Local browser tests could not execute: the Chromium binary was absent and its official download timed out. Do not count these as passing browser tests. Exact-head CI must verify geometry, and real Android/iOS keyboard behavior is not proven by resizing a browser viewport. No live model call was needed for these layout tests.

## Release gates and remaining scope

1. Exact PR607 head must pass required CI/security/browser workflows.
2. Review the screenshots and navigation/scroll behavior; include artifacts, expanded navigation and low available height.
3. Coordinate PR605/607, obtain the established production-impact approval, then verify the actual production SHA and UI.
4. Keep MCP bootstrap/live activation, existing DOCX/PPTX/XLSX/PDF editing, answer-quality evaluation, coding comparison, update scout/Inbox, image runtime and V2–V4 open. This layout fix does not complete them.

No production, credential, MCP activation, database or paid-fallback changes are part of this candidate.
