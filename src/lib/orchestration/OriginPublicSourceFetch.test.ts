import { describe, expect, it, vi } from "vitest";

import { fetchOriginPublicSource, type OriginPinnedFetchTransport } from "./OriginPublicSourceFetch";

const resolver = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

describe("OriginPublicSourceFetch", () => {
  it("passes only the validated DNS address to the fetch transport", async () => {
    const transport: OriginPinnedFetchTransport = vi.fn().mockResolvedValue({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Buffer.from("<html>verified source</html>"),
    });

    const result = await fetchOriginPublicSource("https://example.com/docs", {
      resolver,
      transport,
      now: () => Date.parse("2026-09-18T10:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(transport).toHaveBeenCalledWith(
      "https://example.com/docs",
      { address: "93.184.216.34", family: 4 },
      8_000,
      512 * 1024,
    );
    if (!result.ok) return;
    expect(result.value.networkPolicy).toEqual({
      publicAddressOnly: true,
      redirectsFollowed: false,
      dnsPinned: true,
    });
    expect(result.value.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.value.body).toContain("verified source");
  });

  it("never calls transport when DNS resolution includes a private target", async () => {
    const privateResolver = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const transport = vi.fn();

    await expect(fetchOriginPublicSource("https://example.com/docs", {
      resolver: privateResolver,
      transport,
    })).resolves.toEqual({ ok: false, code: "PUBLIC_SOURCE_NETWORK_REJECTED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects redirects, non-200 responses, unsupported types and oversized bodies", async () => {
    await expect(fetchOriginPublicSource("https://example.com/docs", {
      resolver,
      transport: vi.fn().mockResolvedValue({
        status: 302,
        headers: { location: "https://other.example.com/" },
        body: Buffer.alloc(0),
      }),
    })).resolves.toEqual({ ok: false, code: "PUBLIC_SOURCE_REDIRECT_REJECTED" });

    await expect(fetchOriginPublicSource("https://example.com/docs", {
      resolver,
      transport: vi.fn().mockResolvedValue({
        status: 404,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("not found"),
      }),
    })).resolves.toEqual({ ok: false, code: "PUBLIC_SOURCE_HTTP_STATUS_REJECTED" });

    await expect(fetchOriginPublicSource("https://example.com/docs", {
      resolver,
      transport: vi.fn().mockResolvedValue({
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: Buffer.from("binary"),
      }),
    })).resolves.toEqual({ ok: false, code: "PUBLIC_SOURCE_CONTENT_TYPE_REJECTED" });

    await expect(fetchOriginPublicSource("https://example.com/docs", {
      resolver,
      maxBytes: 1024,
      transport: vi.fn().mockResolvedValue({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.alloc(1025),
      }),
    })).resolves.toEqual({ ok: false, code: "PUBLIC_SOURCE_TOO_LARGE" });
  });

  it("fails closed on transport errors and invalid fetch budgets", async () => {
    await expect(fetchOriginPublicSource("https://example.com/docs", {
      resolver,
      transport: vi.fn().mockRejectedValue(new Error("network failure")),
    })).resolves.toEqual({ ok: false, code: "PUBLIC_SOURCE_FETCH_FAILED" });

    await expect(fetchOriginPublicSource("https://example.com/docs", {
      resolver,
      timeoutMs: 60_000,
    })).resolves.toEqual({ ok: false, code: "PUBLIC_SOURCE_FETCH_FAILED" });
  });
});
