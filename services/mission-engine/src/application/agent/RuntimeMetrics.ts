export interface MetricEntry {
  agentId: string;
  missionId: string;
  toolName?: string;
  promptLength: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
}

export class RuntimeMetrics {
  private static instance: RuntimeMetrics;
  private entries: MetricEntry[] = [];

  private constructor() {}

  public static getInstance(): RuntimeMetrics {
    if (!RuntimeMetrics.instance) {
      RuntimeMetrics.instance = new RuntimeMetrics();
    }
    return RuntimeMetrics.instance;
  }

  public record(entry: MetricEntry): void {
    this.entries.push(entry);
  }

  public getSummary() {
    const totalCalls = this.entries.length;
    const successfulCalls = this.entries.filter(e => e.success).length;
    const failedCalls = totalCalls - successfulCalls;
    
    const byAgent: Record<string, { calls: number; tokens: number; latencySum: number }> = {};
    const byMission: Record<string, { calls: number; tokens: number; latencySum: number }> = {};
    const byTool: Record<string, { calls: number; latencySum: number }> = {};
    
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const e of this.entries) {
      const tokens = e.inputTokens + e.outputTokens;
      totalTokens += tokens;
      totalInputTokens += e.inputTokens;
      totalOutputTokens += e.outputTokens;

      if (!byAgent[e.agentId]) {
        byAgent[e.agentId] = { calls: 0, tokens: 0, latencySum: 0 };
      }
      byAgent[e.agentId].calls++;
      byAgent[e.agentId].tokens += tokens;
      byAgent[e.agentId].latencySum += e.latencyMs;

      if (!byMission[e.missionId]) {
        byMission[e.missionId] = { calls: 0, tokens: 0, latencySum: 0 };
      }
      byMission[e.missionId].calls++;
      byMission[e.missionId].tokens += tokens;
      byMission[e.missionId].latencySum += e.latencyMs;

      if (e.toolName) {
        if (!byTool[e.toolName]) {
          byTool[e.toolName] = { calls: 0, latencySum: 0 };
        }
        byTool[e.toolName].calls++;
        byTool[e.toolName].latencySum += e.latencyMs;
      }
    }

    return {
      totalCalls,
      successfulCalls,
      failedCalls,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      byAgent,
      byMission,
      byTool
    };
  }

  public clear(): void {
    this.entries = [];
  }
}
