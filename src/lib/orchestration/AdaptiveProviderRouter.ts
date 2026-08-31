import { AITaskType } from './MultiAIOrchestrator';

export type ProviderId = 'google-ai-studio' | 'openrouter' | 'groq';

export interface ProviderCandidate { provider: ProviderId; score: number; reason: string; }
export interface AdaptiveRouteInput { taskType: AITaskType; availableProviders: ProviderId[]; excludeProviders?: ProviderId[]; }

/** Provider-selection adapter for ORIGIN's zero-cost orchestration layer. */
export function rankAdaptiveProviders(input: AdaptiveRouteInput): ProviderCandidate[] {
  const excluded = new Set(input.excludeProviders ?? []);
  const available = input.availableProviders.filter((provider) => !excluded.has(provider));
  const preference: Partial<Record<AITaskType, ProviderId[]>> = {
    implementation: ['google-ai-studio', 'groq', 'openrouter'],
    testing: ['google-ai-studio', 'groq', 'openrouter'],
    documentation: ['google-ai-studio', 'openrouter', 'groq'],
    research: ['openrouter', 'google-ai-studio', 'groq'],
    security: ['google-ai-studio', 'openrouter', 'groq'],
    ux: ['google-ai-studio', 'openrouter', 'groq'],
    review: ['google-ai-studio', 'openrouter', 'groq'],
  };
  const order = preference[input.taskType] ?? ['google-ai-studio', 'groq', 'openrouter'];
  return available.map((provider) => {
    const index = order.indexOf(provider);
    return { provider, score: index < 0 ? 0 : order.length - index, reason: index < 0 ? 'Eligible fallback.' : `Task-fit rank ${index + 1}.` };
  }).sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider));
}

export function nextAdaptiveProvider(input: AdaptiveRouteInput, failedProvider: ProviderId): ProviderCandidate | undefined {
  return rankAdaptiveProviders({ ...input, excludeProviders: [...(input.excludeProviders ?? []), failedProvider] })[0];
}
