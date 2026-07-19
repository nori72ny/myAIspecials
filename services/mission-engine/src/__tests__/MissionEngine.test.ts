import { describe, it, expect, beforeEach, vi } from "vitest";
import { 
  Mission, 
  MissionFactory,
  Task, 
  Agent, 
  TaskGraph, 
  MissionStatus, 
  TaskStatus, 
  AgentStatus, 
  createMissionId, 
  createTaskId, 
  createAgentId, 
  createUserId,
  DomainInvariantViolationError,
  InvalidStateTransitionError,
  CircularDependencyError
} from "@origin/domain";

import { InMemoryMissionRepository } from "../infrastructure/database/InMemoryMissionRepository";
import { InMemoryTaskRepository } from "../infrastructure/database/InMemoryTaskRepository";
import { InMemoryAgentRepository } from "../infrastructure/registry/InMemoryAgentRepository";
import { PlanMissionUseCase } from "../application/usecases/PlanMissionUseCase";
import { ExecuteMissionUseCase } from "../application/usecases/ExecuteMissionUseCase";
import { GetMissionStatusUseCase } from "../application/usecases/GetMissionStatusUseCase";

import { ExecutionContext } from "../application/runtime/ExecutionContext";
import { RetryPolicy } from "../application/runtime/RetryPolicy";
import { withTimeout, TimeoutError } from "../application/runtime/Timeout";
import { TaskQueue } from "../application/runtime/TaskQueue";
import { MetricsCollector } from "../infrastructure/observability/MetricsCollector";
import { ILLMClient } from "../infrastructure/ai/ILLMClient";

// Mock LLM client
class MockLLMClient implements ILLMClient {
  public generateText = vi.fn().mockImplementation(async (prompt: string) => {
    MetricsCollector.getInstance().recordLLMCall("mock-model", 50, 20, 30);
    if (prompt.includes("目的")) {
      return JSON.stringify([
        { description: "Design components", capability: "DESIGN" },
        { description: "Write logic", capability: "ASSIST" },
        { description: "Verify code", capability: "ASSIST" }
      ]);
    }
    return "Task executed successfully";
  });
}

describe("=== Phase A & C: Mission Engine Unit Tests ===", () => {

  describe("1. TaskGraph Unit Tests", () => {
    it("should allow adding tasks and dependencies", () => {
      const graph = new TaskGraph();
      const t1 = createTaskId("T-1");
      const t2 = createTaskId("T-2");

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1, t2);

      expect(graph.getTasks()).toContain(t1);
      expect(graph.getTasks()).toContain(t2);
    });

    it("should prevent circular dependencies and throw CircularDependencyError", () => {
      const graph = new TaskGraph();
      const t1 = createTaskId("T-1");
      const t2 = createTaskId("T-2");

      graph.addTask(t1);
      graph.addTask(t2);
      graph.addDependency(t1, t2);

      expect(() => graph.addDependency(t2, t1)).toThrow(CircularDependencyError);
    });
  });

  describe("2. Mission Aggregate Unit Tests", () => {
    it("should create a mission with minimum of 3 success criteria", () => {
      const id = createMissionId("MS-TEST");
      const criteria = ["Check 1", "Check 2", "Check 3"];
      const m = Mission.create(id, "Solve math", criteria);
      expect(m.status).toBe(MissionStatus.Draft);
      expect(m.successCriteria.length).toBe(3);
    });

    it("should throw DomainInvariantViolationError if less than 3 success criteria", () => {
      const id = createMissionId("MS-TEST");
      expect(() => Mission.create(id, "Solve math", ["One"])).toThrow(DomainInvariantViolationError);
    });

    it("should transition state machine properly along Approved -> Active -> Reviewing -> Completed", () => {
      const m = Mission.create(createMissionId("MS-TEST"), "Task", ["C1", "C2", "C3"]);
      const admin = createUserId("admin");

      expect(m.status).toBe(MissionStatus.Draft);
      m.approve(admin);
      expect(m.status).toBe(MissionStatus.Approved);

      m.activate();
      expect(m.status).toBe(MissionStatus.Active);

      m.startReview();
      expect(m.status).toBe(MissionStatus.Reviewing);

      m.complete(admin);
      expect(m.status).toBe(MissionStatus.Completed);
    });

    it("should throw InvalidStateTransitionError if state machine is violated", () => {
      const m = Mission.create(createMissionId("MS-TEST"), "Task", ["C1", "C2", "C3"]);
      expect(() => m.activate()).toThrow(InvalidStateTransitionError);
    });

    it("should support versioning", () => {
      const m = Mission.create(createMissionId("MS-TEST"), "Task", ["C1", "C2", "C3"]);
      expect(m.version).toBe(1);

      m.approve(createUserId("admin"));
      expect(m.version).toBe(2);
    });
  });

  describe("3. Task Unit Tests", () => {
    it("should handle assignment and progress changes", () => {
      const task = new Task(createTaskId("T-1"), createMissionId("M-1"), "Code core");
      expect(task.status).toBe(TaskStatus.Pending);

      const agentId = createAgentId("ag-1");
      task.assign(agentId);
      expect(task.assignedAgentId).toBe(agentId);

      task.start();
      expect(task.status).toBe(TaskStatus.InProgress);

      task.complete("Finished cleanly");
      expect(task.status).toBe(TaskStatus.Completed);
      expect(task.result).toBe("Finished cleanly");
    });
  });

  describe("4. Agent Unit Tests", () => {
    it("should manage Agent Lifecycle States correctly", () => {
      const agent = new Agent(createAgentId("AG-1"), "CODER", ["DESIGN"]);
      expect(agent.status).toBe(AgentStatus.Available);

      agent.assign();
      expect(agent.status).toBe(AgentStatus.Assigned);

      agent.startWorking();
      expect(agent.status).toBe(AgentStatus.Working);

      agent.completeWork();
      expect(agent.status).toBe(AgentStatus.Available);
    });
  });

  describe("5. RetryPolicy Unit Tests", () => {
    it("should succeed immediately on happy path", async () => {
      const policy = new RetryPolicy({ maxAttempts: 3, initialDelayMs: 1, backoffFactor: 2 });
      const operation = vi.fn().mockResolvedValue("Success!");

      const res = await policy.execute(operation);
      expect(res).toBe("Success!");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should retry on transient failures and eventually succeed", async () => {
      const policy = new RetryPolicy({ maxAttempts: 3, initialDelayMs: 1, backoffFactor: 2 });
      let callCount = 0;
      const operation = async () => {
        callCount++;
        if (callCount < 2) throw new Error("Transient Network Down");
        return "Recovered!";
      };

      const res = await policy.execute(operation);
      expect(res).toBe("Recovered!");
      expect(callCount).toBe(2);
    });

    it("should fail after maximum attempts", async () => {
      const policy = new RetryPolicy({ maxAttempts: 3, initialDelayMs: 1, backoffFactor: 2 });
      const operation = vi.fn().mockRejectedValue(new Error("Fatal"));

      await expect(policy.execute(operation)).rejects.toThrow("Fatal");
      expect(operation).toHaveBeenCalledTimes(3);
    });
  });

  describe("6. Timeout Unit Tests", () => {
    it("should resolve if promise completes before timeout", async () => {
      const fastPromise = new Promise(resolve => setTimeout(() => resolve("Fast"), 5));
      const res = await withTimeout(fastPromise, 20);
      expect(res).toBe("Fast");
    });

    it("should throw TimeoutError if promise takes too long", async () => {
      const slowPromise = new Promise(resolve => setTimeout(() => resolve("Slow"), 50));
      await expect(withTimeout(slowPromise, 5)).rejects.toThrow(TimeoutError);
    });
  });

  describe("7. TaskQueue Unit Tests", () => {
    it("should execute jobs serially", async () => {
      const queue = new TaskQueue();
      const executionOrder: number[] = [];

      const job1 = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        executionOrder.push(1);
      };

      const job2 = async () => {
        executionOrder.push(2);
      };

      await Promise.all([
        queue.enqueue(job1),
        queue.enqueue(job2)
      ]);

      expect(executionOrder).toEqual([1, 2]);
    });
  });
});

