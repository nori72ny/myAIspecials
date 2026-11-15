// ---------------------------------------------------------------------------
// Pre-save guard for personal memory (Personalization Stage 1, PR P1-2).
//
// Implements the deterministic checks of PERSONALIZATION_STAGE1_DESIGN
// §9.2 / §5.3: before a profile item or an extracted memory item is stored,
// its text passes through these patterns, and anything that matches is not
// stored. The checks are pattern-only (no model judgment, no network) and
// are aligned with the server-side SensitiveInputDetector categories where
// they overlap (credentials, payment cards, phone numbers, government ids,
// financial accounts, structured postal addresses, medical details).
//
// Stage-2 data (birth dates, phone numbers) and permanently excluded data
// (card numbers, PINs, passwords) must never enter the stage-1 store. This
// guard is the storage-side layer; the extraction rules additionally
// exclude stage-2 topics at the rule level (design §3.3), so a value has
// to pass both layers to be memorized. Patterns cannot catch everything
// (design §9.1); the store stays on-device and encrypted regardless.
// ---------------------------------------------------------------------------

export type PersonalMemoryBlockCategory =
  | 'credential'
  | 'payment-card'
  | 'phone-number'
  | 'email-address'
  | 'date-of-birth'
  | 'pin-code'
  | 'government-id'
  | 'financial-account'
  | 'postal-address'
  | 'medical-information';

export interface PersonalMemoryGuardResult {
  blocked: boolean;
  categories: PersonalMemoryBlockCategory[];
}

const INVISIBLE_FORMAT_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Same canonicalization as the server-side detector: NFKC (so full-width
 * digits become ASCII) with invisible format characters removed. */
export function canonicalizePersonalMemoryText(input: string): string {
  return input.normalize('NFKC').replace(INVISIBLE_FORMAT_CHARACTERS, '');
}

// Credentials: the legacy ingestion SENSITIVE_MARKERS, extended with the
// provider key shapes the server detector recognizes. Passwords and keys
// are permanently out of scope for memory (design §3.3: the topic itself
// is not memorized), so the Japanese terms block on the term alone.
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /api[_ -]?key/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /token/i,
  /authorization\s*:\s*bearer/i,
  /-----begin (?:rsa |ec |openssh )?private key-----/i,
  /\bsk-[a-z0-9_-]{12,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /パスワード/,
  /APIキー|アクセスキー|アクセストークン|秘密鍵|認証情報|クライアントシークレット/,
];

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/i;

// Japanese phone numbers (same shape as the server detector): landline
// 0X-XXXX-XXXX style groupings and 070/080/090 mobile numbers, contiguous
// or separated, with an optional +81 country code.
const PHONE_PATTERN = /(?:^|[^\d])(?:\+?81[-\s]?(?:0)?|0)(?:[1-9]\d?[-\s]?\d{2,4}[-\s]?\d{3,4}|[789]0[-\s]?\d{4}[-\s]?\d{4})(?!\d)/;
const PHONE_PATTERN_GLOBAL = new RegExp(PHONE_PATTERN.source, 'g');

