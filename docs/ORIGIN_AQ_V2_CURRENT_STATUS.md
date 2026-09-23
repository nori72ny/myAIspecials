# AQ V2 current status

Target release candidate for future scoring:
- PR #608
- exact current head: `ef8825f1b8f9580c37c6a7e286072f3e7caa0abb`

Evaluator infrastructure:
- PR #611
- AQ V2 adds absolute answer-experience scoring, sealed corpus handling, anonymized blind packets, fixed rubric, exact-SHA visual evidence and trusted-execution evidence.
- AQ V2 infrastructure itself does **not** claim the #608 answer quality is world-class.

Current known blockers before any "world-class candidate" label:
1. Sealed 48-case corpus has not been executed against #608.
2. Exact-SHA AQ V2 scored observations do not yet exist.
3. Blind comparison against >=3 reference systems and >=2 independent judges has not yet been run.
4. AQ V2 native visual evidence package has not yet been produced under the new gate.
5. Trusted execution evidence has not yet been produced for the AQ V2 sealed run.
6. Live provider execution must prove USD 0.

## Safe execution dependency

Do not run the sealed AQ V2 corpus through an untrusted candidate process with unrestricted host network/credential access.

AQ V2 execution should reuse the trusted-evaluator architecture established in PR #609:
- exact same-repository open PR head binding;
- trusted host owns the sealed corpus and provider credential;
- candidate receives only the prompt required for the current case, never the full corpus;
- provider credential remains outside candidate;
- candidate external network is blocked except trusted local proxy capabilities;
- sanitized logs/artifacts only;
- exact request budget;
- fail closed on leakage or unverifiable cost.

Until that boundary is trusted on `main`, AQ V2 live execution remains intentionally blocked.
