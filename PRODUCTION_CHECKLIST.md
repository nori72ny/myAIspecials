# PRODUCTION_CHECKLIST.md - Production Release Checklist

This checklist tracks the technical milestones required to authorize ACOS 2.0 RC2 for release.

---

## 📋 Production Release Checklist

| Checklist Category | Requirement Description | Status | Evidence / Measurement Source |
| :--- | :--- | :--- | :--- |
| **Build & Run** | Standard Express Server Bundles to CJS | **PASS** | `esbuild` completed with zero warnings: generated `dist/server.cjs` (292.6kB). |
| **TypeScript** | Strict compile check with zero errors | **PASS** | `tsc --noEmit` executed inside the standard linter task with exit code `0`. |
| **ESLint** | Code quality checks | **PASS** | Linter completed successfully with zero warnings or errors. |
| **Playwright E2E**| Complete user trace passes fully | **FAIL** | E2E task failed with Locator Visibility mismatch on "Mission Generator" (see `QA_REPORT.md`). |
| **A11y (WCAG)** | No high-severity violations | **NOT VERIFIED** | Automated accessibility suite *Not Measured* in the local sandbox. |
| **Performance** | Core bundle sizes under budget | **PASS** | Javascript bundle under 1.8MB raw. CSS under 205KB raw. |
| **Web Vitals** | LCP < 2.5s, CLS < 0.1 | **NOT VERIFIED** | Real-user browser vitals *Not Measured* in the local sandbox. |
| **Security** | Zero direct API keys on client | **PASS** | Verified that `GEMINI_API_KEY` remains server-side only in `server.ts`. |
| **Design Tokens** | Zero arbitrary design token leaks | **PASS** | AST token scanner validated zero arbitrary styling leaks on all checked files. |

---

## 🔮 Production Certification

* **Final Certification**: **FAIL**
* **Release Candidate**: **RC2 Rejected**
* **Reason**: The failing E2E automated flow prevents automated pipeline clearance. The candidate is held for minor E2E selector configuration adjustments before RC3 promotion can be evaluated.
