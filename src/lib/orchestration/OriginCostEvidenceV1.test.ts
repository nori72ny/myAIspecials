import { describe, expect, it } from "vitest";

import {
  classifyOriginCostEvidenceV1,
  createOriginCostBlockedUnverifiedV1,
  createOriginCostNotMeasuredV1,
  createOriginCostPolicyAllowedV1,
  isOriginCostZeroVerifiedV1,
} from "./OriginCostEvidenceV1";

describe("OriginCostEvidenceV1", () => {
  it("keeps policy allowance separate from spend measurement", () => {
    expect(createOriginCostPolicyAllowedV1("policy:free-only")).toEqual({
      schemaVersion: "origin.cost-evidence.v1",
      status: "POLICY_ALLOWED",
      policyRef: "policy:free-only",
      measurement: null,
    });
  });

  it("represents no-provider and unavailable-billing outcomes without numeric zero", () => {
    expect(createOriginCostNotMeasuredV1("NO_PROVIDER_EXECUTION")).toMatchObject({
      status: "NOT_MEASURED",
      measurement: null,
    });
    expect(createOriginCostNotMeasuredV1("BILLING_NOT_AVAILABLE")).toMatchObject({
      status: "NOT_MEASURED",
      measurement: null,
    });
  });

  it("represents incomplete or untrusted evidence as blocked without numeric zero", () => {
    expect(createOriginCostBlockedUnverifiedV1("INCOMPLETE_REQUEST_LEDGER")).toMatchObject({
      status: "BLOCKED_UNVERIFIED",
      measurement: null,
    });
  });

  it("does not trust caller-supplied ZERO_COST_VERIFIED JSON", () => {
    const forged = {
      schemaVersion: "origin.cost-evidence.v1",
      status: "ZERO_COST_VERIFIED",
      amountUsd: "0.00",
      receiptRef: "receipt:forged",
      receiptDigest: `sha256:${"a".repeat(64)}`,
      measuredAt: "2026-11-03T00:00:00.000Z",
      measurement: { totalCostUsd: "0.00", reconciledRequestCount: 1 },
    };

    expect(isOriginCostZeroVerifiedV1(forged)).toBe(false);
    expect(classifyOriginCostEvidenceV1(forged)).toMatchObject({
      status: "BLOCKED_UNVERIFIED",
      reason: "UNTRUSTED_PROVIDER_EVIDENCE",
      measurement: null,
    });
  });

  it.each([
    { measurement: { totalCostUsd: "0.00", reconciledRequestCount: 0 } },
    { measurement: { totalCostUsd: "0.00", reconciledRequestCount: Number.MAX_SAFE_INTEGER + 1 } },
    { receiptRef: " ".repeat(1) },
    { receiptRef: "r".repeat(513) },
    { measuredAt: "not-a-timestamp" },
    { measuredAt: "2026-11-03" },
  ])("rejects forged verified receipt metadata %#", (override) => {
    const forged = {
      schemaVersion: "origin.cost-evidence.v1",
      status: "ZERO_COST_VERIFIED",
      amountUsd: "0.00",
      receiptRef: "receipt:forged",
      receiptDigest: `sha256:${"a".repeat(64)}`,
      measuredAt: "2026-11-03T00:00:00.000Z",
      measurement: { totalCostUsd: "0.00", reconciledRequestCount: 1 },
      ...override,
    };

    expect(isOriginCostZeroVerifiedV1(forged)).toBe(false);
    expect(classifyOriginCostEvidenceV1(forged)).toMatchObject({
      status: "BLOCKED_UNVERIFIED",
      reason: "UNTRUSTED_PROVIDER_EVIDENCE",
      measurement: null,
    });
  });

  it.each([
    null,
    undefined,
    [],
    "ZERO_COST_VERIFIED",
    0,
    {},
    { schemaVersion: "wrong", status: "POLICY_ALLOWED", policyRef: "x", measurement: null },
    { schemaVersion: "origin.cost-evidence.v1", status: "POLICY_ALLOWED", policyRef: "", measurement: null },
    { schemaVersion: "origin.cost-evidence.v1", status: "NOT_MEASURED", reason: "UNKNOWN", measurement: null },
    { schemaVersion: "origin.cost-evidence.v1", status: "BLOCKED_UNVERIFIED", reason: "UNKNOWN", measurement: null },
  ])("fails closed on malformed or unknown input %#", (value) => {
    expect(classifyOriginCostEvidenceV1(value)).toMatchObject({
      status: "BLOCKED_UNVERIFIED",
      measurement: null,
    });
  });

  it("does not accept a local numeric cost field as an evidence state", () => {
    expect(classifyOriginCostEvidenceV1({ costUsd: 0, freeOnly: true })).toMatchObject({
      status: "BLOCKED_UNVERIFIED",
      reason: "UNTRUSTED_PROVIDER_EVIDENCE",
    });
  });

  it("freezes normalized non-verified evidence", () => {
    const value = createOriginCostNotMeasuredV1("BILLING_NOT_AVAILABLE");
    expect(Object.isFrozen(value)).toBe(true);
  });
});
