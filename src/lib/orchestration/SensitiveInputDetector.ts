export type SensitiveInputKind =
  | "authorization-header"
  | "pem-private-key"
  | "provider-key"
  | "credential-term";

export interface SensitiveInputDetection {
  containsSensitiveInput: boolean;
  kinds: readonly SensitiveInputKind[];
}

const STRUCTURED_PATTERNS: readonly [SensitiveInputKind, RegExp][] = [
  ["authorization-header", /\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/i],
  ["pem-private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ["provider-key", /\bsk-[a-z0-9_-]{12,}\b/i],
  ["provider-key", /\b(?:api[_ -]?key|access[_ -]?key|client[_ -]?secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{6,}/i],
  ["provider-key", /\b(?:jwt|oauth|bearer)\s*[:=]\s*[^\s,;]{8,}/i],
];

const ENGLISH_CREDENTIAL_TERMS = /\b(?:api key|access key|client secret|private key|ssh key|password|passphrase|credential(?:s)?|bearer token|auth token|refresh token)\b/i;
const JAPANESE_CREDENTIAL_TERMS = /(?:APIキー|アクセスキー|クライアントシークレット|秘密鍵|SSHキー|パスワード|認証情報|アクセストークン|更新トークン)/i;

export function detectSensitiveInput(input: string): SensitiveInputDetection {
  const kinds = new Set<SensitiveInputKind>();

  for (const [kind, pattern] of STRUCTURED_PATTERNS) {
    if (pattern.test(input)) kinds.add(kind);
  }

  if (ENGLISH_CREDENTIAL_TERMS.test(input) || JAPANESE_CREDENTIAL_TERMS.test(input)) {
    kinds.add("credential-term");
  }

  return {
    containsSensitiveInput: kinds.size > 0,
    kinds: [...kinds],
  };
}

export function containsSensitiveInput(input: string): boolean {
  return detectSensitiveInput(input).containsSensitiveInput;
}
