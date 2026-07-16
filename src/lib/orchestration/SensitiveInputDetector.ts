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

const ENGLISH_CREDENTIAL_TERM = String.raw`(?:api key|access key|client secret|private key|ssh key|password|passphrase|credential(?:s)?|bearer token|auth token|refresh token)`;
const ENGLISH_VALUE_CONTEXT = String.raw`(?:paste|pasted|include|included|contain|contains|containing|share|shared|send|sent|enter|entered|input|provide|provided|use|using|check|verify|reveal|expose|display|show|here(?:'s| is))`;
const ENGLISH_CREDENTIAL_CONTEXT = new RegExp(
  String.raw`(?:\b${ENGLISH_CREDENTIAL_TERM}\b.{0,32}\b${ENGLISH_VALUE_CONTEXT}\b|\b${ENGLISH_VALUE_CONTEXT}\b.{0,32}\b${ENGLISH_CREDENTIAL_TERM}\b)`,
  "i",
);

const JAPANESE_CREDENTIAL_TERM = String.raw`(?:APIキー|アクセスキー|クライアントシークレット|秘密鍵|SSHキー|パスワード|認証情報|アクセストークン|更新トークン)`;
const JAPANESE_VALUE_CONTEXT = String.raw`(?:貼り付け|含(?:む|み|まれ)|共有|送信|入力|記載|提供|渡(?:す|し)|使用|使(?:う|い|って)|確認|公開|表示|見せ|あります|です)`;
const JAPANESE_CREDENTIAL_CONTEXT = new RegExp(
  String.raw`(?:${JAPANESE_CREDENTIAL_TERM}.{0,24}${JAPANESE_VALUE_CONTEXT}|${JAPANESE_VALUE_CONTEXT}.{0,24}${JAPANESE_CREDENTIAL_TERM})`,
  "i",
);

export function detectSensitiveInput(input: string): SensitiveInputDetection {
  const kinds = new Set<SensitiveInputKind>();

  for (const entry of STRUCTURED_PATTERNS) {
    if (entry.pattern.test(input)) kinds.add(entry.kind);
  }

  if (ENGLISH_CREDENTIAL_CONTEXT.test(input) || JAPANESE_CREDENTIAL_CONTEXT.test(input)) {
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
