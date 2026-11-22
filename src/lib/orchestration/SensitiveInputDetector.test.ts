import { describe, expect, it } from "vitest";
import { canonicalizeSensitiveInput, containsSensitiveInput, detectSensitiveInput, findSensitiveInputSpans, isReservedExampleEmailDomain } from "./SensitiveInputDetector";

const sampleValue = ["abc", "def", "123", "456"].join("");
const longSampleValue = ["abc", "def", "ghi", "jkl"].join("");
const providerKey = ["s", "k", "-", "abcdefghijkl", "mnopqrstuv"].join("");
const bearerValue = ["abc", ".", "def", ".", "ghi"].join("");

const structuredProviderKeys = [
  ["A", "K", "I", "A", "1234567890ABCDEF"].join(""),
  ["g", "h", "p", "_", "abcdefghijklmnopqrstuvwxyz123456"].join(""),
  ["github", "_pat_", "11AA22BB33CC44DD55EE66FF77GG88HH"].join(""),
  ["A", "I", "z", "a", "SyA1234567890abcdefghijklmnopqrstuvwxyz"].join(""),
  ["x", "o", "x", "b", "-", "1234567890-abcdefghijklmnopqrstuvwxyz"].join(""),
  ["s", "k", "_live_", "abcdefghijklmnopqrstuvwx"].join(""),
  ["r", "k", "_test_", "abcdefghijklmnopqrstuvwx"].join(""),
];

describe("SensitiveInputDetector", () => {
  it("detects representative sensitive input", () => {
    const inputs = [
      `API key: ${sampleValue}`,
      `api_key=${sampleValue}`,
      `client secret: ${sampleValue}`,
      `private_key=${sampleValue}`,
      `Authorization: Bearer ${bearerValue}`,
      ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
      providerKey,
      `JWT=${longSampleValue}`,
      `OAuth: ${longSampleValue}`,
      "秘密鍵を貼り付けます",
      "パスワードを確認してください",
      "認証情報を含みます",
      "Please paste the private key here",
      "This message contains a password",
      ...structuredProviderKeys,
    ];

    for (const input of inputs) {
      expect(containsSensitiveInput(input)).toBe(true);
    }
  });

  it("detects structured credentials after Unicode normalization and invisible-character removal", () => {
    const zeroWidthObfuscated = [
      "s",
      "\u200B",
      "k",
      "-",
      "abcdefghijkl",
      "\u2060",
      "mnopqrstuv",
    ].join("");
    const fullWidthContext = `ＡＰＩ ｋｅｙ：${sampleValue}`;

    expect(containsSensitiveInput(zeroWidthObfuscated)).toBe(true);
    expect(containsSensitiveInput(fullWidthContext)).toBe(true);
  });

  it("does not over-detect ordinary discussion", () => {
    const inputs = [
      "passwordless authenticationを設計してください",
      "The secretary prepared the release notes.",
      "tokenizationのアルゴリズムを説明してください",
      "OAuthの一般的な仕組みを説明してください",
      "JWT認証方式の長所と短所を比較してください",
      "秘密鍵暗号の歴史を説明してください",
      "秘密鍵と公開鍵の違いを説明してください",
      "Explain the history of private key cryptography.",
      "Compare password policies for enterprise systems.",
      "AKIAはAWSアクセスキーの代表的な接頭辞です",
      "GitHub token formats such as ghp_ should be rejected.",
      "Stripe test keys use an sk_test_ prefix.",
    ];

    for (const input of inputs) {
      expect(containsSensitiveInput(input)).toBe(false);
    }
  });

  it("is case-insensitive for structured credentials", () => {
    expect(containsSensitiveInput(`AUTHORIZATION: BEARER ${longSampleValue.toUpperCase()}`)).toBe(true);
    expect(containsSensitiveInput(`CLIENT SECRET: ${longSampleValue.toUpperCase()}`)).toBe(true);
  });

  it("reports categories without exposing matched values", () => {
    const privateValue = ["sample", "sensitive", "value"].join("-");
    const detection = detectSensitiveInput(`Authorization: Bearer ${privateValue}`);
    expect(detection.containsSensitiveInput).toBe(true);
    expect(detection.kinds).toContain("authorization-header");
    expect(JSON.stringify(detection)).not.toContain(privateValue);
  });

  it("reports provider-key without retaining structured credential values", () => {
    for (const privateValue of structuredProviderKeys) {
      const detection = detectSensitiveInput(privateValue);
      expect(detection.containsSensitiveInput).toBe(true);
      expect(detection.kinds).toContain("provider-key");
      expect(JSON.stringify(detection)).not.toContain(privateValue);
    }
  });
  it("blocks direct personal and confidential data before provider egress", () => {
    const inputs = [
      "連絡先は nori@sample.co.jp です",
      "電話番号は 090-1234-5678 です",
      "住所: 東京都千代田区丸の内1-1",
      "マイナンバー: 1234-5678-9012",
      "銀行口座: 1234567",
      "病歴: 高血圧",
      "my date of birth: 1990-01-02",
    ];

    for (const input of inputs) {
      expect(containsSensitiveInput(input)).toBe(true);
    }
  });

  it("allows ordinary names and company names in routine writing requests", () => {
    const inputs = [
      "顧客の田中様に送るお礼メールを作ってください",
      "社員の佐藤さん向けに業務連絡を作成してください",
      "株式会社山田商事への提案書を作ってください",
      "Draft a follow-up email to customer Tanaka at Example Corporation",
      "私の名前は山田太郎です。自己紹介文を作ってください",
    ];
    for (const input of inputs) expect(containsSensitiveInput(input)).toBe(false);
  });

  it("continues to block high-risk secrets and government or payment identifiers", () => {
    const inputs = [
      `API key: ${sampleValue}`,
      ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
      "クレジットカード番号: 4111 1111 1111 1111",
      "マイナンバー: 1234-5678-9012",
    ];
    for (const input of inputs) expect(containsSensitiveInput(input)).toBe(true);
  });

  it("reports only privacy categories and never retains personal values", () => {
    const privateValue = "nori@sample.co.jp";
    const detection = detectSensitiveInput(`連絡先は ${privateValue} です`);
    expect(detection.kinds).toContain("email-address");
    expect(JSON.stringify(detection)).not.toContain(privateValue);
  });
});

