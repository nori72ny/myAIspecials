import { enhanceImagePrompt } from './imagePromptEngine.js';

describe('enhanceImagePrompt', () => {
  it('adds photorealistic optical guidance and safety negatives', () => {
    const result = enhanceImagePrompt('a woman walking in Tokyo at night', 'photorealistic');
    expect(result.positivePrompt).toContain('85mm F1.4');
    expect(result.positivePrompt).toContain('Hasselblad X2D');
    expect(result.negativePrompt).toContain('deformed anatomy');
  });

  it.each(['ghibli', 'disney', 'fine_art', 'scenery'] as const)('supports %s without external calls', (style) => {
    const result = enhanceImagePrompt('a mountain village at sunrise', style);
    expect(result.style).toBe(style);
    expect(result.positivePrompt.length).toBeGreaterThan(20);
    expect(result.negativePrompt.length).toBeGreaterThan(20);
  });

  it('rejects empty input', () => {
    expect(() => enhanceImagePrompt('   ', 'scenery')).toThrow();
  });
});
