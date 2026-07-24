const MAX_SOURCE_URL_LENGTH = 2_048;
const SENSITIVE_QUERY_NAMES = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "authorization",
  "auth",
  "credential",
  "key",
  "password",
  "secret",
  "signature",
  "token",
]);

function normalizedQueryName(value: string): string {
  return value.toLowerCase().replaceAll("-", "").replaceAll("_", "").replaceAll(".", "");
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;

  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;

  const [first, second, third] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 192 && second === 88 && third === 99)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".home")
    || normalized.endsWith(".lan")
    || normalized.startsWith("[")
    || normalized.endsWith("]")
    || !normalized.includes(".")
    || isBlockedIpv4(normalized);
}

export function normalizeOriginPublicHttpsUrl(value: string): string | null {
  if (value.length === 0 || value.length > MAX_SOURCE_URL_LENGTH) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || (url.port !== "" && url.port !== "443")
      || isBlockedHostname(url.hostname)
    ) return null;

    for (const queryName of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_NAMES.has(normalizedQueryName(queryName))) return null;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
