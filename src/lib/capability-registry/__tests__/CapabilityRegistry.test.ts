import { describe, it, expect, vi } from 'vitest';
import { CapabilityRegistry } from '../application/CapabilityRegistry';
import { Capability } from '../domain/entities/Capability';
import { Provider } from '../domain/entities/Provider';
import { OpenRouterAdapter } from '../interfaces/OpenRouterAdapter';
import { globalEventBus } from '../../kernel/events/EventBus';

describe('CapabilityRegistry & Domain Model Tests', () => {
  it('should successfully register capabilities and providers', () => {
    const registry = new CapabilityRegistry();

    const codingCap = new Capability("Coding", "Software development capability", "utility");
    const reasoningCap = new Capability("Reasoning", "Logical planning and math", "reasoning");

    registry.registerCapability(codingCap);
    registry.registerCapability(reasoningCap);

    const providerMap = new Map<string, number>([
      ["Coding", 5],
      ["Reasoning", 4]
    ]);

    const provider = new Provider(
      "test-claude",
      "Test Claude",
      "Anthropic",
      providerMap,
      "healthy",
      { cost: 6, latency: 400, quality: 9, failureRate: 0.01 },
      ["complex-problems"]
    );

    registry.registerProvider(provider);

    expect(registry.getProvider("test-claude")).toBeDefined();
    expect(registry.getProvider("test-claude")?.name).toBe("Test Claude");
    expect(registry.getProvidersByCapability("Coding")).toHaveLength(1);
    expect(registry.getProvidersByCapability("Coding")[0].id).toBe("test-claude");
  });

  it('should rank providers properly with different priorities (Quality vs Cost)', () => {
    const registry = new CapabilityRegistry();

    // Provider A: Premium Quality but Expensive
    const premiumProvider = new Provider(
      "premium-gpt",
      "Premium GPT",
      "OpenAI",
      new Map([["Reasoning", 5], ["Planning", 5]]),
      "healthy",
      { cost: 9, latency: 600, quality: 10, failureRate: 0.001 }
    );

    // Provider B: Cheap, decent but lower quality
    const cheapProvider = new Provider(
      "cheap-llama",
      "Cheap Llama",
      "Meta",
      new Map([["Reasoning", 4], ["Planning", 4]]),
      "healthy",
      { cost: 2, latency: 300, quality: 6, failureRate: 0.02 }
    );

    registry.registerProvider(premiumProvider);
    registry.registerProvider(cheapProvider);

    // Case 1: Quality is prioritized
    const qualityDecision = registry.searchAndRank({
      capabilities: ["Reasoning", "Planning"],
      priority: "quality"
    });

    expect(qualityDecision.primaryProvider.id).toBe("premium-gpt");

    // Case 2: Cost is prioritized
    const costDecision = registry.searchAndRank({
      capabilities: ["Reasoning", "Planning"],
      priority: "cost"
    });

    expect(costDecision.primaryProvider.id).toBe("cheap-llama");
  });

  it('should filter out Down providers from active routing decisions', () => {
    const registry = new CapabilityRegistry();

    const activeProvider = new Provider(
      "healthy-gpt",
      "Healthy GPT",
      "OpenAI",
      new Map([["Reasoning", 4]]),
      "healthy",
      { cost: 5, latency: 500, quality: 8, failureRate: 0.01 }
    );

    const downProvider = new Provider(
      "down-claude",
      "Down Claude",
      "Anthropic",
      new Map([["Reasoning", 5]]),
      "down", // Down!
      { cost: 5, latency: 500, quality: 9, failureRate: 0.01 }
    );

    registry.registerProvider(activeProvider);
    registry.registerProvider(downProvider);

    const decision = registry.searchAndRank({
      capabilities: ["Reasoning"]
    });

    expect(decision.primaryProvider.id).toBe("healthy-gpt");
    expect(decision.secondaryProviders).not.toContain(downProvider);
  });

  it('should apply routing hints bonus points correctly', () => {
    const registry = new CapabilityRegistry();

    const providerWithoutHint = new Provider(
      "standard-gpt",
      "Standard GPT",
      "OpenAI",
      new Map([["Reasoning", 4]]),
      "healthy",
      { cost: 5, latency: 500, quality: 8, failureRate: 0.01 }
    );

    const providerWithHint = new Provider(
      "agentic-gpt",
      "Agentic GPT",
      "OpenAI",
      new Map([["Reasoning", 4]]),
      "healthy",
      { cost: 5, latency: 500, quality: 8, failureRate: 0.01 },
      ["agentic-orchestration"]
    );

    registry.registerProvider(providerWithoutHint);
    registry.registerProvider(providerWithHint);

    const decision = registry.searchAndRank({
      capabilities: ["Reasoning"],
      routingHints: ["agentic-orchestration"]
    });

    expect(decision.primaryProvider.id).toBe("agentic-gpt");
  });

  it('should emit events via EventBus during provider lifecycle & queries', async () => {
    const registry = new CapabilityRegistry();
    const mockEventHandler = vi.fn();

    globalEventBus.subscribe('ProviderRegistered' as any, mockEventHandler);
    globalEventBus.subscribe('CapabilityRouted' as any, mockEventHandler);

    const provider = new Provider(
      "evt-provider",
      "Event Provider",
      "Google",
      new Map([["Search", 5]]),
      "healthy"
    );

    registry.registerProvider(provider);
    expect(mockEventHandler).toHaveBeenCalledTimes(1);

    registry.searchAndRank({
      capabilities: ["Search"]
    });

    expect(mockEventHandler).toHaveBeenCalledTimes(2);

    // Clean up
    globalEventBus.unsubscribe('ProviderRegistered' as any, mockEventHandler);
    globalEventBus.unsubscribe('CapabilityRouted' as any, mockEventHandler);
  });

  it('should load self-declared providers through OpenRouterAdapter correctly', async () => {
    const registry = new CapabilityRegistry();
    const adapter = new OpenRouterAdapter();

    const providers = await adapter.getSelfDeclaredProviders();
    expect(providers.length).toBeGreaterThan(0);

    providers.forEach(p => registry.registerProvider(p));

    // Verify Claude 3.5 Sonnet is loaded
    const claude = registry.getProvider("openrouter/anthropic/claude-3.5-sonnet");
    expect(claude).toBeDefined();
    expect(claude?.getCapabilityRating("Coding")).toBe(5);

    // Search for Vision + Search capability
    const searchDecision = registry.searchAndRank({
      capabilities: ["Vision", "Search"]
    });

    // Gemini 1.5 Pro should be selected because it has rating 5 on Vision and Search
    expect(searchDecision.primaryProvider.id).toBe("openrouter/google/gemini-1.5-pro");
  });
});
