import { ITaskRepository, IAgentRepository, IMissionRepository, Task, Agent, TaskStatus, AgentStatus, createAgentId } from "@origin/domain";
import { ILLMClient } from "../../infrastructure/ai/ILLMClient";
import { RetryPolicy } from "./RetryPolicy";
import { withTimeout } from "./Timeout";
import { MetricsCollector } from "../../infrastructure/observability/MetricsCollector";
import { Logger } from "../../infrastructure/logging/Logger";
import { ExecutionContext } from "./ExecutionContext";
import { ExecutionResult } from "./ExecutionResult";
import { AgentRuntime } from "../agent/AgentRuntime";

export class TaskExecutor {
  private retryPolicy: RetryPolicy;

  constructor(
    private taskRepo: ITaskRepository,
    private agentRepo: IAgentRepository,
    private llmClient: ILLMClient,
    maxAttempts: number = 3,
    private timeoutMs: number = 10000, // 10s default
    private missionRepo?: IMissionRepository
  ) {
    this.retryPolicy = new RetryPolicy({ maxAttempts, initialDelayMs: 200, backoffFactor: 2 });
  }

  public async execute(task: Task, context: ExecutionContext): Promise<ExecutionResult<string>> {
    const startTime = Date.now();
    const metrics = MetricsCollector.getInstance();
    metrics.recordTaskStart(task.id, task.missionId);

    const logCtx = {
      correlationId: context.correlationId,
      missionId: task.missionId,
      taskId: task.id
    };

    Logger.info(`Executing task: ${task.id} (${task.description})`, logCtx);

    try {
      // 1. Assign agent
      const capability = this.determineRequiredCapability(task.description);
      let agents = await this.agentRepo.findByCapability(capability);
      let agent = agents.find(a => a.status === AgentStatus.Available) || agents[0];

      if (!agent) {
        // Find default general agent
        agent = (await this.agentRepo.findById(createAgentId("agent-default"))) || 
                new Agent(createAgentId("agent-default"), "GENERAL", ["ASSIST"]);
      }

      // Claim agent (Simulation)
      if (agent.status === AgentStatus.Available) {
        agent.assign();
        agent.startWorking();
        await this.agentRepo.save(agent);
      }

      task.assign(agent.id);
      task.start();
      await this.taskRepo.save(task);

      // Retrieve or construct robust fallback Mission Aggregate
      let mission: any;
      if (this.missionRepo) {
        mission = await this.missionRepo.findById(task.missionId);
      }

      if (!mission) {
        const objective = context.get<string>("objective") || "Build a beautiful React app";
        const criteria = ["Check 1", "Check 2", "Check 3"];
        const { Mission } = await import("@origin/domain");
        mission = Mission.create(task.missionId, objective, criteria);
      }

      // 2. Perform execution with AgentRuntime (FSM, prompt construction, tool execution, output verification, self-reflection check)
      const agentRuntime = new AgentRuntime(this.llmClient, {
        maxAttempts: 3,
        timeoutMs: this.timeoutMs,
        model: "gemini-3.5-flash"
      });

      const runtimeResult = await agentRuntime.execute(mission, task, agent, "Text");

      if (!runtimeResult.success) {
        throw new Error(`Agent execution failed validation or reflection: ${runtimeResult.output || "Unknown error"}`);
      }

      const resultText = runtimeResult.output;

      // 3. Complete task & agent
      task.complete(resultText);
      await this.taskRepo.save(task);

      agent.completeWork();
      await this.agentRepo.save(agent);

      const durationMs = Date.now() - startTime;
      metrics.recordTaskEnd(task.id, "Completed", durationMs, 0);
      Logger.info(`Task ${task.id} completed successfully in ${durationMs}ms`, logCtx);

      return {
        status: "SUCCESS",
        data: resultText,
        durationMs
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      metrics.recordTaskEnd(task.id, "Failed", durationMs, 3);
      metrics.recordError("TASK_EXECUTION_FAILURE", (error as Error).message, `Task: ${task.id}`);
      
      Logger.error(`Task ${task.id} failed after ${durationMs}ms`, error, logCtx);

      // Mark status as failed in repo
      try {
        task.fail((error as Error).message);
        await this.taskRepo.save(task);
      } catch (saveError) {
        Logger.error("Failed to mark task as failed in repository", saveError, logCtx);
      }

      return {
        status: "FAILURE",
        error: error as Error,
        durationMs
      };
    }
  }

  private determineRequiredCapability(desc: string): string {
    const uppercase = desc.toUpperCase();
    if (uppercase.includes("DESIGN") || uppercase.includes("設計") || uppercase.includes("要件")) {
      return "DESIGN";
    }
    if (uppercase.includes("ANALYZE") || uppercase.includes("調査") || uppercase.includes("解析")) {
      return "ANALYZE";
    }
    return "ASSIST";
  }
}
