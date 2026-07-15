import { describe, expect, it } from "vitest";
import { containsSensitiveInput, detectSensitiveInput } from "./SensitiveInputDetector";

describe("SensitiveInputDetector", () => {
  it.each([
    "API key: abcdef123456",
    "api_key=abcdef123456",
    "client secret: abcdef123456",
    "private_key=abcdef123456",
    "Authorization: Bearer abc.def.ghi",
    "-----BEGIN PRIVATE KEY-----",
    "sk-abcdefghijklmnopqrstuvwxyz",
    "JWT=abcdefghijk",
    "OAuth: abcdefghijk",
    "秘密鍵を貼り付けます",
    "パスワードを確認してください",
    "認証情報を含みます",
  ])("detects representative sensitive input: %s", (input) => {
    expect(containsSensitiveInput(input)).toBe(true);
  });

  it.each([
    "passwordless authenticationを設計してください",
    "The secretary prepared the release notes.",
    "tokenizationのアルゴリズムを説明してください",
    "OAuthの一般的な仕組みを説明してください",
    "JWT認証方式の長所と短所を比較してください",
    "秘密鍵暗号の歴史を説明してください",
  ])("does not over-detect ordinary discussion: %s", (input) => {
    expect(containsSensitiveInput(input)).toBe(false);
  });

  it("is case-insensitive for structured credentials", () => {
    expect(containsSensitiveInput("AUTHORIZATION: BEARER ABCDEFGHIJK")).toBe(true);
    expect(containsSensitiveInput("CLIENT SECRET: ABCDEFGHIJK")).toBe(true);
  });

  it("reports categories without exposing matched values", () => {
    const detection = detectSensitiveInput("Authorization: Bearer super-secret-value");
    expect(detection.containsSensitiveInput).toBe(true);
    expect(detection.kinds).toContain("authorization-header");
    expect(JSON.stringify(detection)).not.toContain("super-secret-value");
  });
});
