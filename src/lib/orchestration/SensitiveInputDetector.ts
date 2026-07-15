export type SensitiveInputKind =
  | "authorization-header"
  | "pem-private-key"
  | "provider-key"
  | "credential-term";

export interface SensitiveInputDetection {
  containsSensitiveInput: boolean;
  kinds: readonly SensitiveInputKind[];
}

interface SensitivePattern {
  kind: SensitiveInputKind;
  pattern: RegExp;
}

const STRUCTURED_PATTERNS: readonly SensitivePattern[] = [
  { kind: "authorization-header", pattern: /\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/i },
  { kind: "pem-private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { kind: "provider-key", pattern: /\bsk-[a-z0-9_-]{12,}\b/i },
  { kind: "provider-key", pattern: /\b(?:api[_ -]?key|access[_ -]?key|client[_ -]?secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{6,}/i },
  { kind: "provider-key", pattern: /\b(?:jwt|oauth|bearer)\s*[:=]\s*[^\s,;]{8,}/i },
];

const ENGLISH_CREDENTIAL_TERMS = /\b(?:api key|access key|client secret|private key|ssh key|password|passphrase|credential(?:s)?|bearer token|auth token|refresh token)\b/i;
const JAPANESE_CREDENTIAL_TERMS = /(?:APIキー|アクセスキー|クライアントシークレット|秘密鍵|SSHキー|パスワード|認証情報|アクセストークン|更新トークン)/i;

export function detectSensitiveInput(input: string): SensitiveInputDetection {
  const kinds = new Set<SensitiveInputKind>();

  for (const entry of STRUCTURED_PATTERNS) {
    if (entry.pattern.test(input)) kinds.add(entry.kind);
  }

  if (ENGLISH_CREDENTIAL_TERMS.test(input) || JAPANESE_CREDENTIAL_TERMS.test(input)) {
    kinds.add("credential-term");
  }

  return {
    containsSensitiveInput: kinds.size > 0,
    kinds: Array.from(kinds),
  };
}

export function containsSensitiveInput(input: string): boolean {
  return detectSensitiveInput(input).containsSensitiveInput;
}
