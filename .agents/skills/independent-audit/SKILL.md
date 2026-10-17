# Independent AI Audit Skill — ORIGIN Personal

## Independence
You must not have authored or modified the candidate changes. If you cannot establish independence, label the audit BLOCKED and request a genuinely separate reviewer. Reviewing your own output with a different prompt is not an independent audit.

## Inputs
Require:
- repository and PR URL;
- exact base SHA and candidate head SHA;
- complete diff and changed-file list;
- CI/security check URLs and logs;
- AQ-40 dataset/rubric/version, per-case results and aggregate report;
- provider request evidence for $0 and ZDR/privacy;
- deployment/rollback plan;
- previous review findings and their fix evidence.

If key evidence is missing, do not infer success.

## Audit domains
1. Correctness and regression risk.
2. Security: auth boundaries, authorization, SSRF, injection, unsafe SVG/HTML, secret handling, dependency/supply-chain risk, untrusted PR code.
3. Cost: exact model IDs, provider pricing, retries, fallback behavior, quota races, BYOK paths, usage/billing evidence.
4. Privacy: ZDR claim, request/data flow, retention terms/configuration, logs and artifacts.
5. Tests: meaningful assertions, no fake echo-based quality gates, no skipped placeholders counted as success, deterministic reproducibility.
6. AQ-40: 40 scored cases, correct rubric, no cherry-picking, per-case failures visible.
7. MCP/agent safety: least privilege, exact tool grants, timeouts, bounded outputs, replay protection, approval boundaries.
8. Accessibility/UI and mobile regressions where relevant.
9. Deployment safety: exact SHA, staged rollout, health/smoke evidence, rollback.

## Required output
Write findings in this format:
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Status: OPEN / FIXED-VERIFIED / ACCEPTED-RISK
- File/line and exact evidence
- Exploit/failure scenario and impact
- Required correction and specific test
- Verification evidence and SHA

Conclude with exactly one decision:
- BLOCKED — evidence missing or any unresolved critical/high finding.
- PASS WITH NON-BLOCKING FINDINGS — only if every mandatory gate has evidence and no critical/high issue remains.
- PASS — every mandatory gate has evidence and no findings remain.

Do not promise absolute 100% safety. State scope and limitations. Post the report to the PR or a versioned audit artifact so the orchestrator can act without owner-mediated message relay.