// A date of birth is blocked only when a date value and a birth-related
// term appear together (design §9.2), or the text states a birth year
// directly ("1990年生まれ"). A bare deadline or anniversary date is fine.
const DOB_TERMS = /(?:生年月日|誕生日|date of birth|birthday|\bDOB\b)/i;
const DOB_FULL_DATE = /(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?:昭和|平成|令和)\s*\d{1,2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/;
const DOB_MONTH_DAY = /\d{1,2}\s*月\s*\d{1,2}\s*日/;
const DOB_YEAR = /\d{4}\s*年/;
const BIRTH_YEAR_STATEMENT = /(?:\d{4}\s*年|(?:昭和|平成|令和)\s*\d{1,2}\s*年)\s*生まれ/;

// A PIN is blocked when a PIN-suggesting term and a 4-8 digit value appear
// together (design §9.2). The term alone carries no value to protect here;
// the extraction rules exclude the topic itself.
const PIN_TERMS = /(?:暗証番号|暗証コード|パスコード|PINコード|\bPIN\b)/i;
const PIN_VALUE = /(?:^|\D)\d{4,8}(?!\d)/;

const GOVERNMENT_ID_PATTERN = /(?:マイナンバー|個人番号|運転免許証番号|免許証番号|旅券番号|パスポート番号|年金番号|基礎年金番号|被保険者番号|social security number|\bSSN\b)(?:\s*は|\s*が|\s*[:：=])?\s*[A-Z0-9-]{6,}/i;
const FINANCIAL_ACCOUNT_PATTERN = /(?:口座番号|銀行口座|支店番号|bank account|routing number)(?:\s*は|\s*が|\s*[:：=])?\s*[A-Z0-9-]{4,}/i;
const POSTAL_ADDRESS_PATTERN = /(?:住所|自宅|所在地|home address|postal address)\s*[:：]\s*\S.{2,}/i;
const POSTAL_CODE_PATTERN = /(?:〒\s*\d{3}-\d{4}|郵便番号(?:\s*は|\s*[:：])?\s*〒?\s*\d{3}-\d{4})/;
const MEDICAL_INFORMATION_PATTERN = /(?:病歴|診断名|診断結果|服薬情報|カルテ|medical record|medical history|diagnosis)\s*[:：=]\s*\S.{1,}/i;

function hasPaymentCardSequence(textWithoutPhones: string): boolean {
  // Maximal runs of digits joined by single spaces or hyphens; a card
  // number is 13-19 digits (design §9.2). Phone spans are removed by the
  // caller first: a +81 mobile number also totals 13 digits and must be
  // reported as a phone number, not a card.
  const runs = textWithoutPhones.match(/\d(?:[ -]?\d)*/g) ?? [];
  for (const run of runs) {
    const digitCount = run.replace(/\D/g, '').length;
    if (digitCount >= 13 && digitCount <= 19) return true;
  }
  return false;
}

function hasDateOfBirth(text: string): boolean {
  if (BIRTH_YEAR_STATEMENT.test(text)) return true;
  if (!DOB_TERMS.test(text)) return false;
  return DOB_FULL_DATE.test(text) || DOB_MONTH_DAY.test(text) || DOB_YEAR.test(text);
}

/**
 * Deterministic pre-save check shared by profile saves and memory
 * extraction (design §5.3). Returns every matched category so callers can
 * surface a reason; `blocked` is true when at least one category matched.
 */
export function checkPersonalMemoryText(value: string): PersonalMemoryGuardResult {
  const categories = new Set<PersonalMemoryBlockCategory>();
  if (typeof value !== 'string' || !value) return { blocked: false, categories: [] };
  const text = canonicalizePersonalMemoryText(value);

  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) categories.add('credential');
  if (EMAIL_PATTERN.test(text)) categories.add('email-address');

  const phoneMatches = text.match(PHONE_PATTERN_GLOBAL);
  if (phoneMatches) categories.add('phone-number');
  const textWithoutPhones = phoneMatches ? text.replace(PHONE_PATTERN_GLOBAL, ' ') : text;
  if (hasPaymentCardSequence(textWithoutPhones)) categories.add('payment-card');

  if (hasDateOfBirth(text)) categories.add('date-of-birth');
  if (PIN_TERMS.test(text) && PIN_VALUE.test(text)) categories.add('pin-code');
  if (GOVERNMENT_ID_PATTERN.test(text)) categories.add('government-id');
  if (FINANCIAL_ACCOUNT_PATTERN.test(text)) categories.add('financial-account');
  if (POSTAL_ADDRESS_PATTERN.test(text) || POSTAL_CODE_PATTERN.test(text)) categories.add('postal-address');
  if (MEDICAL_INFORMATION_PATTERN.test(text)) categories.add('medical-information');

  return { blocked: categories.size > 0, categories: Array.from(categories) };
}

/** Union of block categories across several texts (e.g. an item's text,
 * detail, and source quote, which are all persisted together). */
export function checkPersonalMemoryTexts(values: readonly string[]): PersonalMemoryGuardResult {
  const categories = new Set<PersonalMemoryBlockCategory>();
  for (const value of values) {
    for (const category of checkPersonalMemoryText(value).categories) categories.add(category);
  }
  return { blocked: categories.size > 0, categories: Array.from(categories) };
}
