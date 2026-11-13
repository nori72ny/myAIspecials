import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_ACTIVITY_FRESH_MS,
  getAgentActivitySnapshot,
  isAgentActivityFresh,
  reportAgentActivity,
  subscribeAgentActivity,
  type AgentActivitySummary,
} from './agentActivityStore';

const summary = (overrides: Partial<AgentActivitySummary> = {}): AgentActivitySummary => ({
  active: true,
  outcome: 'running',
  stepTitle: 'ウェブ調査',
  currentStep: 1,
  totalSteps: 3,
  updatedAt: 1000,
  ...overrides,
});

describe('agentActivityStore', () => {
  afterEach(() => {
    reportAgentActivity(null);
  });

  it('starts empty and returns the latest reported summary', () => {
    expect(getAgentActivitySnapshot()).toBeNull();
    reportAgentActivity(summary());
    expect(getAgentActivitySnapshot()?.stepTitle).toBe('ウェブ調査');
    reportAgentActivity(summary({ stepTitle: '文書作成', currentStep: 2 }));
    expect(getAgentActivitySnapshot()?.currentStep).toBe(2);
    reportAgentActivity(null);
    expect(getAgentActivitySnapshot()).toBeNull();
  });

  it('notifies subscribers until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentActivity(listener);
    reportAgentActivity(summary());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    reportAgentActivity(summary({ currentStep: 3 }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats only recent summaries as fresh enough to call running', () => {
    expect(isAgentActivityFresh(summary(), 1000 + AGENT_ACTIVITY_FRESH_MS)).toBe(true);
    expect(isAgentActivityFresh(summary(), 1000 + AGENT_ACTIVITY_FRESH_MS + 1)).toBe(false);
    expect(isAgentActivityFresh(null, 1000)).toBe(false);
  });
});
