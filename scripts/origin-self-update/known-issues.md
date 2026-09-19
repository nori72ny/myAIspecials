# ORIGIN known constraints and protected invariants

This file is read by the Phase 1 self-evolution judge.
Only verified current constraints belong here. Historical findings that have already been mitigated must not be kept as unresolved facts.

## security / architecture

### Protected invariant — artifact preview isolation
Current main already uses an ORIGIN-owned sandbox document, iframe `sandbox=allow-scripts`, sanitized preview markup, `connect-src 'none'`, restrictive HTTP CSP, no-referrer, and browser-isolation tests.

Treat any proposal that weakens those boundaries as `risk: high`.
Do not describe the historical self-navigation finding as currently unresolved unless a fresh reproduction proves an egress path.

### Recurring audit risk — wiring / enforcement gaps
Past reviews repeatedly found a class of issue where a protection exists but is not actually on the authoritative runtime path, or a declared value is trusted without runtime proof.

For any security proposal, verify:
- authoritative call path;
- fail-closed behavior;
- exact runtime evidence;
- regression test;
- no bypass via legacy/inactive path.

## design

### Design-token lock exclusions
`scripts/design-token-lock.js` currently excludes 11 legacy/complex files, including `src/App.tsx`.
Treat expansion of that exclusion list as `risk: medium` and proposals that reduce exclusions as potentially useful only when visual/E2E/accessibility checks stay green.

### Contrast watch
Hard-coded legacy indigo values such as `#6366f1` / `#818cf8` still exist in parts of the codebase.
Do not assume every occurrence is a WCAG failure; verify actual foreground/background usage and rendered contrast before proposing a change.

## provider / privacy / cost

- Production authoritative chat path is `POST /api/chat`.
- Primary execution is fixed to the currently verified OpenRouter free model.
- No automatic model/provider switch may be introduced by the self-evolution system.
- `$0`, no paid fallback, data-collection deny / ZDR evidence, exact served-model evidence, and metadata-only diagnostics are protected release invariants.
- A public free-model listing is discovery evidence only; it is not enough to change the configured model.

## release / evaluation

- The self-evolution system must not move `main`, merge a PR, deploy Production, or invalidate an active held-out/AQ freeze.
- Validation branches and self-update proposals are not product authority.
- A missing/failed external source must remain explicit missing evidence, never an implicit pass.
