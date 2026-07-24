import { describe, expect, it } from "vitest";
import { normalizeOriginPublicHttpsUrl } from "./OriginPublicSourceUrl";

describe("normalizeOriginPublicHttpsUrl", () => {
  it("normalizes a public HTTPS URL and removes a client-only fragment", () => {
    expect(normalizeOriginPublicHttpsUrl(
      "https://docs.example.com:443/guide?section=one#details",
    )).toBe("https://docs.example.com/guide?section=one");
  });

  it.each([
    "http://example.com/guide",
    "https://user:secret@example.com/guide",
    "https://example.com:8443/guide",
    "https://localhost/guide",
    "https://service.internal/guide",
    "https://printer.local/guide",
    "https://127.0.0.1/guide",
    "https://10.0.0.1/guide",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/guide",
    "https://intranet/guide",
  ])("rejects a non-public or unsafe fetch target: %s", (url) => {
    expect(normalizeOriginPublicHttpsUrl(url)).toBeNull();
  });

  it.each([
    "https://example.com/guide?api_key=synthetic",
    "https://example.com/guide?access-token=synthetic",
    "https://example.com/guide?signature=synthetic",
  ])("rejects a URL carrying a secret-like query parameter: %s", (url) => {
    expect(normalizeOriginPublicHttpsUrl(url)).toBeNull();
  });
});
