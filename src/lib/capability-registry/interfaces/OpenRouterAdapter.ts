import { IProviderAdapter } from './types';
import { Provider } from '../domain/entities/Provider';

export class OpenRouterAdapter implements IProviderAdapter {
  public readonly id = "OpenRouter";

  /**
   * Fetching from OpenRouter's actual models catalog.
   * Maps multiple high-profile model providers registered via OpenRouter,
   * including standard free-tier models, declaring their capabilities and metrics.
   */
  public async getSelfDeclaredProviders(): Promise<Provider[]> {
    return [
      // === FREE MODELS ===
      // 1. Google Gemini 2.5 Flash Free - Exceptional speed and multimodal
      new Provider(
        "openrouter/google/gemini-2.5-flash:free",
        "Gemini 2.5 Flash Free (OpenRouter)",
        this.id,
        new Map([
          ["Reasoning", 3],
          ["Planning", 3],
          ["Coding", 3],
          ["Writing", 4],
          ["Analysis", 4],
          ["Research", 4],
          ["Multimodal", 5],
          ["Translation", 4]
        ]),
        "healthy",
        { cost: 0, latency: 450, quality: 7, failureRate: 0.01 },
        ["free-model", "low-cost", "fast"]
      ),

      // 2. Llama 3 8B Instruct Free - Efficient and fast text generation
      new Provider(
        "openrouter/meta/llama-3-8b-instruct:free",
        "Llama 3 8B Instruct Free (OpenRouter)",
        this.id,
        new Map([
          ["Reasoning", 2],
          ["Planning", 2],
          ["Coding", 2],
          ["Writing", 3],
          ["Analysis", 2],
          ["Translation", 3]
        ]),
        "healthy",
        { cost: 0, latency: 400, quality: 6, failureRate: 0.02 },
        ["free-model", "low-cost", "fast"]
      ),

      // === PAID MODELS ===
      // 3. Anthropic Claude - Exceptional Reasoning, Coding, Writing (PAID)
      new Provider(
        "openrouter/anthropic/claude-3.5-sonnet",
        "Claude 3.5 Sonnet (OpenRouter)",
        this.id,
        new Map([
          ["Reasoning", 5],
          ["Planning", 4],
          ["Coding", 5],
          ["Writing", 5],
          ["Analysis", 5],
          ["Research", 4]
        ]),
        "healthy",
        { cost: 6, latency: 850, quality: 9, failureRate: 0.005 },
        ["complex-reasoning", "agentic-orchestration", "paid-model"]
      ),

      // 4. OpenAI GPT - Stellar Reasoning, Planning, Presentation (PAID)
      new Provider(
        "openrouter/openai/gpt-4o",
        "GPT-4o (OpenRouter)",
        this.id,
        new Map([
          ["Reasoning", 5],
          ["Planning", 5],
          ["Coding", 4],
          ["Writing", 4],
          ["Presentation", 5],
          ["Math", 5],
          ["Analysis", 4]
        ]),
        "healthy",
        { cost: 7, latency: 720, quality: 9, failureRate: 0.008 },
        ["balanced", "structured-output", "paid-model"]
      ),

      // 5. Google Gemini - Exceptional Vision, Search, Multimodal (PAID)
      new Provider(
        "openrouter/google/gemini-1.5-pro",
        "Gemini 1.5 Pro (OpenRouter)",
        this.id,
        new Map([
          ["Reasoning", 4],
          ["Vision", 5],
          ["Search", 5],
          ["Multimodal", 5],
          ["Translation", 5],
          ["Research", 5],
          ["Simulation", 4]
        ]),
        "healthy",
        { cost: 4, latency: 600, quality: 8, failureRate: 0.015 },
        ["massive-context", "low-cost", "paid-model"]
      ),

      // 6. DeepSeek Coder - High performance cost-effective coding & math (PAID)
      new Provider(
        "openrouter/deepseek/deepseek-coder",
        "DeepSeek Coder (OpenRouter)",
        this.id,
        new Map([
          ["Coding", 5],
          ["Math", 4],
          ["Reasoning", 3],
          ["Analysis", 3]
        ]),
        "healthy",
        { cost: 2, latency: 1200, quality: 8, failureRate: 0.025 },
        ["cost-sensitive", "highly-efficient", "paid-model"]
      ),

      // 7. xAI Grok - High speed debate, forecasting (PAID)
      new Provider(
        "openrouter/xai/grok-2",
        "Grok 2 (OpenRouter)",
        this.id,
        new Map([
          ["Debate", 5],
          ["Forecast", 4],
          ["Search", 4],
          ["Writing", 4]
        ]),
        "healthy",
        { cost: 5, latency: 550, quality: 8, failureRate: 0.03 },
        ["real-time-data", "paid-model"]
      )
    ];
  }
}
