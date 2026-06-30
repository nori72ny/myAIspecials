import { describe, it, expect, beforeEach } from "vitest";
import { MemoryManager, ContextResolver } from "../application/agent/ExecutionMemory";

describe("=== Execution Memory (Version 1 Core) Unit Tests ===", () => {
  const missionId = "MS-TEST-123";
  const taskId = "TSK-TEST-456";
  const agentId = "AG-TEST-789";

  beforeEach(() => {
    MemoryManager.getInstance().clearAll();
  });

  describe("1. MissionMemory", () => {
    it("should store and retrieve facts successfully", () => {
      const manager = MemoryManager.getInstance();
      const missionMemory = manager.getMissionMemory(missionId);

      missionMemory.addFact("Database migration has finished", { step: 1 });
      missionMemory.addFact("Core models generated");

      const facts = missionMemory.getFacts();
      expect(facts.length).toBe(2);
      expect(facts[0].content).toBe("Database migration has finished");
      expect(facts[0].metadata?.step).toBe(1);
      expect(facts[1].content).toBe("Core models generated");
    });
  });

  describe("2. TaskMemory & Task間Memory共有", () => {
    it("should allow tasks to share memory outputs across the same mission", () => {
      const manager = MemoryManager.getInstance();
      const taskMemory = manager.getTaskMemory(missionId);

      taskMemory.recordTaskOutput("TSK-001", "Design specification completed: components, pages, forms.");
      taskMemory.recordTaskOutput("TSK-002", "Source code compiled cleanly with no TypeScript warnings.");

      expect(taskMemory.getTaskOutput("TSK-001")).toContain("Design specification completed");
      expect(taskMemory.getTaskOutput("TSK-002")).toContain("Source code compiled cleanly");

      // Verify ContextResolver picks up outputs of other tasks (excluding the active one)
      const context = ContextResolver.resolveContext(missionId, "TSK-003", agentId);
      const joined = context.join("\n");
      
      expect(joined).toContain("TSK-001");
      expect(joined).toContain("TSK-002");
      expect(joined).not.toContain("TSK-003");
    });
  });

  describe("3. Scratchpad", () => {
    it("should manage ephemeral key-value notes cleanly", () => {
      const manager = MemoryManager.getInstance();
      const scratchpad = manager.getScratchpad(missionId);

      scratchpad.write("Intermediate file created at /tmp/comp.json");
      expect(scratchpad.read().length).toBe(1);
      expect(scratchpad.read()[0]).toBe("Intermediate file created at /tmp/comp.json");

      scratchpad.clear();
      expect(scratchpad.read().length).toBe(0);
    });
  });

  describe("4. ExecutionContextMemory", () => {
    it("should set and get typed execution environment variables", () => {
      const manager = MemoryManager.getInstance();
      const contextMemory = manager.getExecutionContextMemory(missionId);

      contextMemory.set("debug_mode", true);
      contextMemory.set("max_tokens_override", 4096);

      expect(contextMemory.get<boolean>("debug_mode")).toBe(true);
      expect(contextMemory.get<number>("max_tokens_override")).toBe(4096);
    });
  });

  describe("5. ConversationMemory", () => {
    it("should store user/agent conversational turn history", () => {
      const manager = MemoryManager.getInstance();
      const conversation = manager.getConversationMemory(missionId, agentId);

      conversation.addMessage("user", "Can you build a button?");
      conversation.addMessage("assistant", "Sure, I have styled it with tailwind.");

      const history = conversation.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].role).toBe("user");
      expect(history[0].content).toBe("Can you build a button?");
      expect(history[1].role).toBe("assistant");
    });
  });

  describe("6. AgentScratchpad", () => {
    it("should log step-by-step internal execution traces for the active agent", () => {
      const manager = MemoryManager.getInstance();
      const agentScratchpad = manager.getAgentScratchpad(missionId, taskId);

      agentScratchpad.logStep("Initiated reflection cycle");
      agentScratchpad.logStep("Output verified with format validator");

      const steps = agentScratchpad.getSteps();
      expect(steps.length).toBe(2);
      expect(steps[0]).toBe("Initiated reflection cycle");
      expect(steps[1]).toBe("Output verified with format validator");
    });
  });

  describe("7. Mission終了時Memory破棄", () => {
    it("should discard all compartments when a mission is finalized/deleted", () => {
      const manager = MemoryManager.getInstance();
      
      // Populate memory across all compartments
      manager.getMissionMemory(missionId).addFact("Important logic note");
      manager.getTaskMemory(missionId).recordTaskOutput(taskId, "Task result");
      manager.getScratchpad(missionId).write("Raw notes");
      manager.getExecutionContextMemory(missionId).set("key", "val");
      manager.getConversationMemory(missionId, agentId).addMessage("user", "Hello");
      manager.getAgentScratchpad(missionId, taskId).logStep("Step info");

      // Discard mission memory
      manager.discardMissionMemory(missionId);

      // Verify all compartments are empty/fresh
      expect(manager.getMissionMemory(missionId).getFacts().length).toBe(0);
      expect(manager.getTaskMemory(missionId).getTaskOutput(taskId)).toBeUndefined();
      expect(manager.getScratchpad(missionId).read().length).toBe(0);
      expect(manager.getExecutionContextMemory(missionId).get("key")).toBeUndefined();
      expect(manager.getConversationMemory(missionId, agentId).getHistory().length).toBe(0);
      expect(manager.getAgentScratchpad(missionId, taskId).getSteps().length).toBe(0);
    });
  });

  describe("8. ContextResolver", () => {
    it("should resolve and format all relevant compartment content into structured strings", () => {
      const manager = MemoryManager.getInstance();
      manager.getMissionMemory(missionId).addFact("Fact A");
      manager.getTaskMemory(missionId).recordTaskOutput("TSK-OTHER", "Other output");
      manager.getAgentScratchpad(missionId, taskId).logStep("Step A");
      manager.getScratchpad(missionId).write("Note A");
      manager.getConversationMemory(missionId, agentId).addMessage("user", "Chat A");

      const context = ContextResolver.resolveContext(missionId, taskId, agentId);
      const output = context.join("\n");

      expect(output).toContain("Fact A");
      expect(output).toContain("Other output");
      expect(output).toContain("Step A");
      expect(output).toContain("Note A");
      expect(output).toContain("Chat A");
    });
  });
});
