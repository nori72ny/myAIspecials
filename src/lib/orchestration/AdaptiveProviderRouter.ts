import { AITaskType, MultiAIOrchestrator } from './MultiAIOrchestrator';

export type ProviderId = 'google-ai-studio' | 'openrouter' | 'groq';

export interface ProviderCandidate {
  provider: ProviderId;
  score: number;
  reason: string;
}

export interface AdaptiveRouteInput {
  taskType: AITaskType;
  availableProviders: ProviderId[];
  excludeProviders?: ProviderId[];
}

/**
 * Thin adapter between ORIGIN's existing capability policy and the runtime
 * provider executor. The router never adds a paid provider and never treats
 * an unavailable provider as a candidate.
 */
export function rankAdaptiveProviders(input: AdaptiveRouteInput): ProviderCandidate[] {
  const excluded = new Set(input.excludeProviders ?? []);
  const available = input.availableProviders.filter((provider) => !excluded.has(provider));

  const preference: Record<AITaskType, ProviderId[]> = {
    implementation: ['google-ai-studio', 'groq', 'openrouter'],
    testing: ['google-ai-studio', 'groq', 'openrouter'],
    documentation: ['google-ai-studio', 'openrouter', 'groq'],
    research: ['openrouter', 'google-ai-studio', 'groq'],
    security: ['google-ai-studio', 'openrouter', 'groq'],
    ux: ['google-ai-studio', 'openrouter', 'groq'],
    review: ['google-ai-studio', 'openrouter', 'groq'],
    general: ['google-ai-studio', 'groq', 'openrouter'],
  };

  const order = preference[input.taskType] ?? preference.general;
  return available
    .map((provider) => {
      const index = order.indexOf(provider);
      const score = index < 0 ? 0 : order.length - index;
      return {
        provider,
        score,
        reason: index < 0 ? 'No task-specific preference; eligible fallback.' : `Task fit rank ${index + 1}.`,
      };
    })
    .sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider));
}

export function nextAdaptiveProvider(
  input: AdaptiveRouteInput,
  failedProvider: ProviderId,
): ProviderCandidate | undefined {
  return rankAdaptiveProviders({
    ...input,
    excludeProviders: [...(input.excludeProviders ?? []), failedProvider],
  })[0];
}

// Keep the orchestrator import reachable from this adapter so task/capability
// policy changes remain coupled to the same orchestration layer.
export type OriginOrchestrator = MultiAIOrchestrator;
