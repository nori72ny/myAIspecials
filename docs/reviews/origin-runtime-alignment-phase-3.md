# ORIGIN Runtime Alignment — Phase 3

Target: PR #45  
Tracking issue: #44  
Status: Draft, unmerged, undeployed

## Completed in this phase

### Provider-bound context minimization

- The complete submitted conversation is scanned for structured sensitive values before omission.
- Only a recent coherent window is sent to the provider.
- Default limits are 12 messages and 12,000 combined characters.
- Messages are never partially truncated.
- An oversized latest request is rejected and must be divided or summarized.
- Returned context evidence contains counts only, not omitted text.

### Provider routing and privacy enforcement

The execution plan requires:

- provider fallback disabled;
- provider data collection denied;
- a zero-data-retention endpoint;
- estimated cost exactly zero;
- reported actual cost exactly zero.

The OpenRouter request sets:

```json
{
  "provider": {
    "allow_fallbacks": false,
    "data_collection": "deny",
    "zdr": true
  }
}
```

If an endpoint cannot meet all requirements, execution must fail rather than weaken the policy.

### Actual-cost reconciliation

The provider response must contain a finite usage cost equal to zero.

- Missing or invalid cost: response is withheld as unverifiable.
- Cost greater than zero: response is discarded as a policy violation.
- A zero-cost result is returned only after the usage record confirms zero.

## Verification added

- no-fallback, data-deny, and ZDR request construction;
- rejection of plans that allow fallback or retention;
- rejection of missing cost;
- rejection of nonzero cost;
- coherent context-window selection;
- full-history secret scanning before context omission;
- oversized latest-request rejection;
- no upstream error-body disclosure.

## Evidence limitations

This branch uses synthetic inputs and mocked provider responses. It has not sent a live provider request and does not prove that an eligible live endpoint is currently available under all combined restrictions.

## Remaining audit blockers

- dedicated Personal Edition wording for oversized requests and unverifiable cost;
- removal of the shadowed legacy chat handler after regression confirmation;
- region-policy enforcement where reliable provider metadata is available;
- automatic independent review and synthesis;
- an exact final candidate audit by independent reviewers;
- real screen-reader verification.

No merge, deployment, DNS, billing, account, credential, or paid-service action is authorized.
