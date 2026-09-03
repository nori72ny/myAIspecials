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
  const dummyMission = Mission.create(createMissionId("MS-1"), "Create a clean React app", ["Has headers", "Has checklists", "No compilation errors"]);
  const dummyTask = new Task(createTaskId("TSK-1"), dummyMission.id, "Design and write the core component layouts");
  const dummyAgent = new Agent(createAgentId("AG-1"), "Senior Engineer", ["DESIGN", "ASSIST"]);

  describe("1. PromptBuilder", () => {
    it("builds structured system prompts including capabilities and tools", () => {
      const systemPrompt = PromptBuilder.buildSystemPrompt({ mission: dummyMission, task: dummyTask, agent: dummyAgent, availableTools: [{ name: "CalculatorTool", description: "Does math" }] });
      expect(systemPrompt).toContain("Senior Engineer");
      expect(systemPrompt).toContain("DESIGN, ASSIST");
      expect(systemPrompt).toContain("CalculatorTool");
    });

    it("builds detailed user prompts containing mission, task, memory, and tool history", () => {
      const userPrompt = PromptBuilder.buildUserPrompt({ mission: dummyMission, task: dummyTask, agent: dummyAgent, memory: ["Thought about layouts"], toolResults: [{ toolName: "CalculatorTool", input: { expression: "2+2" }, result: "4" }] });
      expect(userPrompt).toContain("Create a clean React app");
      expect(userPrompt).toContain("Has headers");
      expect(userPrompt).toContain("Design and write the core component layouts");
      expect(userPrompt).toContain("Thought about layouts");
      expect(userPrompt).toContain("CalculatorTool");
      expect(userPrompt).toContain("実行結果: 4");
    });
  });

  describe("2. ToolExecutor", () => {
    it("performs safe evaluations in CalculatorTool", async () => {
      const calc = new CalculatorTool();
      expect((await calc.execute({ expression: "(10 + 5) * 2" })).success).toBe(true);
      expect((await calc.execute({ expression: "require('fs')" })).error).toContain("Security restriction");
    });

    it("fails closed for WebTool query execution when live network search is disabled", async () => {
      const web = new WebTool();
      const res = await web.execute({ query: "Clean Architecture guidelines" });
      expect(res.success).toBe(false);
      expect(res.error).toContain("disabled");
    });

    it("rejects absolute FileTool paths before filesystem access", async () => {
      const fileTool = new FileTool();
      const resAbsolute = await fileTool.execute({ action: "read", path: "/etc/passwd" });
      expect(resAbsolute.success).toBe(false);
      expect(resAbsolute.error).toContain("PATH_OUTSIDE_WORKSPACE");
    });
  });

  describe("3. OutputValidator", () => {
    it("validates JSON payloads and strips markdown code blocks", () => {
      const res = OutputValidator.validate("```json\n{\"status\": \"ok\"}\n```", "JSON");
      expect(res.isValid).toBe(true);
      expect(res.parsedContent.status).toBe("ok");
    });
    it("detects invalid markdown strings when expecting Markdown format", () => {
      expect(OutputValidator.validate("Just regular plain text output with no headers.", "Markdown").isValid).toBe(false);
    });
    it("treats any non-empty string as valid text", () => {
      expect(OutputValidator.validate("Hello world", "Text").isValid).toBe(true);
    });
  });

  describe("4. QualityChecker", () => {
    it("flags potential hallucinations based on template placeholders", () => {
      const issues = QualityChecker.check("Here is the completed code. TODO: implement login details [Insert API Key]", "Text", []);
      expect(issues.some(i => i.type === "Hallucination" && i.description.includes("TODO:"))).toBeDefined();
      expect(issues.some(i => i.type === "Hallucination" && i.description.includes("[Insert"))).toBeDefined();
    });
    it("flags missing data against required success criteria", () => {
      const issues = QualityChecker.check("Created components with headers.", "Text", ["Has headers", "Has checklists"]);
      expect(issues.some(i => i.type === "MissingData" && i.description.includes("Has checklists"))).toBeDefined();
    });
  });

  describe("5. ReflectionEngine", () => {
    it("passes good content", () => {
      const reflection = ReflectionEngine.reflect("No issues here. Has headers and checklists and no compilation errors.", "Text", ["Has headers", "Has checklists"]);
      expect(reflection.passed).toBe(true);
      expect(reflection.score).toBeGreaterThanOrEqual(70);
      expect(reflection.feedback).toContain("合格");
    });
    it("fails low quality content", () => {
      const reflection = ReflectionEngine.reflect("Wait, here is the result template [Insert Key] and TODO: code.", "JSON", ["Has checklists"]);
      expect(reflection.passed).toBe(false);
      expect(reflection.score).toBeLessThan(70);
      expect(reflection.feedback).toContain("不合格");
    });
  });

  describe("6. RuntimeMetrics", () => {
    it("aggregates execution metrics", () => {
      const metrics = RuntimeMetrics.getInstance(); metrics.clear();
      metrics.record({ agentId: "AG-1", missionId: "MS-1", toolName: "FileTool", promptLength: 250, inputTokens: 80, outputTokens: 40, latencyMs: 120, success: true });
      const summary = metrics.getSummary();
      expect(summary.totalCalls).toBe(1); expect(summary.totalTokens).toBe(120); expect(summary.byAgent["AG-1"].calls).toBe(1); expect(summary.byTool["FileTool"].calls).toBe(1);
    });
  });

  describe("7. AgentRuntime Orchestration Loop", () => {
    it("completes a standard success path", async () => {
      const mockLLM: ILLMClient = { generateText: vi.fn().mockResolvedValue("Designed elegant React application. Has headers, has checklists, and has no compilation errors.") };
      const runtime = new AgentRuntime(mockLLM, { maxAttempts: 2, timeoutMs: 1000 });
      const result = await runtime.execute(dummyMission, dummyTask, dummyAgent, "Text");
      expect(result.success).toBe(true); expect(result.attemptsUsed).toBe(1); expect(runtime.getState()).toBe("Completed");
    });

    it("retries and corrects outputs when the first attempt fails quality reflection", async () => {
      let callCount = 0;
      const mockLLM: ILLMClient = { generateText: vi.fn().mockImplementation(async () => { callCount += 1; return callCount === 1 ? "Wrote some template layouts. TODO: finish checklists." : JSON.stringify({ status: "completed", details: "Wrote completed code layouts. Has headers, has checklists, and has no compilation errors." }); }) };
      const runtime = new AgentRuntime(mockLLM, { maxAttempts: 3, timeoutMs: 1000 });
      const result = await runtime.execute(dummyMission, dummyTask, dummyAgent, "JSON");
      expect(result.success).toBe(true); expect(result.attemptsUsed).toBe(2); expect(callCount).toBe(2); expect(runtime.getState()).toBe("Completed");
    });
  });
});
