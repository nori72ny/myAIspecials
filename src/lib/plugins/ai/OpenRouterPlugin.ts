import { IAIProviderPlugin, AIProviderManifest } from '../../kernel/plugin/types';
import { Logger } from '../../../../services/mission-engine/src/infrastructure/logging/Logger';

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly requestId?: string,
    public readonly rawError?: any
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export class OpenRouterPlugin implements IAIProviderPlugin {
  public manifest: AIProviderManifest = {
    id: "plugin-openrouter",
    name: "OpenRouter Provider Plugin",
    version: "1.0.0",
    author: "ACOS Core Team",
    description: "Provides access to explicitly free models via OpenRouter API",
    provider: "OpenRouter",
    models: [
      {
        id: "google/gemini-2.5-flash:free",
        name: "Gemini 2.5 Flash (OpenRouter Free)",
        speed: 8,
        cost: 0,
        quality: 8,
        failureRate: 0.05,
        specialties: ["Reasoning", "Text Generation", "Code"]
      }
    ]
  };

  private _apiKey: string;

  constructor(apiKey: string) {
    // Sanitize API Key input - avoid trailing whitespace
    this._apiKey = (apiKey || "").trim();
  }

  public async initialize(): Promise<void> {
    if (!this._apiKey) {
      Logger.warn("[OpenRouterPlugin] No API Key provided. OpenRouter will run in fallback mock mode.");
    } else {
      Logger.info("[OpenRouterPlugin] Initialized successfully with API Key.");
    }
  }

  public async shutdown(): Promise<void> {
    Logger.info("[OpenRouterPlugin] Shut down completed.");
  }

  /**
   * Helper to determine if a model ID represents an explicitly free-tier model.
   * Automatic routing is intentionally excluded because it may select a paid model.
   */
  private isFreeModel(modelId: string): boolean {
    const lowerId = modelId.toLowerCase();
    return (
      lowerId.includes(':free') ||
      lowerId.includes('-free') ||
      lowerId.endsWith('/free')
    );
  }

  /**
   * Generates text via the OpenRouter Chat Completions API with detailed safety and reliability wrappers.
   */
  public async generateText(modelId: string, prompt: string, options?: any): Promise<string> {
    // This project is free-only by default. Paid routing requires an explicit local opt-out.
    const isFreeOnly = process.env.FREE_ONLY !== "false" || options?.freeOnly === true;

    // 1. Free-only enforcement / Paid model blocking
    if (isFreeOnly && !this.isFreeModel(modelId)) {
      Logger.warn(`[OpenRouterPlugin] Blocked execution of paid or automatic model '${modelId}' under free-only constraints.`);
      if (options?.throwOnBlock) {
        throw new OpenRouterError("FREE_MODEL_UNAVAILABLE", 400);
      }
      return "FREE_MODEL_UNAVAILABLE";
    }

    // Fallback Mock Mode (e.g., in deterministic tests or when no key is specified)
    if (!this._apiKey || this._apiKey.startsWith("mock-") || process.env.NODE_ENV === "test") {
      Logger.info(`[OpenRouterPlugin] Running generateText in fallback mock mode for model: ${modelId}`);
      return this.getFallbackMockResponse(prompt, modelId);
    }

    const maxRetries = options?.maxRetries ?? 3;
    const initialDelayMs = options?.initialDelayMs ?? 1000;
    const timeoutMs = options?.timeout ?? 30000;

    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      let onAbort: (() => void) | undefined;
      if (options?.signal) {
        onAbort = () => {
          controller.abort();
        };
        options.signal.addEventListener('abort', onAbort);
      }

      try {
        Logger.info(`[OpenRouterPlugin] Executing generation request. Model: ${modelId}, Attempt: ${attempt}/${maxRetries}`);

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this._apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://ai.studio/build",
            "X-Title": "Intelligence OS"
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: prompt }],
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.max_tokens
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const status = response.status;
          let errorBody = "";
          try {
            errorBody = await response.text();
          } catch (_) {}

          const requestId = response.headers.get("x-request-id") || undefined;

          if (status === 429) {
            Logger.warn(`[OpenRouterPlugin] Rate-limited (429) on attempt ${attempt}. Request ID: ${requestId}`);
            if (attempt < maxRetries) {
              await this.delay(initialDelayMs * Math.pow(2, attempt));
              continue;
            }
            throw new OpenRouterError("Rate limit exceeded on OpenRouter. Please try again later.", 429, requestId, errorBody);
          }

          if (status >= 500) {
            Logger.warn(`[OpenRouterPlugin] Server Error (${status}) on attempt ${attempt}. Request ID: ${requestId}`);
            if (attempt < maxRetries) {
              await this.delay(initialDelayMs * Math.pow(2, attempt));
              continue;
            }
            throw new OpenRouterError(`OpenRouter server returned an error: ${status}`, status, requestId, errorBody);
          }

          throw new OpenRouterError(`OpenRouter request failed with status: ${status}`, status, requestId, errorBody);
        }

        const data = await response.json() as any;
        if (!data || typeof data !== 'object') {
          throw new OpenRouterError("Invalid JSON structure received from OpenRouter API.", response.status);
        }

        const requestId = response.headers.get("x-request-id") || data.id || "unknown-id";

        if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
          throw new OpenRouterError("OpenRouter API returned an empty choices array.", response.status, requestId, data);
        }

        const content = data.choices[0]?.message?.content ?? data.choices[0]?.text;
        if (content === undefined || content === null) {
          throw new OpenRouterError("OpenRouter API choices did not contain expected content text.", response.status, requestId, data);
        }

        const usage = data.usage || {};
        const promptTokens = usage.prompt_tokens ?? Math.ceil(prompt.length / 4);
        const completionTokens = usage.completion_tokens ?? Math.ceil(content.length / 4);
        const totalTokens = usage.total_tokens ?? (promptTokens + completionTokens);

        Logger.info(`[OpenRouterPlugin] LLM completed successfully.`, {
          requestId,
          model: modelId,
          promptTokens,
          completionTokens,
          totalTokens
        });

        if (options?.onUsage && typeof options.onUsage === 'function') {
          options.onUsage({ promptTokens, completionTokens, totalTokens, requestId });
        }

        return content;
      } catch (error: any) {
        const isAbort = error.name === 'AbortError';
        if (isAbort) {
          Logger.warn(`[OpenRouterPlugin] Request timed out or was interrupted. Model: ${modelId}`);
          throw new OpenRouterError("OpenRouter request timed out or was aborted by the client.", 408);
        }

        if (error instanceof OpenRouterError) {
          throw error;
        }

        Logger.error(`[OpenRouterPlugin] Request error on attempt ${attempt}: ${error.message}`, error);

        if (attempt < maxRetries) {
          await this.delay(initialDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw new OpenRouterError(error.message || "An unexpected error occurred during OpenRouter generation.", undefined, undefined, error);
      } finally {
        clearTimeout(timeoutId);
        if (options?.signal && onAbort) {
          options.signal.removeEventListener('abort', onAbort);
        }
      }
    }

    throw new OpenRouterError("Max retries exceeded without obtaining a successful response.", 500);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getFallbackMockResponse(prompt: string, modelId: string): string {
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes("review") || lowerPrompt.includes("strict corporate manager")) {
      return JSON.stringify({
        score: 92,
        feedback: `[OpenRouter Mock: ${modelId}] 成果物のレビューは良好です。仕様通りに動作しています。`
      });
    }
    if (lowerPrompt.includes("board directive")) {
      return `[OpenRouter Mock: ${modelId}] 取締役会の戦略目標が設定されました。`;
    }
    return `[Mock] OpenRouter response for: ${prompt} (Using model: ${modelId})`;
  }
}