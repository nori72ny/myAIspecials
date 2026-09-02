import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCheckpoint } from '../src/agent/checkpointManager.js';
import { createAgentTaskGraph } from '../src/agent/agentTaskGraph.js';
import { resumeTaskGraph } from '../src/agent/taskGraphExecutor.js';

describe('task graph resume', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('does not execute a tool for a task already completed in the same execution', async () => {
    const executionId = 'exec-resume-test';
    saveCheckpoint({
      taskId: 'task-1',
      executionId,
      status: 'completed',
      artifact: 'verified artifact',
    });

    const tool = vi.fn(async () => ({ ok: true, artifact: 'should-not-run' }));
    const verify = vi.fn(async () => ({ ok: true, artifact: 'should-not-verify' }));
    const graph = createAgentTaskGraph('resume test', ['write file']);

    const result = await resumeTaskGraph(graph, executionId, tool, verify);

    expect(tool).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(result.records).toHaveLength(0);
    expect(result.graph.tasks[0].status).toBe('completed');
  });
});
