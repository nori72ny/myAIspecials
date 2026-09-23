# AQ V2 trusted case leasing

The sealed 48-case corpus is never mounted or serialized into the candidate environment.

For each ordinal, the trusted host creates two records:

- **public lease**: exact candidate SHA, round id, case id, family, one prompt, prompt digest, ordinal and total case count;
- **trusted lease**: corpus digest and evaluator notes, retained outside candidate control.

The candidate receives one public lease at a time. It does not receive:
- the full corpus;
- evaluator notes;
- corpus digest;
- future prompts.

The trusted host binds the returned answer to the exact lease and records an answer digest, provider request count and verified USD 0 cost.

This module is intentionally transport-agnostic. The eventual live transport must use the trusted local proxy/network boundary rather than a normal unrestricted candidate server.
