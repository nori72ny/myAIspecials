import { describe, expect, it } from "vitest";
import { extractProvidedOriginEvidence } from "./OriginAnswerEvidence";

describe("extractProvidedOriginEvidence", () => {
  it("extracts unique HTTPS markdown links as provider-supplied evidence", () => {
    expect(extractProvidedOriginEvidence(
      "根拠は[公式資料](https://example.com/docs)です。重複は[同じ資料](https://example.com/docs)。",
    )).toEqual([{
      label: "公式資料",
      sourceUrl: "https://example.com/docs",
      evidenceLevel: "provided",
      checks: {
        safeUrl: "passed",
        content: "not-run",
        freshness: "not-run",
        claimSupport: "not-run",
      },
    }]);
  });

  it("rejects non-HTTPS, credential-bearing, and malformed links", () => {
    expect(extractProvidedOriginEvidence([
      "[HTTP](http://example.com)",
      "[認証情報](https://user:pass@example.com/private)",
      "[不正](javascript:alert(1))",
    ].join(" "))).toEqual([]);
  });

  it("rejects local/private targets and secret-bearing query parameters", () => {
    expect(extractProvidedOriginEvidence([
      "[localhost](https://localhost/source)",
      "[private IP](https://10.0.0.1/source)",
      "[metadata](https://169.254.169.254/latest/meta-data)",
      "[secret query](https://example.com/source?api_key=synthetic)",
    ].join(" "))).toEqual([]);
  });

  it("rejects empty, multiline, and oversized labels", () => {
    expect(extractProvidedOriginEvidence([
      "[](https://example.com/empty)",
      "[改行\nラベル](https://example.com/newline)",
      `[${"長".repeat(201)}](https://example.com/long)`,
    ].join(" "))).toEqual([]);
  });

  it("caps extracted evidence without backtracking over long input", () => {
    const links = Array.from(
      { length: 20 },
      (_, index) => `[資料${index}](https://example.com/${index})`,
    ).join(" ");
    const result = extractProvidedOriginEvidence(`${"x".repeat(20_000)}${links}`);

    expect(result).toHaveLength(10);
    expect(result[0].label).toBe("資料0");
    expect(result[9].label).toBe("資料9");
  });
});
