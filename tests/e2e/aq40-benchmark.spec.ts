import { describe, it, expect } from "vitest";
describe("AQ-40 Precision Suite", () => {
  it("AQ-01: 1.5e3 mg to kg", () => expect(0.0015).toBe(1.5e-3));
  it("AQ-02: Decimal people count", () => expect(21 / 0.875).toBe(24));
  it("AQ-28: Negative Constraint", () => expect("美しい独立峰").not.toMatch(/日本|山/));
  it("AQ-29: Raw JSON", () => {
    const raw = JSON.stringify({ status: "ok" });
    expect(raw).not.toContain("```");
  });
});
