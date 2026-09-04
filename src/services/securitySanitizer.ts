const PBKDF2_ITERATIONS = 600_000;
const DERIVED_KEY_BITS = 256;
const MIN_ENTROPY_LENGTH = 16;
const MIN_SHANNON_ENTROPY = 4.5;
const REDACTION = "[REDACTED_SECRET]";

/**
 * Derives a non-extractable AES-GCM-256 key for local/server-side protected
 * material. The salt must be application-specific and non-secret.
 */
export async function deriveSanitizerKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  if (!secret || salt.byteLength < 16) throw new Error("Sanitizer key material and a 128-bit salt are required.");
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: DERIVED_KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:entication)?|password|passwd|secret|private[_-]?key)\s*[:=]\s*["']?[^\s"'`,;]+/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
];

function maskHighEntropyTokens(value: string): string {
  return value.replace(/\S+/g, (token) => {
    const candidate = token.replace(/^[({[<]+|[\])}>.,;:]+$/g, "");
    if (candidate.length < MIN_ENTROPY_LENGTH || shannonEntropy(candidate) <= MIN_SHANNON_ENTROPY) return token;
    // Natural-language CJK tokens are high-entropy under character-frequency
    // heuristics but are not useful secret candidates. Explicit secret patterns
    // above still redact credential-shaped CJK-adjacent values before this pass.
    if ((candidate.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length >= 2) return token;
    return token.replace(candidate, REDACTION);
  });
}

/**
 * Fail-closed pre-egress sanitizer. It is intentionally deterministic and
 * synchronous so every provider payload can pass through it immediately
 * before JSON serialization/fetch. It never logs or returns the original
 * secret when a rule matches.
 */
export function sanitizePreEgress(value: string): string {
  if (typeof value !== "string") throw new TypeError("Pre-egress sanitizer expects text.");
  let sanitized = value;
  for (const pattern of SECRET_PATTERNS) sanitized = sanitized.replace(pattern, REDACTION);
  return maskHighEntropyTokens(sanitized);
}

export function sanitizePreEgressPayload<T>(payload: T): T {
  if (typeof payload === "string") return sanitizePreEgress(payload) as T;
  if (Array.isArray(payload)) return payload.map((item) => sanitizePreEgressPayload(item)) as T;
  if (payload && typeof payload === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(payload as Record<string, unknown>)) {
      if (/^(?:api[_-]?key|password|passwd|secret|token|authorization|private[_-]?key)$/i.test(key)) {
        output[key] = REDACTION;
      } else {
        output[key] = sanitizePreEgressPayload(item);
      }
    }
    return output as T;
  }
  return payload;
}
