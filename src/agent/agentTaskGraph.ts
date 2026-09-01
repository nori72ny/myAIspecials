export type AgentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked';

export type AgentTask = {
  id: string;
  title: string;
  dependsOn: string[];
  status: AgentTaskStatus;
  attempts: number;
  maxAttempts: number;
};

export type AgentTaskGraph = {
  goal: string;
  tasks: AgentTask[];
};

const MAX_TASKS = 20;
const MAX_TITLE = 180;

export function createAgentTaskGraph(goal: string, titles: string[]): AgentTaskGraph {
  const normalizedGoal = goal.trim().slice(0, 4000);
  const bounded = titles.slice(0, MAX_TASKS).map((title, index) => ({
    id: `task-${index + 1}`,
    title: title.trim().slice(0, MAX_TITLE),
    dependsOn: index === 0 ? [] : [`task-${index}`],
    status: 'queued' as const,
    attempts: 0,
    maxAttempts: 3,
  }));
  return { goal: normalizedGoal, tasks: bounded };
}

export function getNextRunnableTask(graph: AgentTaskGraph): AgentTask | undefined {
  return graph.tasks.find((task) => task.status === 'queued' && task.dependsOn.every((id) => graph.tasks.find((candidate) => candidate.id === id)?.status === 'completed'));
}

export function markTaskRunning(graph: AgentTaskGraph, taskId: string): AgentTaskGraph {
  return { ...graph, tasks: graph.tasks.map((task) => task.id === taskId ? { ...task, status: 'running', attempts: task.attempts + 1 } : task) };
}

export function markTaskResult(graph: AgentTaskGraph, taskId: string, ok: boolean): AgentTaskGraph {
  return { ...graph, tasks: graph.tasks.map((task) => {
    if (task.id !== taskId) return task;
    if (ok) return { ...task, status: 'completed' };
    return { ...task, status: task.attempts >= task.maxAttempts ? 'blocked' : 'failed' };
  }) };
}
