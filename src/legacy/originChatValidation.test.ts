import { describe, expect, it } from "vitest";
import {
  hasOriginWeatherLocation,
  isOriginWeatherRequest,
} from "./originChatValidation";

describe("isOriginWeatherRequest", () => {
  it.each([
    "天気",
    "今日の天気は？",
    "どこの天気",
    "大阪の天気",
    "傘は必要？",
    "傘いる？",
    "雨降る？",
    "WEATHER",
  ])("classifies %s as a weather request", (message) => {
    expect(isOriginWeatherRequest(message)).toBe(true);
  });

  it.each([
    "Weather APIの設計方法を教えて",
    "天気アプリを作る方法",
    "weather app build guide",
    "今日の気分は天気みたいに変わる",
    "傘が必要",
    "雨が降る",
    "",
  ])("does not classify %s as a runtime weather lookup", (message) => {
    expect(isOriginWeatherRequest(message)).toBe(false);
  });

  it("handles long adversarial weather input without a polynomial regular expression", () => {
    const message = `${"天気".repeat(20_000)}の天気`;
    expect(isOriginWeatherRequest(message)).toBe(true);
  });
});

describe("hasOriginWeatherLocation", () => {
  it.each([
    ["大阪の天気", undefined],
    ["札幌の天気", undefined],
    ["渋谷区の天気", undefined],
    ["weather in London", undefined],
    ["weather at London", undefined],
    ["weather", "London"],
  ])("detects a location for %s", (message, userLocation) => {
    expect(hasOriginWeatherLocation(message, userLocation)).toBe(true);
  });

  it("requires location clarification when no location evidence is supplied", () => {
    expect(hasOriginWeatherLocation("今日の天気は？", undefined)).toBe(false);
  });
});
