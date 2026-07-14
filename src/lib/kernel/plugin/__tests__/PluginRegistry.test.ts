import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../PluginRegistry';
import { OpenRouterPlugin } from '../../../plugins/ai/OpenRouterPlugin';

describe('PluginRegistry', () => {
  it('should register and retrieve AI Provider plugin', async () => {
    const registry = new PluginRegistry();
    const openRouterPlugin = new OpenRouterPlugin("dummy-key");

    await registry.registerPlugin(openRouterPlugin);

    const aiProviders = registry.getAIProviders();
    expect(aiProviders.length).toBe(1);
    expect(aiProviders[0].manifest.provider).toBe("OpenRouter");
    expect(aiProviders[0].manifest.models[0].name).toBe("Gemini 2.5 Flash (OpenRouter Free)");
    expect(aiProviders[0].manifest.models[0].id).toBe("google/gemini-2.5-flash:free");
    expect(aiProviders[0].manifest.models[0].cost).toBe(0);
  });

  it('should prevent duplicate registration', async () => {
    const registry = new PluginRegistry();
    const openRouterPlugin = new OpenRouterPlugin("dummy-key");

    await registry.registerPlugin(openRouterPlugin);
    
    await expect(registry.registerPlugin(openRouterPlugin)).rejects.toThrow(
      "Plugin plugin-openrouter is already registered."
    );
  });
});
