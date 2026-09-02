import { describe, expect, it } from 'vitest';
import { createAgentTaskGraph, getNextRunnableTask, markTaskResult, markTaskRunning } from '../src/agent/agentTaskGraph';

describe('agent task graph', () => {
  it('bounds tasks and creates sequential dependencies', () => {
    const graph = createAgentTaskGraph(' build app ', Array.from({ length: 25 }, (_, i) => `task ${i}`));
    expect(graph.goal).toBe('build app');
    expect(graph.tasks).toHaveLength(20);
    expect(graph.tasks[0].dependsOn).toEqual([]);
    expect(graph.tasks[1].dependsOn).toEqual(['task-1']);
  });

  it('runs only dependency-ready work and caps failed retries', () => {
    let graph = createAgentTaskGraph('test', ['one', 'two']);
    expect(getNextRunnableTask(graph)?.id).toBe('task-1');
    graph = markTaskRunning(graph, 'task-1');
    graph = markTaskResult(graph, 'task-1', true);
    expect(getNextRunnableTask(graph)?.id).toBe('task-2');
    graph = markTaskRunning(graph, 'task-2');
    graph = markTaskResult(graph, 'task-2', false);
    graph = markTaskRunning(graph, 'task-2');
    graph = markTaskResult(graph, 'task-2', false);
    graph = markTaskRunning(graph, 'task-2');
    graph = markTaskResult(graph, 'task-2', false);
    expect(graph.tasks[1].status).toBe('blocked');
    expect(getNextRunnableTask(graph)).toBeUndefined();
  });
});
