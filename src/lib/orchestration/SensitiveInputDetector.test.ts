import { describe, expect, it } from "vitest";
import { containsSensitiveInput, detectSensitiveInput } from "./SensitiveInputDetector";

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
});
