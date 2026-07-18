import { describe, expect, it } from "vitest";
import { minimizeOriginContext } from "./OriginContextPolicy";

const conversation = [
  { role: "ai" as const, content: "ORIGINの案内です。" },
  { role: "user" as const, content: "最初の依頼" },
  { role: "ai" as const, content: "最初の回答" },
  { role: "user" as const, content: "二つ目の依頼" },
  { role: "ai" as const, content: "二つ目の回答" },
  { role: "user" as const, content: "最新の依頼" },
];

describe("minimizeOriginContext", () => {
  it("keeps the latest coherent window and removes an orphan assistant greeting", () => {
    const result = minimizeOriginContext(conversation, {
      version: 1,
      maxMessages: 6,
      maxCharacters: 12_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.window.messages[0].role).toBe("user");
    expect(result.window.messages.at(-1)).toEqual({ role: "user", content: "最新の依頼" });
    expect(result.window.messages).not.toContainEqual({ role: "ai", content: "ORIGINの案内です。" });
    expect(result.window.omittedMessageCount).toBe(1);
  });

  it("keeps only the most recent complete messages within the message limit", () => {
    const result = minimizeOriginContext(conversation, {
      version: 1,
      maxMessages: 3,
      maxCharacters: 12_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.window.messages).toEqual([
      { role: "user", content: "二つ目の依頼" },
      { role: "ai", content: "二つ目の回答" },
      { role: "user", content: "最新の依頼" },
    ]);
    expect(result.window.omittedMessageCount).toBe(3);
  });

  it("does not partially truncate a message when the character budget is reached", () => {
    const result = minimizeOriginContext([
      { role: "user", content: "a".repeat(800) },
      { role: "ai", content: "b".repeat(500) },
      { role: "user", content: "c".repeat(500) },
    ], {
      version: 1,
      maxMessages: 10,
      maxCharacters: 1_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.window.messages).toEqual([{ role: "user", content: "c".repeat(500) }]);
    expect(result.window.includedCharacterCount).toBe(500);
    expect(result.window.omittedCharacterCount).toBe(1_300);
  });

  it("rejects an oversized latest request instead of silently truncating it", () => {
    expect(minimizeOriginContext([
      { role: "user", content: "x".repeat(1_001) },
    ], {
      version: 1,
      maxMessages: 10,
      maxCharacters: 1_000,
    })).toEqual({
      ok: false,
      code: "LATEST_MESSAGE_TOO_LARGE",
      message: "最新の依頼が外部送信の上限（1000文字）を超えています。内容を分割または要約してください。",
    });
  });

  it("rejects invalid context policies", () => {
    expect(minimizeOriginContext(conversation, {
      version: 1,
      maxMessages: 0,
      maxCharacters: 12_000,
    })).toEqual(expect.objectContaining({
      ok: false,
      code: "INVALID_CONTEXT_POLICY",
    }));
  });
});