describe("=== Phase A, B & D: Mission Engine Integration & Repository Tests ===", () => {
  let missionRepo: InMemoryMissionRepository;
  let taskRepo: InMemoryTaskRepository;
  let agentRepo: InMemoryAgentRepository;
  let llmClient: MockLLMClient;

  beforeEach(() => {
    missionRepo = new InMemoryMissionRepository();
    taskRepo = new InMemoryTaskRepository();
    agentRepo = new InMemoryAgentRepository();
    llmClient = new MockLLMClient();
    MetricsCollector.getInstance().clear();
  });

  it("should integrate Planning, explicit approval, execution, and verification of a Mission", async () => {
    const planner = new PlanMissionUseCase(missionRepo, taskRepo, llmClient);
    const executor = new ExecuteMissionUseCase(
      missionRepo,
      taskRepo,
      agentRepo,
      llmClient,
      async (request, organizationExecutor) => {
        organizationExecutor.resolveHumanApproval(
          request.orgId,
          request.id,
          true,
          "Approved by explicit integration-test handler",
        );
      },
    );
    const statusQuery = new GetMissionStatusUseCase(missionRepo, taskRepo);

    // 1. Plan Mission
    const mission = await planner.execute("Build a beautiful React app");
    expect(mission.status).toBe(MissionStatus.Active);
    expect(await missionRepo.count()).toBe(1);

    // 2. Execute Mission
    await executor.execute(mission.id);

    // 3. Query status & verify outcome
    const status = await statusQuery.execute(mission.id);
    expect(status.mission.status).toBe(MissionStatus.Completed);
    expect(status.tasks.length).toBe(3);
    expect(status.tasks.every(t => t.status === TaskStatus.Completed)).toBe(true);

    // 4. Verify Phase D Observability stats
    const metrics = MetricsCollector.getInstance().getMetricsSummary();
    expect(metrics.missions.total).toBe(1);
    expect(metrics.missions.completed).toBe(1);
    expect(metrics.tasks.total).toBe(3);
    expect(metrics.llm.totalCalls).toBeGreaterThan(0);
    expect(metrics.errors.totalCount).toBe(0);
  }, 30000);

  it("should throw locking conflict upon saving stale mission aggregate version", async () => {
    const mission = MissionFactory.createNewMission("Concurrency test", ["C1", "C2", "C3"]);
    await missionRepo.save(mission);

    // Simulate another aggregate state modification incrementing version
    const clonedStale = await missionRepo.findById(mission.id);
    expect(clonedStale).not.toBeNull();

    // Stale clone changes version
    mission.approve(createUserId("admin"));
    await missionRepo.save(mission); // Saved version 2 now

    // Stale try saving expecting version 1
    await expect(missionRepo.save(clonedStale!, 1)).rejects.toThrow(DomainInvariantViolationError);
  });
});
