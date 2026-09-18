import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { normalizeOriginPublicHttpsUrl } from "./OriginPublicSourceUrl.js";

export interface OriginResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface OriginDnsResolver {
  (hostname: string): Promise<readonly OriginResolvedAddress[]>;
}

export type OriginPublicNetworkResolution =
  | { ok: true; url: string; hostname: string; addresses: readonly OriginResolvedAddress[] }
  | { ok: false; code: "INVALID_PUBLIC_URL" | "DNS_RESOLUTION_FAILED" | "NO_PUBLIC_ADDRESS" | "NON_PUBLIC_ADDRESS" };

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return true;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const [a,b,c] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function firstIpv6Hextet(address: string): number | null {
  const first = address.toLowerCase().split(":")[0];
  if (!/^[0-9a-f]{1,4}$/.test(first)) return first === "" ? 0 : null;
  return Number.parseInt(first, 16);
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;

  if (normalized.startsWith("::ffff:")) {
    const tail = normalized.slice("::ffff:".length);
    return isIP(tail) !== 4 || isBlockedIpv4(tail);
  }

  const first = firstIpv6Hextet(normalized);
  if (first === null) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (normalized.startsWith("2001:db8:") || normalized === "2001:db8::") return true;
  return false;
}

export function isOriginPublicResolvedAddress(address: OriginResolvedAddress): boolean {
  if (address.family === 4) return isIP(address.address) === 4 && !isBlockedIpv4(address.address);
  if (address.family === 6) return isIP(address.address) === 6 && !isBlockedIpv6(address.address);
  return false;
}

async function defaultResolver(hostname: string): Promise<readonly OriginResolvedAddress[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records
    .filter((record): record is { address: string; family: 4 | 6 } => record.family === 4 || record.family === 6)
    .map((record) => ({ address: record.address, family: record.family }));
}

export async function resolveOriginPublicNetworkTarget(
  rawUrl: string,
  resolver: OriginDnsResolver = defaultResolver,
): Promise<OriginPublicNetworkResolution> {
  const normalized = normalizeOriginPublicHttpsUrl(rawUrl);
  if (!normalized) return { ok: false, code: "INVALID_PUBLIC_URL" };

  const url = new URL(normalized);
  let addresses: readonly OriginResolvedAddress[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    return { ok: false, code: "DNS_RESOLUTION_FAILED" };
  }

  if (addresses.length === 0) return { ok: false, code: "NO_PUBLIC_ADDRESS" };
  if (addresses.some((address) => !isOriginPublicResolvedAddress(address))) {
    return { ok: false, code: "NON_PUBLIC_ADDRESS" };
  }

  const unique = Array.from(
    new Map(addresses.map((address) => [`${address.family}:${address.address}`, address])).values(),
  );

  return {
    ok: true,
    url: normalized,
    hostname: url.hostname,
    addresses: Object.freeze(unique.map((address) => Object.freeze({ ...address }))),
  };
}
