import { describe, expect, it } from "vitest";
import {
  detectSensitiveConversation,
  hasOriginWeatherLocation,
  isOriginWeatherRequest,
  screenConversationForSend,
} from "./originChatValidation";
import type { OriginChatMessage } from "./originProviderClient";

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

describe("detectSensitiveConversation", () => {
  it("blocks personal information anywhere in the outbound conversation", () => {
    expect(detectSensitiveConversation([
      { role: "user", content: "この文章を整えてください" },
      { role: "assistant", content: "連絡先は nori@sample.co.jp です" },
      { role: "user", content: "続けてください" },
    ])).toContain("email-address");
  });

  it("does not expose matched personal values in its result", () => {
    const privateValue = "090-1234-5678";
    const result = detectSensitiveConversation([{ role: "user", content: `電話番号: ${privateValue}` }]);
    expect(result).toContain("phone-number");
    expect(JSON.stringify(result)).not.toContain(privateValue);
  });
});

describe("screenConversationForSend (S-1)", () => {
  const providerKey = ["s", "k", "-", "abcdefghijkl", "mnopqrstuv"].join("");

  it("returns a clean conversation untouched (same array reference)", () => {
    const messages = [
      { role: "user", content: "案内文を整えてください" },
      { role: "assistant", content: "承知しました。下書きを用意します。" },
      { role: "user", content: "お願いします" },
    ] as const;
    const result = screenConversationForSend([...messages]);
    expect(result.outcome).toBe("clean");
    expect(result.redactionCount).toBe(0);
    expect(result.messages[1]?.content).toBe("承知しました。下書きを用意します。");
  });

  it("continues past a model-generated placeholder address in an assistant turn (IMPL-01 reproduction)", () => {
    const messages: OriginChatMessage[] = [
      { role: "user", content: "取引先への問い合わせメールの下書きを作ってください" },
      { role: "assistant", content: "下書きです。お問い合わせは example@company.jp までお願いいたします。" },
      { role: "user", content: "ありがとうございます。もう少し丁寧にしてください" },
    ];
    const result = screenConversationForSend(messages);
    expect(result.outcome).toBe("sanitized");
    expect(result.redactedKinds).toContain("email-address");
    expect(result.redactionCount).toBeGreaterThanOrEqual(1);
    const assistantCopy = result.messages[1]?.content ?? "";
    expect(assistantCopy).not.toContain("example@company.jp");
    expect(assistantCopy).not.toContain("company.jp");
    // User turns and the caller's original conversation are untouched.
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[2]).toBe(messages[2]);
    expect(messages[1]?.content).toContain("example@company.jp");
    expect(detectSensitiveConversation(result.messages)).toEqual([]);
  });

  it("redacts a real-looking address echoed in an assistant turn", () => {
    const result = screenConversationForSend([
      { role: "user", content: "連絡先の書き方を教えてください" },
      { role: "assistant", content: "連絡先は nori@sample.co.jp です" },
      { role: "user", content: "続けてください" },
    ]);
    expect(result.outcome).toBe("sanitized");
    expect(JSON.stringify(result.messages)).not.toContain("nori@sample.co.jp");
  });

  it("redacts a provider key that appears only in an assistant turn", () => {
    const result = screenConversationForSend([
      { role: "user", content: "設定手順を教えてください" },
      { role: "assistant", content: `キーは ${providerKey} の形式です` },
      { role: "user", content: "続けてください" },
    ]);
    expect(result.outcome).toBe("sanitized");
    expect(result.redactedKinds).toContain("provider-key");
    expect(JSON.stringify(result.messages)).not.toContain(providerKey);
  });

  it("redacts an address hidden behind invisible characters on the canonical copy", () => {
    const obfuscated = ["nori", "\u200B", "@sample.co.jp"].join("");
    const result = screenConversationForSend([
      { role: "user", content: "連絡先の書き方を教えてください" },
      { role: "assistant", content: `連絡先は ${obfuscated} です` },
      { role: "user", content: "続けてください" },
    ]);
    expect(result.outcome).toBe("sanitized");
    expect(JSON.stringify(result.messages)).not.toContain("sample.co.jp");
  });

  it("blocks user-turn secrets exactly as before", () => {
    const messages: OriginChatMessage[] = [
      { role: "user", content: "この文章を整えてください" },
      { role: "assistant", content: "承知しました" },
      { role: "user", content: `API key: ${["abc", "def", "123", "456"].join("")}` },
    ];
    const result = screenConversationForSend(messages);
    expect(result.outcome).toBe("blocked");
    expect(result.sensitiveKinds).toEqual(detectSensitiveConversation(messages));
    expect(result.messages).toBe(messages);
  });

  it("keeps example@gmail.com in a user turn blocked (a real address can exist there)", () => {
    const result = screenConversationForSend([
      { role: "user", content: "連絡先は example@gmail.com です。これを使ってください" },
    ]);
    expect(result.outcome).toBe("blocked");
    expect(result.sensitiveKinds).toContain("email-address");
  });

  it("lets a user turn use a reserved example address (S-1a)", () => {
    const result = screenConversationForSend([
      { role: "user", content: "下書きの連絡先は user@example.com としてください" },
    ]);
    expect(result.outcome).toBe("clean");
  });

  it("blocks an imported history whose user-role turns carry a secret", () => {
    const result = screenConversationForSend([
      { role: "user", content: "以前の会話の記録です。電話番号は 090-1234-5678 です" },
      { role: "user", content: "この続きをお願いします" },
    ]);
    expect(result.outcome).toBe("blocked");
    expect(result.sensitiveKinds).toContain("phone-number");
  });

  it("blocks a secret split across a user and an assistant turn", () => {
    const result = screenConversationForSend([
      { role: "user", content: "キーの前半は sk-abcdef" },
      { role: "assistant", content: "ghijklmnopqrstuvwxyz が後半です" },
      { role: "user", content: "続けてください" },
    ]);
    expect(result.outcome).toBe("blocked");
    expect(result.sensitiveKinds).toContain("provider-key");
  });

  it("blocks a secret split across two assistant turns", () => {
    const result = screenConversationForSend([
      { role: "user", content: "キーを分割して確認します" },
      { role: "assistant", content: "前半は sk-abcdef" },
      { role: "assistant", content: "ghijklmnopqrstuvwxyz が後半です" },
      { role: "user", content: "続けてください" },
    ]);
    expect(result.outcome).toBe("blocked");
    expect(result.sensitiveKinds).toContain("provider-key");
  });

  it("stays blocked when redaction would leave a cross-boundary split hit (fail closed)", () => {
    const result = screenConversationForSend([
      { role: "user", content: "下書きをお願いします" },
      { role: "assistant", content: "連絡先は nori@sample.co.jp です。キーの前半は sk-abcdef" },
      { role: "user", content: "ghijklmnopqrstuvwxyz を後半として使ってください" },
    ]);
    expect(result.outcome).toBe("blocked");
    expect(result.sensitiveKinds).toContain("provider-key");
  });

  it("keeps the existing credential-term treatment for assistant turns (not blocking, not redacted)", () => {
    const messages: OriginChatMessage[] = [
      { role: "user", content: "認証について教えてください" },
      { role: "assistant", content: "パスワードを確認してください" },
      { role: "user", content: "ありがとうございます" },
    ];
    const result = screenConversationForSend(messages);
    expect(result.outcome).toBe("clean");
    expect(result.messages[1]?.content).toBe("パスワードを確認してください");
  });
});
