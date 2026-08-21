# P0/P1 Audit Remediation TODO

- [x] Add the required production security headers to vercel.json.
- [x] Add four explicit artifact action buttons for copy, save, share, and direct editing.
- [x] Add a sandbox runtime error boundary with last-known-good restoration.
- [x] Run lint, unit tests, API tests, E2E tests, GitHub main sync, and Vercel production deployment.
- [x] P1: Require postMessage events to originate from the active preview iframe contentWindow.
- [x] P1: Confirm last-known-good only after a sandbox clean-load notification with no runtime exception.
- [x] P1: Remove unsafe-eval and restrict connect-src in the top-level CSP configuration.
- [ ] P1: Run lint, unit, API, E2E, production build, GitHub main sync, and Vercel production header verification.
