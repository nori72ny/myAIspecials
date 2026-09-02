import { describe, expect, it } from 'vitest';
import { nextAdaptiveProvider, rankAdaptiveProviders } from './AdaptiveProviderRouter';

describe('AdaptiveProviderRouter', () => {
  it('ranks only available providers for the task', () => {
    expect(rankAdaptiveProviders({
      taskType: 'implementation',
      availableProviders: ['openrouter', 'groq', 'google-ai-studio'],
    }).map((candidate) => candidate.provider)).toEqual([
      'google-ai-studio',
      'groq',
      'openrouter',
    ]);
  });

  it('falls back to the next eligible provider after a failure', () => {
    expect(nextAdaptiveProvider({
      taskType: 'implementation',
      availableProviders: ['google-ai-studio', 'groq', 'openrouter'],
    }, 'google-ai-studio')?.provider).toBe('groq');
  });

  it('does not invent an unavailable provider', () => {
    expect(rankAdaptiveProviders({
      taskType: 'research',
      availableProviders: ['groq'],
    }).map((candidate) => candidate.provider)).toEqual(['groq']);
  });
});
