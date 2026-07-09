import { describe, it, expect } from 'vitest';
import { RoutingEngine } from '../RoutingEngine';
import { AIModel } from '../types';

describe('RoutingEngine', () => {
  const mockModels: AIModel[] = [
    {
      id: "ai-fast",
      name: "Fast AI",
      provider: "Mock",
      speed: 10,
      cost: 5,
      quality: 5,
      failureRate: 0.01,
      available: true,
      specialties: ["Text Generation", "Math"]
    },
    {
      id: "ai-smart",
      name: "Smart AI",
      provider: "Mock",
      speed: 3,
      cost: 9,
      quality: 10,
      failureRate: 0.01,
      available: true,
      specialties: ["Reasoning", "Text Generation", "Law", "Medical"]
    },
    {
      id: "ai-coder",
      name: "Coder AI",
      provider: "Mock",
      speed: 7,
      cost: 6,
      quality: 8,
      failureRate: 0.02,
      available: true,
      specialties: ["Code", "Reasoning"]
    },
    {
      id: "ai-artist",
      name: "Artist AI",
      provider: "Mock",
      speed: 5,
      cost: 5,
      quality: 9,
      failureRate: 0.05,
      available: true,
      specialties: ["Image Generation"]
    }
  ];

  it('should extract correct capabilities from input', () => {
    const engine = new RoutingEngine(mockModels);
    
    expect(engine.extractCapabilities("最新のニュースを調べて")).toContain("Research");
    expect(engine.extractCapabilities("このプログラムのバグを直して")).toContain("Code");
    expect(engine.extractCapabilities("犬のイラストを描いて")).toContain("Image Generation");
    expect(engine.extractCapabilities("法律の解釈を教えて")).toContain("Law");
  });

  it('should fallback to default capabilities if none matched', () => {
    const engine = new RoutingEngine(mockModels);
    const caps = engine.extractCapabilities("こんにちは");
    expect(caps).toContain("Text Generation");
    expect(caps).toContain("Reasoning");
  });

  it('should route to the best single AI based on quality priority', () => {
    const engine = new RoutingEngine(mockModels);
    const result = engine.route({ input: "医療に関する相談", priority: "quality" });
    
    expect(result.needsIntegration).toBe(false);
    expect(result.primaryAI.id).toBe("ai-smart");
    expect(result.extractedCapabilities).toContain("Medical");
  });

  it('should route to the best single AI based on speed priority', () => {
    const engine = new RoutingEngine(mockModels);
    // ai-fast is better at speed for math
    const result = engine.route({ input: "計算して", priority: "speed" });
    
    expect(result.needsIntegration).toBe(false);
    expect(result.primaryAI.id).toBe("ai-fast");
    expect(result.extractedCapabilities).toContain("Math");
  });

  it('should handle multiple capabilities by selecting integration AI', () => {
    const engine = new RoutingEngine(mockModels);
    // Needs Image Generation (ai-artist) and Code (ai-coder)
    const result = engine.route({ input: "プログラミングのエラーと、犬の絵を描いて" });
    
    expect(result.needsIntegration).toBe(true);
    expect(result.secondaryAIs.length).toBeGreaterThan(0);
    expect(result.integrationAI).toBeDefined();
    expect(result.integrationAI?.id).toBe("ai-smart"); // ai-smart is best for integration (Quality 10)
  });

  it('should throw if no available models', () => {
    const engine = new RoutingEngine([{ ...mockModels[0], available: false }]);
    expect(() => engine.route({ input: "テスト" })).toThrow("No available AI models.");
  });
});
