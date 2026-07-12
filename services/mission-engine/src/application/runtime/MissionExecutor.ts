import { IMissionRepository, ITaskRepository, IAgentRepository, Mission, MissionStatus, createMissionId, createUserId } from "@origin/domain";
import { ILLMClient } from "../../infrastructure/ai/ILLMClient";
import { TaskExecutor } from "./TaskExecutor";
import { TaskQueue } from "./TaskQueue";
import { ExecutionContext } from "./ExecutionContext";
import { ExecutionResult } from "./ExecutionResult";
import { Logger } from "../../infrastructure/logging/Logger";
import { MetricsCollector } from "../../infrastructure/observability/MetricsCollector";

export class MissionExecutor {
  private taskExecutor: TaskExecutor;
  private taskQueue: TaskQueue = new TaskQueue();

  constructor(
    private missionRepo: IMissionRepository,
    private taskRepo: ITaskRepository,
    private agentRepo: IAgentRepository,
    private llmClient: ILLMClient
  ) {
    this.taskExecutor = new TaskExecutor(taskRepo, agentRepo, llmClient, 3, 10000, missionRepo);
  }

  public async execute(missionIdStr: string, correlationId?: string): Promise<ExecutionResult<Mission>> {
    const startTime = Date.now();
    const missionId = createMissionId(missionIdStr);
    
    // === START TRANSACTION ===
    const mission = await this.missionRepo.findById(missionId);
    // === COMMIT TRANSACTION ===

    if (!mission) {
      const error = new Error(`Mission ${missionIdStr} not found`);
      MetricsCollector.getInstance().recordError("MISSION_NOT_FOUND", error.message, `Id: ${missionIdStr}`);
      return {
        status: "FAILURE",
        error,
        durationMs: Date.now() - startTime
      };
    }

    const context = new ExecutionContext(mission.id, correlationId);
    context.set("objective", mission.objective);

    const logCtx = {
      correlationId: context.correlationId,
      missionId: mission.id
    };

    Logger.info(`Starting execution of Mission ${mission.id}: "${mission.objective}"`, logCtx);

    const tasks = mission.taskGraph.getTasks();
    MetricsCollector.getInstance().recordMissionStart(mission.id, mission.objective, tasks.length);

    try {
      // 1. Move state: Draft/Approved -> Active -> Reviewing
      // === START TRANSACTION ===
      if (mission.status === MissionStatus.Draft) {
        mission.approve(createUserId("system-admin"));
      }
      if (mission.status === MissionStatus.Approved) {
        mission.activate();
      }
      mission.startReview();
      await this.missionRepo.save(mission);
      // === COMMIT TRANSACTION ===

      let completedCount = 0;

      // 2. Iterate and schedule each task through the task queue
      for (const taskId of tasks) {
        // === START TRANSACTION ===
        const task = await this.taskRepo.findById(taskId);
        // === COMMIT TRANSACTION ===

        if (!task) {
          throw new Error(`Task ${taskId} defined in TaskGraph was not found in repository.`);
        }

        if (task.status === "Completed") {
          completedCount++;
          continue;
        }

        Logger.debug(`Enqueueing execution job for task ${taskId}`, logCtx);

        // Run task inside the serialize queue
        const result: ExecutionResult<string> = await this.taskQueue.enqueue(() => 
          this.taskExecutor.execute(task, context)
        );

        if (result.status === "FAILURE") {
          throw new Error(`Execution of task ${taskId} failed: ${result.error?.message || "Unknown error"}`);
        }

        completedCount++;
      }

      // 3. Complete Mission
      // === START TRANSACTION ===
      // Build a representation of OrganizationState for validation
      const activeTasks = [];
      const deliverables = [];
      for (const taskId of tasks) {
        const tObj = await this.taskRepo.findById(taskId);
        if (tObj) {
          activeTasks.push({
            id: tObj.id,
            missionId: tObj.missionId,
            title: tObj.description,
            description: tObj.description,
            requiredCapability: "Research", // fallback/approx
            priority: 5,
            department: "Engineering" as any,
            status: "Completed" as any,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          if (tObj.result) {
            deliverables.push({
              id: `del-${tObj.id}`,
              taskId: tObj.id,
              content: tObj.result,
              authorAgentId: tObj.assignedAgentId || "agent-default",
              version: 1,
              createdAt: new Date()
            });
          }
        }
      }

      const dummyState = {
        orgId: "dummy-org",
        missionId: mission.id,
        currentState: "COMPLETED" as any,
        activeTasks,
        deliverables,
        reviews: [],
        escalations: [],
        consensusRounds: [],
        departments: {} as any,
        roleMapping: {},
        updatedAt: new Date()
      };

      const { OutputValidatorService } = await import("../agent/governance/OutputValidatorService");
      const validationResult = OutputValidatorService.validate(mission.objective, dummyState);

      if (!validationResult.isValid) {
        throw new Error(`Output validation failed: ${validationResult.failureReason}`);
      }

      mission.complete(createUserId("system-admin"));
      await this.missionRepo.save(mission);
      // === COMMIT TRANSACTION ===

      // Discard execution memory upon successful mission completion
      const { MemoryManager } = await import("../agent/ExecutionMemory");
      MemoryManager.getInstance().discardMissionMemory(mission.id);

      const durationMs = Date.now() - startTime;
      MetricsCollector.getInstance().recordMissionEnd(mission.id, "Completed", completedCount);
      Logger.info(`Mission ${mission.id} executed successfully in ${durationMs}ms`, logCtx);

      return {
        status: "SUCCESS",
        data: mission,
        durationMs
      };

    } catch (error) {
      const durationMs = Date.now() - startTime;
      MetricsCollector.getInstance().recordMissionEnd(mission.id, "Discontinued", 0);
      MetricsCollector.getInstance().recordError("MISSION_EXECUTION_FAILURE", (error as Error).message, `Mission: ${mission.id}`);

      Logger.error(`Mission ${mission.id} execution aborted. Discontinuing mission.`, error, logCtx);

      try {
        // === START TRANSACTION ===
        mission.discontinue(createUserId("system-admin"), (error as Error).message);
        await this.missionRepo.save(mission);
        // === COMMIT TRANSACTION ===
      } catch (discontinueError) {
        Logger.error("Failed to mark mission as discontinued in repository", discontinueError, logCtx);
      }

      // Discard execution memory upon failure / abort
      try {
        const { MemoryManager } = await import("../agent/ExecutionMemory");
        MemoryManager.getInstance().discardMissionMemory(mission.id);
      } catch (memError) {
        // Silently capture any importing issues during error handlers
      }

      return {
        status: "FAILURE",
        error: error as Error,
        durationMs
      };
    }
  }
}
