export type SensitiveInputKind =
  | "authorization-header"
  | "pem-private-key"
  | "provider-key"
  | "email-address"
  | "phone-number"
  | "payment-card"
  | "government-id"
  | "financial-account"
  | "postal-address"
  | "medical-information"
  | "personal-data-context"
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
  { kind: "provider-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "provider-key", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { kind: "provider-key", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { kind: "provider-key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { kind: "provider-key", pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { kind: "provider-key", pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/ },
  { kind: "provider-key", pattern: /\b(?:api[_ -]?key|access[_ -]?key|client[_ -]?secret|private[_ -]?key)\s*[:=]\s*[^\s,;]{6,}/i },
  { kind: "provider-key", pattern: /\b(?:jwt|oauth|bearer)\s*[:=]\s*[^\s,;]{8,}/i },
  { kind: "email-address", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/i },
  { kind: "phone-number", pattern: /(?:^|[^\d])(?:\+?81[-\s]?(?:0)?|0)(?:[1-9]\d?[-\s]?\d{2,4}[-\s]?\d{3,4}|[789]0[-\s]?\d{4}[-\s]?\d{4})(?!\d)/ },
  { kind: "payment-card", pattern: /(?:^|\D)(?:\d[ -]?){13,19}(?!\d)/ },
  { kind: "government-id", pattern: /(?:マイナンバー|個人番号|運転免許証番号|旅券番号|パスポート番号|social security number|\bSSN\b)\s*[:：=]?\s*[A-Z0-9-]{6,}/i },
  { kind: "financial-account", pattern: /(?:口座番号|銀行口座|routing number|bank account)\s*[:：=]?\s*[A-Z0-9-]{4,}/i },
  { kind: "postal-address", pattern: /(?:住所|自宅|所在地|home address|postal address)\s*[:：=]\s*\S.{2,}/i },
  { kind: "medical-information", pattern: /(?:病歴|診断名|診断結果|服薬情報|カルテ|medical record|medical history|diagnosis)\s*[:：=]\s*\S.{1,}/i },
];

const ENGLISH_CREDENTIAL_TERM = String.raw`(?:api key|access key|client secret|private key|ssh key|password|passphrase|credential(?:s)?|bearer token|auth token|refresh token)`;
const ENGLISH_VALUE_CONTEXT = String.raw`(?:paste|pasted|include|included|contain|contains|containing|share|shared|send|sent|enter|entered|input|provide|provided|use|using|check|verify|reveal|expose|display|show|here(?:'s| is))`;
const ENGLISH_CREDENTIAL_CONTEXT = new RegExp(
  String.raw`(?:\b${ENGLISH_CREDENTIAL_TERM}\b.{0,32}\b${ENGLISH_VALUE_CONTEXT}\b|\b${ENGLISH_VALUE_CONTEXT}\b.{0,32}\b${ENGLISH_CREDENTIAL_TERM}\b)`,
  "i",
);

const JAPANESE_CREDENTIAL_TERM = String.raw`(?:APIキー|アクセスキー|クライアントシークレット|秘密鍵|SSHキー|パスワード|認証情報|アクセストークン|更新トークン)`;
const JAPANESE_VALUE_CONTEXT = String.raw`(?:貼り付け|含(?:む|み|まれ)|共有|送信|入力|記載|提供|渡(?:す|し)|使用|使(?:う|い|って)|確認|表示|見せ)`;
const JAPANESE_CREDENTIAL_CONTEXT = new RegExp(
  String.raw`(?:${JAPANESE_CREDENTIAL_TERM}.{0,24}${JAPANESE_VALUE_CONTEXT}|${JAPANESE_VALUE_CONTEXT}.{0,24}${JAPANESE_CREDENTIAL_TERM})`,
  "i",
);

const PERSONAL_DATA_CONTEXT = /(?:私|本人|顧客|社員|患者|my|customer|employee|patient)(?:の|\s+)(?:氏名|名前|生年月日|誕生日|住所|電話番号|メールアドレス|口座番号|病歴|診断|full name|name|date of birth|birthday|address|phone(?: number)?|email|bank account|medical history|diagnosis)\s*[:：=]?[\s\S]{0,48}(?:です|は|[A-Z0-9ぁ-んァ-ヶ一-龠])/i;
const INVISIBLE_FORMAT_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g;

export function canonicalizeSensitiveInput(input: string): string {
  return input.normalize("NFKC").replace(INVISIBLE_FORMAT_CHARACTERS, "");
}

export function detectSensitiveInput(input: string): SensitiveInputDetection {
  const kinds = new Set<SensitiveInputKind>();
  const canonicalInput = canonicalizeSensitiveInput(input);

  for (const entry of STRUCTURED_PATTERNS) {
    if (entry.pattern.test(canonicalInput)) kinds.add(entry.kind);
  }

  if (ENGLISH_CREDENTIAL_CONTEXT.test(canonicalInput) || JAPANESE_CREDENTIAL_CONTEXT.test(canonicalInput)) {
    kinds.add("credential-term");
  }
  if (PERSONAL_DATA_CONTEXT.test(canonicalInput)) kinds.add("personal-data-context");

  return { containsSensitiveInput: kinds.size > 0, kinds: Array.from(kinds) };
}

export function containsSensitiveInput(input: string): boolean {
  return detectSensitiveInput(input).containsSensitiveInput;
}
