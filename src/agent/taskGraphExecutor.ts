import { createAgentTaskGraph, getNextRunnableTask, markTaskResult, markTaskRunning, type AgentTaskGraph } from './agentTaskGraph.js';
import { hasSuccessfulCheckpoint } from './checkpointManager.js';

export type ExecutorToolResult = { ok: boolean; artifact?: string; message?: string };
export type ExecutorTool = (task: { id: string; title: string }) => Promise<ExecutorToolResult>;
export type ExecutorVerification = (result: ExecutorToolResult) => Promise<{ ok: boolean; artifact?: string; reason?: string; attempts?: number }>;

export type TaskExecutionRecord = {
  taskId: string;
  attempt: number;
  toolExecuted: boolean;
  verified: boolean;
  status: 'completed' | 'failed' | 'blocked';
  artifact: string;
  verificationAttempts: number;
  resumedFromCheckpoint?: boolean;
};

function markCheckpointedTasksCompleted(graph: AgentTaskGraph, executionId: string): AgentTaskGraph {
  return {
    ...graph,
    tasks: graph.tasks.map((task) => hasSuccessfulCheckpoint(task.id, executionId) ? { ...task, status: 'completed' as const } : task),
  };
}

export async function executeNextTask(
  graph: AgentTaskGraph,
  tool: ExecutorTool,
  verify: ExecutorVerification,
): Promise<{ graph: AgentTaskGraph; record?: TaskExecutionRecord }> {
  const task = getNextRunnableTask(graph);
  if (!task) return { graph };

  let running = markTaskRunning(graph, task.id);
  const result = await tool(task);
  if (!result.ok) {
    running = markTaskResult(running, task.id, false);
    return { graph: running, record: { taskId: task.id, attempt: task.attempts + 1, toolExecuted: true, verified: false, status: running.tasks.find((candidate) => candidate.id === task.id)?.status === 'blocked' ? 'blocked' : 'failed', artifact: '', verificationAttempts: 0 } };
  }

  const verification = await verify(result);
  running = markTaskResult(running, task.id, verification.ok);
  const finalTask = running.tasks.find((candidate) => candidate.id === task.id)!;
  return {
    graph: running,
    record: { taskId: task.id, attempt: task.attempts + 1, toolExecuted: true, verified: verification.ok, status: finalTask.status === 'completed' ? 'completed' : finalTask.status === 'blocked' ? 'blocked' : 'failed', artifact: verification.artifact ?? result.artifact ?? '', verificationAttempts: verification.attempts ?? 0 },
  };
}

export async function executeTaskGraph(
  goal: string,
  titles: string[],
  tool: ExecutorTool,
  verify: ExecutorVerification,
): Promise<{ graph: AgentTaskGraph; records: TaskExecutionRecord[] }> {
  let graph = createAgentTaskGraph(goal, titles);
  const records: TaskExecutionRecord[] = [];
  while (records.length < 20) {
    const next = await executeNextTask(graph, tool, verify);
    graph = next.graph;
    if (!next.record) break;
    records.push(next.record);
    if (next.record.status === 'blocked') break;
  }
  return { graph, records };
}

export async function resumeTaskGraph(
  graph: AgentTaskGraph,
  executionId: string,
  tool: ExecutorTool,
  verify: ExecutorVerification,
): Promise<{ graph: AgentTaskGraph; records: TaskExecutionRecord[] }> {
  let resumedGraph = markCheckpointedTasksCompleted(graph, executionId);
  const records: TaskExecutionRecord[] = [];
  while (records.length < 20) {
    const next = getNextRunnableTask(resumedGraph);
    if (!next) break;
    const result = await executeNextTask(resumedGraph, tool, verify);
    resumedGraph = result.graph;
    if (!result.record) break;
    records.push(result.record);
    if (result.record.status === 'blocked') break;
  }
  return { graph: resumedGraph, records };
}
