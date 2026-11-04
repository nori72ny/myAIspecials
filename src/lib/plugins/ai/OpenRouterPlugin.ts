import { IAIProviderPlugin, AIProviderManifest } from '../../kernel/plugin/types';
import { Logger } from '../../../../services/mission-engine/src/infrastructure/logging/Logger';
import { ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL } from '../../orchestration/OriginFreeModelCatalog';

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
        id: ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL,
        name: "ORIGIN Approved Free Model",
        speed: 8,
        cost: 0,
        quality: 8,
        failureRate: 0.05,
        specialties: ["Reasoning", "Text Generation", "Code"]
      }
    ]
  };

  constructor(_apiKey: string) {
    // The legacy adapter deliberately does not retain provider credentials.
  }

  public async initialize(): Promise<void> {
    Logger.warn("[OpenRouterPlugin] Legacy direct provider execution is disabled; use the canonical ORIGIN execution boundary.");
  }

  public async shutdown(): Promise<void> {
    Logger.info("[OpenRouterPlugin] Shut down completed.");
  }

  /**
   * Helper to determine if a model ID represents an explicitly free-tier model.
   * Automatic routing is intentionally excluded because it may select a paid model.
   */
  private isFreeModel(modelId: string): boolean {
    // The public manifest is presentation metadata and may be mutated by callers.
    // Authorization must depend only on the immutable canonical catalog constant.
    return typeof modelId === "string" && modelId === ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL;
  }

  /**
   * Generates text via the OpenRouter Chat Completions API with detailed safety and reliability wrappers.
   */
  public async generateText(modelId: string, prompt: string, _options?: any): Promise<string> {
    if (!this.isFreeModel(modelId)) {
      Logger.warn("[OpenRouterPlugin] Blocked model outside the immutable ORIGIN free-model allowlist.");
      throw new OpenRouterError("FREE_MODEL_UNAVAILABLE", 400);
    }

    // Deterministic output is permitted only in tests; it never contacts a provider.
    if (process.env.NODE_ENV === "test") {
      return this.getFallbackMockResponse(prompt, modelId);
    }

    // This legacy API payload cannot prove the canonical execution plan, ZDR,
    // data-collection denial, zero max-price, exact served-model identity, or
    // provider-reported billing. Never send it to OpenRouter.
    throw new OpenRouterError("FREE_ONLY_PROVIDER_BOUNDARY_REQUIRED", 503);
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