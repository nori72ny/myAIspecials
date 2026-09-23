# AQ V2 trusted case leasing

The sealed 48-case corpus is never mounted or serialized into the candidate environment.

For each ordinal, the trusted host creates two records:

- **candidate lease**: only an opaque lease id plus the single prompt required now;
- **trusted lease**: exact candidate SHA, round id, corpus digest, case id, family, prompt digest, ordinal, total-case count and evaluator notes.

The candidate does **not** receive:
- the full corpus;
- evaluator notes;
- corpus digest;
- case id;
- family/category;
- ordinal or total case count;
- candidate SHA / evaluation round metadata;
- future prompts.

This prevents the candidate from using evaluation-family metadata as an extra hint that reference systems do not receive.

The trusted host binds the returned answer to the exact trusted lease and records answer digest, provider request count and verified USD 0 cost.

This module is transport-agnostic. The eventual live transport must use the trusted local proxy/network boundary rather than a normal unrestricted candidate server.
