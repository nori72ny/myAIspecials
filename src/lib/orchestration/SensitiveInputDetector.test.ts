import { describe, expect, it } from "vitest";
import { containsSensitiveInput, detectSensitiveInput } from "./SensitiveInputDetector";

const sampleValue = ["abc", "def", "123", "456"].join("");
const longSampleValue = ["abc", "def", "ghi", "jkl"].join("");
const providerKey = ["s", "k", "-", "abcdefghijkl", "mnopqrstuv"].join("");
const bearerValue = ["abc", ".", "def", ".", "ghi"].join("");

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
    ];

    for (const input of inputs) {
      expect(containsSensitiveInput(input)).toBe(true);
    }
  });

  it("does not over-detect ordinary discussion", () => {
    const inputs = [
      "passwordless authenticationを設計してください",
      "The secretary prepared the release notes.",
      "tokenizationのアルゴリズムを説明してください",
      "OAuthの一般的な仕組みを説明してください",
      "JWT認証方式の長所と短所を比較してください",
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
});
