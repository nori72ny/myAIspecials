export interface MissionMetrics {
  missionId: string;
  objective: string;
  status: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  tasksCount: number;
  completedTasksCount: number;
}

export interface TaskMetrics {
  taskId: string;
  missionId: string;
  status: string;
  durationMs?: number;
  retryAttempts: number;
}

export interface LLMMetrics {
  timestamp: Date;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ErrorMetrics {
  timestamp: Date;
  errorName: string;
  errorMessage: string;
  context: string;
}

export class MetricsCollector {
  private static instance: MetricsCollector;

  private missions: Map<string, MissionMetrics> = new Map();
  private tasks: Map<string, TaskMetrics> = new Map();
  private llmCalls: LLMMetrics[] = [];
  private errors: ErrorMetrics[] = [];

  private constructor() {}

  public static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  // Mission metrics
  public recordMissionStart(missionId: string, objective: string, tasksCount: number): void {
    this.missions.set(missionId, {
      missionId,
      objective,
      status: "Active",
      startTime: new Date(),
      tasksCount,
      completedTasksCount: 0
    });
  }

  public recordMissionEnd(missionId: string, status: string, completedTasksCount: number): void {
    const m = this.missions.get(missionId);
    if (m) {
      m.endTime = new Date();
      m.status = status;
      m.durationMs = m.endTime.getTime() - m.startTime.getTime();
      m.completedTasksCount = completedTasksCount;
    }
  }

  // Task metrics
  public recordTaskStart(taskId: string, missionId: string): void {
    this.tasks.set(taskId, {
      taskId,
      missionId,
      status: "InProgress",
      retryAttempts: 0
    });
  }

  public recordTaskEnd(taskId: string, status: string, durationMs: number, retryAttempts: number): void {
    const t = this.tasks.get(taskId);
    if (t) {
      t.status = status;
      t.durationMs = durationMs;
      t.retryAttempts = retryAttempts;
    }
  }

  // LLM metrics
  public recordLLMCall(model: string, latencyMs: number, inputTokens: number, outputTokens: number): void {
    this.llmCalls.push({
      timestamp: new Date(),
      model,
      latencyMs,
      inputTokens,
      outputTokens
    });
  }

  // Error metrics
  public recordError(errorName: string, errorMessage: string, context: string): void {
    this.errors.push({
      timestamp: new Date(),
      errorName,
      errorMessage,
      context
    });
  }

  // Retrieve metrics summary
  public getMetricsSummary() {
    const missionsArray = Array.from(this.missions.values());
    const tasksArray = Array.from(this.tasks.values());

    const totalMissions = missionsArray.length;
    const completedMissions = missionsArray.filter(m => m.status === "Completed").length;
    const failedMissions = missionsArray.filter(m => m.status === "Discontinued").length;

    const avgMissionDurationMs = missionsArray.length > 0 
      ? missionsArray.reduce((acc, curr) => acc + (curr.durationMs || 0), 0) / missionsArray.length
      : 0;

    const avgTaskDurationMs = tasksArray.length > 0
      ? tasksArray.reduce((acc, curr) => acc + (curr.durationMs || 0), 0) / tasksArray.length
      : 0;

    const totalInputTokens = this.llmCalls.reduce((acc, curr) => acc + curr.inputTokens, 0);
    const totalOutputTokens = this.llmCalls.reduce((acc, curr) => acc + curr.outputTokens, 0);
    const avgLLMLatencyMs = this.llmCalls.length > 0
      ? this.llmCalls.reduce((acc, curr) => acc + curr.latencyMs, 0) / this.llmCalls.length
      : 0;

    return {
      missions: {
        total: totalMissions,
        completed: completedMissions,
        failed: failedMissions,
        averageDurationMs: Math.round(avgMissionDurationMs)
      },
      tasks: {
        total: tasksArray.length,
        averageDurationMs: Math.round(avgTaskDurationMs)
      },
      llm: {
        totalCalls: this.llmCalls.length,
        totalTokens: totalInputTokens + totalOutputTokens,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        averageLatencyMs: Math.round(avgLLMLatencyMs)
      },
      errors: {
        totalCount: this.errors.length,
        distribution: this.getErrorDistribution()
      }
    };
  }

  private getErrorDistribution(): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const e of this.errors) {
      dist[e.errorName] = (dist[e.errorName] || 0) + 1;
    }
    return dist;
  }

  public clear(): void {
    this.missions.clear();
    this.tasks.clear();
    this.llmCalls = [];
    this.errors = [];
  }
}
