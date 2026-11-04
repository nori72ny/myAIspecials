import { ILLMClient } from "./ILLMClient";
import { Logger } from "../logging/Logger";
import "dotenv/config";

/**
 * Legacy deterministic test double only.
 * Native Gemini execution is intentionally absent from this class. Tests must
 * never turn a configured GEMINI_API_KEY into a live provider request.
 */
export class GeminiLLMClient implements ILLMClient {
  constructor() {
    if (process.env.GEMINI_API_KEY) {
      Logger.warn("GEMINI_API_KEY is present but ignored by the deterministic legacy test client.");
    }
  }

  async generateText(prompt: string, _systemPrompt?: string, _model = "gemini-2.5-flash"): Promise<string> {
    if (process.env.NODE_ENV !== "test" || process.env.FREE_ONLY === "true") {
      throw new Error("FREE_ONLY_PROVIDER_BLOCKED: Gemini native API is disabled; use the canonical verified OpenRouter :free boundary.");
    }
    if (process.env.GEMINI_API_KEY) {
      throw new Error("FREE_ONLY_PROVIDER_BLOCKED: provider credentials are forbidden in deterministic tests.");
    }
    return this.getFallbackResponse(prompt);
  }

  private getFallbackResponse(prompt: string): string {
    if (prompt.includes("目的")) {
      return JSON.stringify([
        { description: "ミッションの要件定義とスコープを設定する", capability: "DESIGN" },
        { description: "関連する技術、アーキテクチャの調査を行う", capability: "ANALYZE" },
        { description: "成果物の実装および検証を行う", capability: "ASSIST" }
      ]);
    }
    return "【決定論的テスト】タスクが正常に完了しました。要件を満たす成果物が生成されました。";
  }
}
