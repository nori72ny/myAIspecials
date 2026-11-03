# Google AI Studio Bridge — Current State and Next Steps

Updated: 2026-10-18  
Repository: nori72ny/myAIspecials  
Purpose: let Google AI Studio coordinate implementation, tests, and independent AI review with Nori limited to explicit approvals.

## Important correction: part of MCP already exists

Do not restart from a generic MCP design. The repository already contains an extensive ORIGIN MCP client foundation and approval-only bootstrap design.

Evidence on current main when checked for this handoff:
- docs/ORIGIN_MCP_IMPLEMENTATION.md describes the MCP client, guarded Node transport, durable PostgreSQL stores, Supabase owner-session verification, PKCE/OAuth lifecycle, management routes and settings UI.
- docs/MCP_GITHUB_CONNECTOR_REVIEW.md defines a narrowly scoped first target, GitHub Remote MCP read-only endpoint, exact-tool grants, zero-cost evidence expiry and activation gates.
- docs/MCP_APPROVAL_ONLY_BOOTSTRAP.md defines an owner-approval-only GitHub App Manifest flow, repository restriction to nori72ny/myAIspecials, and no-write permission.
- docs/ORIGIN_MCP_IMPLEMENTATION.md says production MCP remains fail-closed/unconfigured: owner Auth user/session issuance is not activated, production runtime composition is absent, and no third-party MCP provider is enabled/qualified.
- docs/ORIGIN_COMPLETION_STATUS.md distinguishes the MCP client from an ORIGIN MCP server exposed outward. The outward-facing server remains SPEC / PLANNED.
- Historical PR #585 was closed unmerged and superseded by #602; do not treat PR #585 or its historical CI as current production code.

These are repository-document claims; refresh the current files and exact main SHA before relying on them for a release decision.

## Two separate integration directions

1. ORIGIN as MCP client: ORIGIN calls a reviewed external service (first intended qualification: GitHub read-only MCP). This has substantial code foundation but remains disabled pending owner identity/consent flow, runtime configuration, app registration, and live E2E.
2. Google AI Studio as orchestrator / MCP client: Google AI Studio needs a supported, authenticated way to read/write task state and invoke approved tools. The existing ORIGIN client does not automatically make ORIGIN's tools available to Google AI Studio.
3. ORIGIN as remote MCP server: this would expose selected ORIGIN capabilities to an external host such as a supported Gemini Interactions agent. The repo's current status document says this server direction is still planned, not live.

Do not conflate these three directions or say “MCP connected” without specifying which direction and proving a live tool call.

## Recommended sequence

### 1. Configure Google AI Studio's agent environment
- Mount the repository as a GitHub source.
- Ensure .agents/AGENTS.md and the audit skill in .agents/skills/independent-audit/SKILL.md are loaded.
- Enable only the required tools and explicitly allowlist the minimum network domains.
- Do not place GitHub/Vercel/provider tokens in prompt text or source files. Use platform-managed secret/header injection where supported.
- Verify whether the actual AI Studio surface being used supports the needed remote MCP host behavior. Google's official docs describe remote MCP in Gemini Interactions API; do not assume every AI Studio UI session supports identical connections.

### 2. Start with read-only GitHub review
- Connect the orchestrator to repo/PR metadata, diffs, checks and artifacts using a least-privilege credential.
- Prove access with a synthetic/non-sensitive task and save a traceable result.
- Then grant branch/PR writes only if the read-only pilot passes. No direct main writes, self-approval, merge or deployment by the implementation worker.

### 3. Add a genuine independent-review channel
- Use a separate AI/provider or reviewer identity that did not author the candidate.
- Provide exact PR/head SHA and evidence packet; save the audit findings to GitHub.
- If no external reviewer endpoint/credential is available, mark the integration BLOCKED. Do not simulate independence by asking the same agent to review itself.

### 4. Decide whether a remote ORIGIN MCP server is needed
- If Google AI Studio only needs GitHub orchestration, use GitHub's supported integration/remote MCP directly and do not expose unnecessary ORIGIN tools.
- If AI Studio must invoke ORIGIN-specific tools, implement a separately reviewed remote MCP server using HTTPS + supported Streamable HTTP, with owner/session auth, exact tool grants, bounded inputs/outputs, rate limits, audit logs and no arbitrary shell.
- Start read-only. Any write tool must be narrowly scoped and approval-bound. Do not deploy an unauthenticated public MCP endpoint.

### 5. Release and AQ-40
- AQ-40 must be genuinely measured; previous handoff evidence stated 0/40 / NOT_MEASURED.
- Actual $0 and ZDR evidence must come from the provider/request path, not hardcoded response fields.
- Independent audit must inspect the exact final SHA, with no unresolved critical/high findings.
- Ask Nori only for the final release approval when the evidence packet is complete.

## Current state labels

- Existing ORIGIN MCP client code: documented as implemented; exact current-head tests and production activation still require fresh verification.
- External AI connections into Google AI Studio: UNVERIFIED until inventory and a live authenticated pilot are recorded.
- ORIGIN outward-facing remote MCP server: documented as PLANNED, not live.
- External independent AI audit: NOT YET EVIDENCED for the current candidate.
- Public release approval: BLOCKED while AQ-40, zero-cost/ZDR evidence, required tests and independent audit are incomplete.

## Official references

- Google AI Studio managed agents and secure external-tool configuration: https://ai.google.dev/gemini-api/docs/aistudio-agents
- Gemini API remote MCP server configuration: https://ai.google.dev/gemini-api/docs/function-calling
