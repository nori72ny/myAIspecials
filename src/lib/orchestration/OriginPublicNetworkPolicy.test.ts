import { describe, expect, it, vi } from "vitest";

import {
  isOriginPublicResolvedAddress,
  resolveOriginPublicNetworkTarget,
  type OriginDnsResolver,
} from "./OriginPublicNetworkPolicy";

describe("OriginPublicNetworkPolicy", () => {
  it("accepts only public resolved IPv4/IPv6 addresses", () => {
    expect(isOriginPublicResolvedAddress({ address: "93.184.216.34", family: 4 })).toBe(true);
    expect(isOriginPublicResolvedAddress({ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 })).toBe(true);

    for (const address of ["127.0.0.1","10.0.0.1","169.254.169.254","172.16.0.1","192.168.1.1","198.51.100.1","203.0.113.5","224.0.0.1"]) {
      expect(isOriginPublicResolvedAddress({ address, family: 4 })).toBe(false);
    }

    for (const address of ["::1","fc00::1","fd12::1","fe80::1","ff02::1","2001:db8::1"]) {
      expect(isOriginPublicResolvedAddress({ address, family: 6 })).toBe(false);
    }
  });

  it("fails closed when any DNS answer is non-public", async () => {
    const resolver: OriginDnsResolver = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(resolveOriginPublicNetworkTarget("https://example.com/docs", resolver)).resolves.toEqual({
      ok: false,
      code: "NON_PUBLIC_ADDRESS",
    });
  });

  it("rejects DNS failures and empty resolution", async () => {
    await expect(resolveOriginPublicNetworkTarget("https://example.com/docs", vi.fn().mockRejectedValue(new Error("dns failed"))))
      .resolves.toEqual({ ok: false, code: "DNS_RESOLUTION_FAILED" });
    await expect(resolveOriginPublicNetworkTarget("https://example.com/docs", vi.fn().mockResolvedValue([])))
      .resolves.toEqual({ ok: false, code: "NO_PUBLIC_ADDRESS" });
  });

  it("keeps the existing HTTPS and secret-query URL boundary", async () => {
    const resolver = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(resolveOriginPublicNetworkTarget("http://example.com", resolver)).resolves.toEqual({
      ok: false,
      code: "INVALID_PUBLIC_URL",
    });
    await expect(resolveOriginPublicNetworkTarget("https://example.com/?token=synthetic", resolver))
      .resolves.toEqual({ ok: false, code: "INVALID_PUBLIC_URL" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("returns a bounded immutable set of validated addresses", async () => {
    const resolver = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    const result = await resolveOriginPublicNetworkTarget("https://example.com/docs#fragment", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe("https://example.com/docs");
    expect(result.addresses).toHaveLength(2);
    expect(Object.isFrozen(result.addresses)).toBe(true);
    expect(Object.isFrozen(result.addresses[0])).toBe(true);
  });
});
