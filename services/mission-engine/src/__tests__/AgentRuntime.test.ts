import { describe, it, expect, vi } from "vitest";
import { Mission, Task, Agent, createMissionId, createTaskId, createAgentId } from "@origin/domain";
import { PromptBuilder } from "../application/agent/PromptBuilder";
import { ToolExecutor, FileTool, WebTool, CalculatorTool } from "../application/agent/ToolExecutor";
import { OutputValidator } from "../application/agent/OutputValidator";
import { QualityChecker } from "../application/agent/QualityChecker";
import { ReflectionEngine } from "../application/agent/ReflectionEngine";
import { RuntimeConfig, DEFAULT_RUNTIME_CONFIG } from "../application/agent/RuntimeConfig";
import { RuntimeMetrics } from "../application/agent/RuntimeMetrics";
import { AgentRuntime } from "../application/agent/AgentRuntime";
import { ILLMClient } from "../infrastructure/ai/ILLMClient";

describe("=== Agent Runtime (Version 1 Core) Unit Tests ===", () => {

  const dummyMission = Mission.create(
    createMissionId("MS-1"),
    "Create a clean React app",
    ["Has headers", "Has checklists", "No compilation errors"]
  );

  const dummyTask = new Task(
    createTaskId("TSK-1"),
    dummyMission.id,
    "Design and write the core component layouts"
  );

  const dummyAgent = new Agent(
    createAgentId("AG-1"),
    "Senior Engineer",
    ["DESIGN", "ASSIST"]
  );

  describe("1. PromptBuilder", () => {
    it("should build structured system prompts including capabilities and tools", () => {
      const systemPrompt = PromptBuilder.buildSystemPrompt({
        mission: dummyMission,
        task: dummyTask,
        agent: dummyAgent,
        availableTools: [{ name: "CalculatorTool", description: "Does math" }]
      });

      expect(systemPrompt).toContain("Senior Engineer");
      expect(systemPrompt).toContain("DESIGN, ASSIST");
      expect(systemPrompt).toContain("CalculatorTool");
    });

    it("should build detailed user prompts containing mission, task, memory, and tool history", () => {
      const userPrompt = PromptBuilder.buildUserPrompt({
        mission: dummyMission,
        task: dummyTask,
        agent: dummyAgent,
        memory: ["Thought about layouts"],
        toolResults: [{ toolName: "CalculatorTool", input: { expression: "2+2" }, result: "4" }]
      });

      expect(userPrompt).toContain("Create a clean React app");
      expect(userPrompt).toContain("Has headers");
      expect(userPrompt).toContain("Design and write the core component layouts");
      expect(userPrompt).toContain("Thought about layouts");
      expect(userPrompt).toContain("CalculatorTool");
      expect(userPrompt).toContain("実行結果: 4");
    });
  });

  describe("2. ToolExecutor", () => {
    it("should perform safe evaluations in CalculatorTool", async () => {
      const calc = new CalculatorTool();
      const resHappy = await calc.execute({ expression: "(10 + 5) * 2" });
      expect(resHappy.success).toBe(true);
      expect(resHappy.output).toBe("30");

      const resViolation = await calc.execute({ expression: "require('fs')" });
      expect(resViolation.success).toBe(false);
      expect(resViolation.error).toContain("Security restriction");
    });

    it("should handle mocked query execution in WebTool", async () => {
      const web = new WebTool();
      const res = await web.execute({ query: "Clean Architecture guidelines" });
      expect(res.success).toBe(true);
      expect(res.output).toContain("Clean Architecture");
    });

    it("should execute action operations in FileTool safely with relative paths only", async () => {
      const fileTool = new FileTool();
      const resAbsolute = await fileTool.execute({ action: "read", path: "/etc/passwd" });
      expect(resAbsolute.success).toBe(false);
      expect(resAbsolute.error).toContain("Access denied");
    });
  });

  describe("3. OutputValidator", () => {
    it("should validate JSON payloads and strip markdown code blocks", () => {
      const markdownJson = "```json\n{\"status\": \"ok\"}\n```";
      const res = OutputValidator.validate(markdownJson, "JSON");
      expect(res.isValid).toBe(true);
      expect(res.parsedContent.status).toBe("ok");
    });

    it("should detect invalid markdown strings when expecting Markdown format", () => {
      const simpleText = "Just regular plain text output with no headers.";
      const res = OutputValidator.validate(simpleText, "Markdown");
      expect(res.isValid).toBe(false);
      expect(res.error).toBeDefined();
    });

    it("should treat any non-empty string as valid text", () => {
      const res = OutputValidator.validate("Hello world", "Text");
      expect(res.isValid).toBe(true);
    });
  });

  describe("4. QualityChecker", () => {
    it("should flag potential hallucinations based on template placeholders", () => {
      const hallucinatedContent = "Here is the completed code. TODO: implement login details [Insert API Key]";
      const issues = QualityChecker.check(hallucinatedContent, "Text", []);
      
      const todoIssue = issues.find(i => i.type === "Hallucination" && i.description.includes("TODO:"));
      const keyIssue = issues.find(i => i.type === "Hallucination" && i.description.includes("[Insert"));
      
      expect(todoIssue).toBeDefined();
      expect(keyIssue).toBeDefined();
    });

    it("should check and flag missing data against required success criteria", () => {
      const missingContent = "Created components with headers.";
      const issues = QualityChecker.check(missingContent, "Text", ["Has headers", "Has checklists"]);
      
      const missingChecklist = issues.find(i => i.type === "MissingData" && i.description.includes("Has checklists"));
      expect(missingChecklist).toBeDefined();
    });
  });

  describe("5. ReflectionEngine", () => {
    it("should output passing grades and constructive feedback when quality thresholds are met", () => {
      const goodContent = "No issues here. Has headers and checklists and no compilation errors.";
      const reflection = ReflectionEngine.reflect(goodContent, "Text", ["Has headers", "Has checklists"]);
      
      expect(reflection.passed).toBe(true);
      expect(reflection.score).toBeGreaterThanOrEqual(70);
      expect(reflection.feedback).toContain("合格");
    });

    it("should fail reflection and suggest corrections when score falls below 70", () => {
      // Missing expected JSON keys or having hallucination patterns
      const badContent = "Wait, here is the result template [Insert Key] and TODO: code.";
      const reflection = ReflectionEngine.reflect(badContent, "JSON", ["Has checklists"]);
      
      expect(reflection.passed).toBe(false);
      expect(reflection.score).toBeLessThan(70);
      expect(reflection.feedback).toContain("不合格");
    });
  });

  describe("6. RuntimeMetrics", () => {
    it("should log execution metrics and generate complete aggregated summaries", () => {
      const metrics = RuntimeMetrics.getInstance();
      metrics.clear();

      metrics.record({
        agentId: "AG-1",
        missionId: "MS-1",
        toolName: "FileTool",
        promptLength: 250,
        inputTokens: 80,
        outputTokens: 40,
        latencyMs: 120,
        success: true
      });

      const summary = metrics.getSummary();
      expect(summary.totalCalls).toBe(1);
      expect(summary.totalTokens).toBe(120);
      expect(summary.byAgent["AG-1"].calls).toBe(1);
      expect(summary.byTool["FileTool"].calls).toBe(1);
    });
  });

  describe("7. AgentRuntime Orchestration Loop", () => {
    it("should cycle through Thinking, Reflecting, and Completed on standard success paths", async () => {
      const mockLLM: ILLMClient = {
        generateText: vi.fn().mockResolvedValue("Designed elegant React application. Has headers, has checklists, and has no compilation errors.")
      };

      const runtime = new AgentRuntime(mockLLM, { maxAttempts: 2, timeoutMs: 1000 });
      expect(runtime.getState()).toBe("Idle");

      const result = await runtime.execute(dummyMission, dummyTask, dummyAgent, "Text");

      expect(result.success).toBe(true);
      expect(result.attemptsUsed).toBe(1);
      expect(runtime.getState()).toBe("Completed");
    });

    it("should retry and correct outputs when initial attempts fail quality reflection", async () => {
      let callCount = 0;
      const mockLLM: ILLMClient = {
        generateText: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            // Fails JSON format validation
            return "Wrote some template layouts. TODO: finish checklists.";
          }
          return JSON.stringify({
            status: "completed",
            details: "Wrote completed code layouts. Has headers, has checklists, and has no compilation errors."
          });
        })
      };

      const runtime = new AgentRuntime(mockLLM, { maxAttempts: 3, timeoutMs: 1000 });
      const result = await runtime.execute(dummyMission, dummyTask, dummyAgent, "JSON");

      expect(result.success).toBe(true);
      expect(result.attemptsUsed).toBe(2);
      expect(callCount).toBe(2);
      expect(runtime.getState()).toBe("Completed");
    });
  });
});
