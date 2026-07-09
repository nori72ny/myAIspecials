import { IProviderAdapter } from './types';
import { Provider } from '../domain/entities/Provider';

export class OpenRouterAdapter implements IProviderAdapter {
  public readonly id = "OpenRouter";

  /**
   * Mock/simulated fetching from OpenRouter's actual models catalog.
   * Maps multiple high-profile model providers registered via OpenRouter,
   * each declaring their capabilities (scores 1-5 stars) and latency/cost metrics.
   */
  public async getSelfDeclaredProviders(): Promise<Provider[]> {
    // Return a rich set of models aggregated by OpenRouter
    return [
      // 1. Anthropic Claude - Exceptional Reasoning, Coding, Writing
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
        ["complex-reasoning", "agentic-orchestration"]
      ),

      // 2. OpenAI GPT - Stellar Reasoning, Planning, Presentation
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
        ["balanced", "structured-output"]
      ),

      // 3. Google Gemini - Exceptional Vision, Search, Multimodal, Translation
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
        ["massive-context", "low-cost"]
      ),

      // 4. DeepSeek Coder - High performance cost-effective coding & math
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
        ["cost-sensitive", "highly-efficient"]
      ),

      // 5. xAI Grok - High speed debate, forecasting & translation
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
        ["real-time-data"]
      )
    ];
  }
}