describe("SensitiveInputDetector S-1a (RFC 2606 reserved email domains)", () => {
  it("does not treat addresses at reserved example domains as personal data", () => {
    const inputs = [
      "連絡先は user@example.com です",
      "user@example.net",
      "user@example.org",
      "user@sub.example.com",
      "user@deep.sub.example.org",
      "user@foo.example",
      "user@a.b.example",
    ];
    for (const input of inputs) {
      expect(detectSensitiveInput(input).kinds).not.toContain("email-address");
      expect(containsSensitiveInput(input)).toBe(false);
    }
  });

  it("still detects addresses that can really exist", () => {
    const inputs = [
      "example@gmail.com",
      "example@company.jp",
      "example@outlook.jp",
      "user@example.co.jp",
      "nori@sample.co.jp",
    ];
    for (const input of inputs) {
      expect(detectSensitiveInput(input).kinds).toContain("email-address");
    }
  });

  it("classifies reserved domains exactly", () => {
    expect(isReservedExampleEmailDomain("example.com")).toBe(true);
    expect(isReservedExampleEmailDomain("EXAMPLE.COM")).toBe(true);
    expect(isReservedExampleEmailDomain("sub.example.net")).toBe(true);
    expect(isReservedExampleEmailDomain("foo.example")).toBe(true);
    expect(isReservedExampleEmailDomain("gmail.com")).toBe(false);
    expect(isReservedExampleEmailDomain("company.jp")).toBe(false);
    expect(isReservedExampleEmailDomain("example.co.jp")).toBe(false);
    expect(isReservedExampleEmailDomain("notexample.com")).toBe(false);
    expect(isReservedExampleEmailDomain("example.com.evil.jp")).toBe(false);
  });
});

describe("findSensitiveInputSpans", () => {
  it("returns spans over the canonicalized input that slice to the matched values", () => {
    const input = "連絡先は nori@sample.co.jp と 090-1234-5678 です";
    const canonical = canonicalizeSensitiveInput(input);
    const spans = findSensitiveInputSpans(input);
    const sliced = spans.map((span) => canonical.slice(span.start, span.end));
    expect(sliced.some((text) => text.includes("nori@sample.co.jp"))).toBe(true);
    expect(sliced.some((text) => text.includes("090-1234-5678"))).toBe(true);
    expect(spans.map((span) => span.kind)).toContain("email-address");
    expect(spans.map((span) => span.kind)).toContain("phone-number");
  });

  it("finds structured credentials hidden behind invisible characters, on the canonical form", () => {
    const obfuscated = ["s", "\u200B", "k", "-", "abcdefghijkl", "\u2060", "mnopqrstuv"].join("");
    const canonical = canonicalizeSensitiveInput(obfuscated);
    const spans = findSensitiveInputSpans(obfuscated);
    expect(spans.map((span) => span.kind)).toContain("provider-key");
    const span = spans.find((candidate) => candidate.kind === "provider-key");
    expect(canonical.slice(span?.start, span?.end)).toContain(providerKey);
  });

  it("produces no span for reserved example addresses", () => {
    expect(findSensitiveInputSpans("連絡先は user@example.com です")).toEqual([]);
  });

  it("implies exactly the kinds detectSensitiveInput reports", () => {
    const corpus = [
      `API key: ${sampleValue}`,
      `Authorization: Bearer ${bearerValue}`,
      providerKey,
      "秘密鍵を貼り付けます",
      "パスワードを確認してください",
      "連絡先は nori@sample.co.jp です",
      "連絡先は user@example.com です",
      "電話番号は 090-1234-5678 です",
      "住所: 東京都千代田区丸の内1-1",
      "私のメールアドレスは nori@sample.co.jp です",
      "病歴: 高血圧",
      "ただの文章です",
    ];
    for (const input of corpus) {
      const spanKinds = Array.from(new Set(findSensitiveInputSpans(input).map((span) => span.kind))).sort();
      const detectedKinds = [...detectSensitiveInput(input).kinds].sort();
      expect(spanKinds).toEqual(detectedKinds);
    }
  });
});
