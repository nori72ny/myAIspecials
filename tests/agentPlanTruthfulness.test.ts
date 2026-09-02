import { describe, expect, it } from 'vitest';
import { createAgentTaskGraph } from '../src/agent/agentTaskGraph.js';

describe('agent plan truthfulness', () => {
  it('keeps planned tasks queued until real execution succeeds', () => {
    const graph = createAgentTaskGraph('build feature', ['Plan', 'Execute', 'Verify']);
    expect(graph.tasks.every((task) => task.status === 'queued')).toBe(true);
  });
});
