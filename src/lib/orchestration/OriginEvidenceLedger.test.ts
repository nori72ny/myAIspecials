import { describe, expect, it } from "vitest";

import {
  appendOriginEvidence,
  createOriginEvidenceLedger,
  type OriginEvidenceLedgerEntryInput,
} from "./OriginEvidenceLedger";

const base: OriginEvidenceLedgerEntryInput = {
  id: "ev-1",
  sourceKind: "retrieved-public",
  observedAt: "2026-09-18T08:00:00.000Z",
  label: "Official documentation",
  sourceUrl: "https://example.com/docs",
  sourceRef: "search-result-1",
  claimIds: ["claim-1"],
  verificationState: "source-checked",
  costUsd: 0,
  detail: "Retrieved public source.",
};

describe("OriginEvidenceLedger", () => {
  it("creates an immutable bounded ledger and reconciles total cost", () => {
    const result = createOriginEvidenceLedger([base]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.schemaVersion).toBe("origin.evidence-ledger.v1");
    expect(result.value.totalCostUsd).toBe(0);
    expect(result.value.entries).toEqual([
      expect.objectContaining({
        id: "ev-1",
        sourceUrl: "https://example.com/docs",
        claimIds: ["claim-1"],
      }),
    ]);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.entries)).toBe(true);
    expect(Object.isFrozen(result.value.entries[0])).toBe(true);
  });

  it("appends by creating a new ledger instead of mutating prior evidence", () => {
    const initial = createOriginEvidenceLedger([base]);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    const next = appendOriginEvidence(initial.value, {
      ...base,
      id: "ev-2",
      sourceKind: "deterministic-tool",
      sourceUrl: undefined,
      sourceRef: "calculator-run-2",
      claimIds: ["claim-2"],
      verificationState: "verified",
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;

    expect(initial.value.entries).toHaveLength(1);
    expect(next.value.entries).toHaveLength(2);
  });

  it("rejects duplicate IDs and malformed claim IDs", () => {
    expect(createOriginEvidenceLedger([base, base]).ok).toBe(false);
    expect(createOriginEvidenceLedger([{ ...base, claimIds: ["bad claim id"] }]).ok).toBe(false);
  });

  it("requires a sanitized public HTTPS URL for retrieved-public evidence", () => {
    expect(createOriginEvidenceLedger([{ ...base, sourceUrl: undefined }]).ok).toBe(false);
    expect(createOriginEvidenceLedger([{ ...base, sourceUrl: "http://example.com/docs" }]).ok).toBe(false);
    expect(createOriginEvidenceLedger([{ ...base, sourceUrl: "https://localhost/docs" }]).ok).toBe(false);
    expect(createOriginEvidenceLedger([{ ...base, sourceUrl: "https://example.com/docs?token=secret" }]).ok).toBe(false);
  });

  it("does not expose private connected evidence as a public URL", () => {
    const result = createOriginEvidenceLedger([{
      ...base,
      sourceKind: "connected-private",
      sourceUrl: "https://example.com/private",
      sourceRef: "private-file-123",
    }]);
    expect(result.ok).toBe(false);
  });

  it("rejects secret-like labels, detail and refs", () => {
    expect(createOriginEvidenceLedger([{
      ...base,
      label: "Authorization: Bearer synthetic_token_value_123456",
    }]).ok).toBe(false);
    expect(createOriginEvidenceLedger([{
      ...base,
      detail: ["api_key", "synthetic_secret_123456"].join("="),
    }]).ok).toBe(false);
    expect(createOriginEvidenceLedger([{
      ...base,
      sourceRef: "Authorization: Bearer synthetic_token_value_123456",
    }]).ok).toBe(false);
  });

  it("rejects negative or non-finite cost", () => {
    expect(createOriginEvidenceLedger([{ ...base, costUsd: -1 }]).ok).toBe(false);
    expect(createOriginEvidenceLedger([{ ...base, costUsd: Number.NaN }]).ok).toBe(false);
  });

  it("keeps provider output distinct from independently retrieved evidence", () => {
    const result = createOriginEvidenceLedger([{
      ...base,
      sourceKind: "provider-output",
      sourceUrl: undefined,
      sourceRef: "provider-response-1",
      verificationState: "unverified",
    }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0].sourceKind).toBe("provider-output");
    expect(result.value.entries[0].verificationState).toBe("unverified");
  });
});
