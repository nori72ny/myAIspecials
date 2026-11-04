# Repository-wide instructions for every AI and contributor

Before changing ORIGIN, read and follow [ORIGIN Release Quality Standard](docs/ORIGIN_RELEASE_QUALITY_STANDARD.md). This is mandatory for all humans, AI assistants, coding agents, contractors, and future handoffs.

Release gate:
- Perform evidence-based checks of real functionality, browser layout, UI/UX/design, accessibility, regression/security, performance, and cost/safety constraints before proposing release.
- Fix failures and rerun the same checklist under the same browser/viewport conditions.
- A change is release-eligible only at **90% or higher overall pass rate AND 100% pass on all critical checks**. Any unresolved or unverified critical check blocks release.
- Never fabricate scores or mark unexecuted checks as passed. Record PASS / FAIL / UNVERIFIED and link logs, test results, screenshots, measurements, and the exact commit SHA.
- A passing audit is not permission to merge or deploy. Follow the repository's existing approval boundaries; do not merge or publish without explicit authorization.
- Preserve the $0.00-only policy. Do not invoke a paid service, model, or fallback; if zero cost cannot be established, mark it UNVERIFIED and do not run it.

These requirements apply regardless of who performs the work or which AI/tool is used.
