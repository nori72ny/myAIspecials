import { describe, expect, it } from 'vitest';
import { executeNextTask } from '../src/agent/taskGraphExecutor.js';
import { createAgentTaskGraph } from '../src/agent/agentTaskGraph.js';

describe('task graph executor', () => {
  it('does not complete a task without successful verification', async () => {
    const graph = createAgentTaskGraph('make artifact', ['execute']);
    const next = await executeNextTask(
      graph,
      async () => ({ ok: true, artifact: 'artifact' }),
      async () => ({ ok: false, reason: 'verification failed' }),
    );
    expect(next.record?.toolExecuted).toBe(true);
    expect(next.record?.verified).toBe(false);
    expect(next.graph.tasks[0].status).toBe('failed');
  });

  it('completes only after tool execution and verification', async () => {
    const graph = createAgentTaskGraph('make artifact', ['execute']);
    const next = await executeNextTask(
      graph,
      async () => ({ ok: true, artifact: 'artifact' }),
      async (result) => ({ ok: result.ok, artifact: result.artifact }),
    );
    expect(next.record).toMatchObject({ toolExecuted: true, verified: true, status: 'completed' });
    expect(next.graph.tasks[0].status).toBe('completed');
  });

  it('blocks after the task attempt budget is exhausted', async () => {
    let graph = createAgentTaskGraph('make artifact', ['execute']);
    for (let i = 0; i < 3; i += 1) {
      graph = (await executeNextTask(graph, async () => ({ ok: false }), async () => ({ ok: false }))).graph;
    }
    expect(graph.tasks[0].status).toBe('blocked');
  });
});
