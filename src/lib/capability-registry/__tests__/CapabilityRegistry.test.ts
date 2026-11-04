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

    const premiumProvider = new Provider(
      "premium-gpt",
      "Premium GPT",
      "OpenAI",
      new Map([["Reasoning", 5], ["Planning", 5]]),
      "healthy",
      { cost: 9, latency: 600, quality: 10, failureRate: 0.001 }
    );

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

    const qualityDecision = registry.searchAndRank({
      capabilities: ["Reasoning", "Planning"],
      priority: "quality"
    });

    expect(qualityDecision.primaryProvider.id).toBe("premium-gpt");

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
      "down",
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

    globalEventBus.unsubscribe('ProviderRegistered' as any, mockEventHandler);
    globalEventBus.unsubscribe('CapabilityRouted' as any, mockEventHandler);
  });

  it('should load self-declared providers through OpenRouterAdapter correctly', async () => {
    const registry = new CapabilityRegistry();
    const adapter = new OpenRouterAdapter();

    const providers = await adapter.getSelfDeclaredProviders();
    expect(providers.length).toBeGreaterThan(0);

    providers.forEach(p => registry.registerProvider(p));

    const claude = registry.getProvider("anthropic/claude-3.5-sonnet");
    expect(claude).toBeDefined();
    expect(claude?.getCapabilityRating("Coding")).toBe(5);

    const searchDecision = registry.searchAndRank({
      capabilities: ["Vision", "Search"]
    });

    expect(searchDecision.primaryProvider.id).toBe("google/gemini-1.5-pro");
  });

  it('should enforce free-only routing and block paid models under free-only constraints', async () => {
    const registry = new CapabilityRegistry();
    const adapter = new OpenRouterAdapter();
    const providers = await adapter.getSelfDeclaredProviders();
    providers.forEach(p => registry.registerProvider(p));

    const normalDecision = registry.searchAndRank({
      capabilities: ["Coding"]
    });
    expect(normalDecision.primaryProvider.id).toBe("anthropic/claude-3.5-sonnet");

    const freeOnlyDecision = registry.searchAndRank({
      capabilities: ["Coding"],
      routingHints: ["free-only"]
    });
    expect(freeOnlyDecision.primaryProvider.id).toBe("google/gemma-4-31b-it:free");

    const originalFreeOnly = process.env.FREE_ONLY;
    process.env.FREE_ONLY = "true";
    try {
      const envFreeDecision = registry.searchAndRank({
        capabilities: ["Coding"]
      });
      expect(envFreeDecision.primaryProvider.id).toBe("google/gemma-4-31b-it:free");
    } finally {
      process.env.FREE_ONLY = originalFreeOnly;
    }
  });

  it('does not allow FREE_ONLY=false to enable paid providers outside tests', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFreeOnly = process.env.FREE_ONLY;
    process.env.NODE_ENV = "production";
    process.env.FREE_ONLY = "false";
    try {
      const registry = new CapabilityRegistry();
      const paid = new Provider(
        "openai/gpt-4o",
        "Paid GPT",
        "OpenRouter",
        new Map([["Coding", 5]]),
        "healthy",
        { cost: 7, latency: 700, quality: 9, failureRate: 0.01 },
        ["paid-model"]
      );
      expect(() => registry.registerProvider(paid)).toThrow("FREE_ONLY_PROVIDER_BLOCKED");
      expect(await new OpenRouterAdapter().getSelfDeclaredProviders())
        .toHaveLength(1);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalFreeOnly === undefined) delete process.env.FREE_ONLY;
      else process.env.FREE_ONLY = originalFreeOnly;
    }
  });

  it('should expose only the canonical model from OpenRouterAdapter in FREE_ONLY mode', async () => {
    const originalFreeOnly = process.env.FREE_ONLY;
    process.env.FREE_ONLY = "true";
    try {
      const providers = await new OpenRouterAdapter().getSelfDeclaredProviders();
      expect(providers.map(provider => provider.id)).toEqual(["google/gemma-4-31b-it:free"]);
      expect(providers[0].adapterId).toBe("OpenRouter");
    } finally {
      if (originalFreeOnly === undefined) delete process.env.FREE_ONLY;
      else process.env.FREE_ONLY = originalFreeOnly;
    }
  });

  it('should enforce FREE_ONLY during provider registration and registry reads', () => {
    const originalFreeOnly = process.env.FREE_ONLY;
    process.env.FREE_ONLY = "true";
    try {
      const registry = new CapabilityRegistry();
      const canonical = new Provider(
        "google/gemma-4-31b-it:free",
        "Canonical Free Model",
        "OpenRouter",
        new Map([["Coding", 5]]),
        "healthy",
        { cost: 1, latency: 900, quality: 8, failureRate: 0.02 },
        ["free-model"]
      );
      const paid = new Provider(
        "openai/gpt-4o",
        "Paid GPT",
        "OpenRouter",
        new Map([["Coding", 5]]),
        "healthy",
        { cost: 7, latency: 700, quality: 9, failureRate: 0.01 },
        ["paid-model"]
      );

      registry.registerProvider(canonical);
      expect(() => registry.registerProvider(paid))
        .toThrow("FREE_ONLY_PROVIDER_BLOCKED");
      expect(registry.getAllProviders()).toEqual([canonical]);
      expect(registry.getProvider(paid.id)).toBeUndefined();
      expect(registry.getProvidersByCapability("Coding")).toEqual([canonical]);
    } finally {
      if (originalFreeOnly === undefined) delete process.env.FREE_ONLY;
      else process.env.FREE_ONLY = originalFreeOnly;
    }
  });

  it('should reject spoofed free suffixes, free-model hints, zero-cost claims, and auto routing', () => {
    const registry = new CapabilityRegistry();
    const canonical = new Provider(
      "google/gemma-4-31b-it:free",
      "Canonical Free Model",
      "OpenRouter",
      new Map([["Coding", 4]]),
      "healthy",
      { cost: 1, latency: 900, quality: 8, failureRate: 0.02 },
      ["free-model"]
    );
    const spoofed = [
      new Provider("attacker/model:free", "Spoofed suffix", "OpenRouter", new Map([["Coding", 5]]), "healthy", { cost: 1, latency: 100, quality: 10, failureRate: 0 }, ["free-model"]),
      new Provider("attacker/model", "Spoofed hint", "OpenRouter", new Map([["Coding", 5]]), "healthy", { cost: 1, latency: 100, quality: 10, failureRate: 0 }, ["free-model"]),
      new Provider("openrouter/auto", "Automatic routing", "OpenRouter", new Map([["Coding", 5]]), "healthy", { cost: 1, latency: 100, quality: 10, failureRate: 0 }, ["free-model"]),
      new Provider("attacker/model:free", "Wrong adapter", "UntrustedAdapter", new Map([["Coding", 5]]), "healthy", { cost: 1, latency: 100, quality: 10, failureRate: 0 }, ["free-model"])
    ];
    [canonical, ...spoofed].forEach(provider => registry.registerProvider(provider));

    const decision = registry.searchAndRank({
      capabilities: ["Coding"],
      routingHints: ["free-only"]
    });
    expect(decision.primaryProvider).toBe(canonical);
    expect(decision.secondaryProviders).toHaveLength(0);
  });

  it('should reject the canonical model ID when supplied by an untrusted adapter', () => {
    const registry = new CapabilityRegistry();
    registry.registerProvider(new Provider(
      "google/gemma-4-31b-it:free",
      "Spoofed adapter",
      "UntrustedAdapter",
      new Map([["Coding", 5]]),
      "healthy",
      { cost: 1, latency: 100, quality: 10, failureRate: 0 },
      ["free-model"]
    ));

    expect(() => registry.searchAndRank({
      capabilities: ["Coding"],
      routingHints: ["free-only"]
    })).toThrow("No providers met the criteria for capabilities: Coding");
  });

  it('should prevent automatic paid fallback and throw error if no free models match under free-only constraints', async () => {
    const registry = new CapabilityRegistry();

    const paidProvider = new Provider(
      "paid-super-model",
      "Paid Super Model",
      "OpenRouter",
      new Map([["Coding", 5]]),
      "healthy",
      { cost: 8, latency: 500, quality: 10, failureRate: 0.01 },
      ["paid-model"]
    );
    registry.registerProvider(paidProvider);

    expect(() => {
      registry.searchAndRank({
        capabilities: ["Coding"],
        routingHints: ["free-only"]
      });
    }).toThrow("No providers met the criteria for capabilities: Coding");
  });
});
